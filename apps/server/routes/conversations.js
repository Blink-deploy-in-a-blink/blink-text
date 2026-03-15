'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

router.use(authenticateToken);

// GET /api/conversations
router.get('/', (req, res) => {
  try {
    // First, get all conversation IDs the current user is part of
    // Then, for each conversation, get participant info
    const conversations = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at,
             GROUP_CONCAT(DISTINCT CASE WHEN u.deleted_at IS NOT NULL THEN 'Deleted User' ELSE u.username END) AS participant_usernames,
             GROUP_CONCAT(DISTINCT u.id) AS participant_ids,
             MAX(CASE WHEN u.deleted_at IS NOT NULL AND u.id != ? THEN 1 ELSE 0 END) AS has_deleted_participant
      FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      JOIN users u ON u.id = cp.user_id
      WHERE c.id IN (
        SELECT conversation_id FROM conversation_participants WHERE user_id = ?
      )
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all(req.user.id, req.user.id);

    return res.json({ conversations });
  } catch (err) {
    console.error('Get conversations error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/conversations
router.post(
  '/',
  [
    body('type').isIn(['direct_message', 'group_chat']).withMessage('type must be direct_message or group_chat'),
    body('participants').isArray({ min: 1 }).withMessage('participants must be a non-empty array of user IDs'),
    body('name').optional().isString().trim().isLength({ max: 64 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { type, participants, name } = req.body;
    const allParticipants = Array.from(new Set([req.user.id, ...participants]));

    if (type === 'direct_message' && allParticipants.length !== 2) {
      return res.status(400).json({ error: 'Direct message must have exactly 2 participants' });
    }

    try {
      if (type === 'direct_message') {
        const [userA, userB] = allParticipants;
        const existing = db.prepare(`
          SELECT c.id FROM conversations c
          JOIN conversation_participants cpA ON cpA.conversation_id = c.id AND cpA.user_id = ?
          JOIN conversation_participants cpB ON cpB.conversation_id = c.id AND cpB.user_id = ?
          WHERE c.type = 'direct_message'
          LIMIT 1
        `).get(userA, userB);
        if (existing) return res.json({ conversation: existing });
      }

      for (const uid of allParticipants) {
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        if (!user) return res.status(400).json({ error: `User ${uid} not found` });
      }

      const conversationId = uuidv4();
      const createConversation = db.transaction(() => {
        db.prepare('INSERT INTO conversations (id, type, name) VALUES (?, ?, ?)').run(conversationId, type, name || null);
        for (const uid of allParticipants) {
          db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(conversationId, uid);
        }
      });
      createConversation();

      const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);

      // Notify other participants in real-time
      const io = req.app.get('io');
      if (io) {
        const otherParticipants = allParticipants.filter((uid) => uid !== req.user.id);
        for (const uid of otherParticipants) {
          io.to(uid).emit('new_conversation', { conversation });
        }
      }

      return res.status(201).json({ conversation });
    } catch (err) {
      console.error('Create conversation error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/conversations/:id/messages?limit=50&before=<timestamp>
router.get('/:id/messages', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before ? parseInt(req.query.before) : null;

    let rows;
    if (before) {
      // Load older messages before the cursor timestamp
      rows = db.prepare(`
        SELECT id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, edited, timestamp
        FROM messages
        WHERE conversation_id = ?
          AND id NOT IN (SELECT message_id FROM message_deletions WHERE user_id = ?)
          AND timestamp < ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(req.params.id, req.user.id, before, limit);
      // Reverse to get chronological order
      rows.reverse();
    } else {
      // Load the latest messages
      rows = db.prepare(`
        SELECT id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, edited, timestamp
        FROM messages
        WHERE conversation_id = ?
          AND id NOT IN (SELECT message_id FROM message_deletions WHERE user_id = ?)
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(req.params.id, req.user.id, limit);
      // Reverse to get chronological order
      rows.reverse();
    }

    // Return messages in the canonical EncryptedMessage format
    const messages = rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      timestamp: row.timestamp,
      replyToId: row.reply_to_id || null,
      edited: !!row.edited,
      payload: {
        ciphertext: row.ciphertext,
        iv: row.iv,
        version: row.version,
      },
    }));

    // hasMore: true if we got exactly `limit` rows (more might exist)
    return res.json({ messages, hasMore: rows.length === limit });
  } catch (err) {
    console.error('Get messages error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/conversations/:id/participants
router.get('/:id/participants', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    const participants = db.prepare(`
      SELECT u.id, u.username, cp.joined_at
      FROM conversation_participants cp
      JOIN users u ON u.id = cp.user_id
      WHERE cp.conversation_id = ?
    `).all(req.params.id);

    return res.json({ participants });
  } catch (err) {
    console.error('Get participants error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/conversations/:id/messages/:messageId — edit a message
router.put(
  '/:id/messages/:messageId',
  [
    param('id').isUUID(),
    param('messageId').isUUID(),
    body('payload').isObject().withMessage('payload is required'),
    body('payload.ciphertext').isString().notEmpty(),
    body('payload.iv').isString().notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

      const message = db.prepare(
        'SELECT * FROM messages WHERE id = ? AND conversation_id = ?'
      ).get(req.params.messageId, req.params.id);
      if (!message) return res.status(404).json({ error: 'Message not found' });
      if (message.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });

      const { ciphertext, iv, version } = req.body.payload;
      db.prepare(
        'UPDATE messages SET ciphertext = ?, iv = ?, version = ?, edited = 1 WHERE id = ?'
      ).run(ciphertext, iv, version || 'v1', req.params.messageId);

      return res.json({ edited: true });
    } catch (err) {
      console.error('Edit message error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/conversations/:id/messages/:messageId?mode=for_me|for_everyone
router.delete(
  '/:id/messages/:messageId',
  [
    param('id').isUUID(),
    param('messageId').isUUID(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const mode = req.query.mode || 'for_me';
    if (!['for_me', 'for_everyone'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be for_me or for_everyone' });
    }

    try {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

      const message = db.prepare(
        'SELECT * FROM messages WHERE id = ? AND conversation_id = ?'
      ).get(req.params.messageId, req.params.id);
      if (!message) return res.status(404).json({ error: 'Message not found' });

      if (mode === 'for_everyone') {
        if (message.sender_id !== req.user.id) {
          return res.status(403).json({ error: 'You can only delete your own messages for everyone' });
        }
        db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.messageId);
      } else {
        db.prepare(
          'INSERT OR IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)'
        ).run(req.params.messageId, req.user.id);
      }

      return res.json({ deleted: true, mode });
    } catch (err) {
      console.error('Delete message error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
