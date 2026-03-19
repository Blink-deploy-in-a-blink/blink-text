'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticateToken } = require('../auth');

const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', 'uploads');

const router = express.Router();

const parsedMaxConversations = parseInt(process.env.MAX_CONVERSATIONS_PER_USER, 10);
const MAX_CONVERSATIONS_PER_USER = Number.isInteger(parsedMaxConversations) && parsedMaxConversations > 0
  ? parsedMaxConversations
  : 500;

router.use(authenticateToken);

// GET /api/conversations
router.get('/', (req, res) => {
  try {
    // First, get all conversation IDs the current user is part of
    // Then, for each conversation, get participant info
    const conversations = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at, c.disappear_after,
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
    body('disappearAfter').optional({ nullable: true }).isInt({ min: 0 }).withMessage('disappearAfter must be a non-negative integer (ms)'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { type, participants, name, disappearAfter } = req.body;
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
        if (existing) {
          // Return enriched conversation data (not just {id}) so the client
          // gets participant_usernames, participant_ids, etc.
          const enriched = db.prepare(`
            SELECT c.id, c.type, c.name, c.created_at, c.disappear_after,
                   GROUP_CONCAT(DISTINCT CASE WHEN u.deleted_at IS NOT NULL THEN 'Deleted User' ELSE u.username END) AS participant_usernames,
                   GROUP_CONCAT(DISTINCT u.id) AS participant_ids,
                   MAX(CASE WHEN u.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS has_deleted_participant
            FROM conversations c
            JOIN conversation_participants cp ON cp.conversation_id = c.id
            JOIN users u ON u.id = cp.user_id
            WHERE c.id = ?
            GROUP BY c.id
          `).get(existing.id);
          return res.json({ conversation: enriched || existing });
        }
      }

      for (const uid of allParticipants) {
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        if (!user) return res.status(400).json({ error: `User ${uid} not found` });
      }

      // Check for blocks between the creator and any participant
      for (const uid of participants) {
        const blocked = db.prepare(
          'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
        ).get(req.user.id, uid, uid, req.user.id);
        if (blocked) {
          return res.status(403).json({ error: 'Cannot create conversation — one of you has blocked the other' });
        }
      }

      // Enforce per-user conversation limit to prevent database exhaustion
      const convCount = db.prepare(
        'SELECT COUNT(*) as count FROM conversation_participants WHERE user_id = ?'
      ).get(req.user.id).count;
      if (convCount >= MAX_CONVERSATIONS_PER_USER) {
        return res.status(400).json({ error: 'Maximum conversation limit reached. Remove some conversations first.' });
      }

      const conversationId = uuidv4();
      // Validate disappearAfter: only allow known timer values (null, 0, or positive integers)
      const validTimers = [null, 0, 300000, 3600000, 86400000, 604800000, 2592000000]; // off, 5m, 1h, 24h, 7d, 30d
      const timerValue = (disappearAfter != null && validTimers.includes(disappearAfter)) ? disappearAfter : null;
      const createConversation = db.transaction(() => {
        db.prepare('INSERT INTO conversations (id, type, name, disappear_after) VALUES (?, ?, ?, ?)').run(conversationId, type, name || null, timerValue || null);
        for (const uid of allParticipants) {
          db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(conversationId, uid);
        }
      });
      createConversation();

      const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);

      // Fetch enriched conversation data including participant usernames (Issue 4.3)
      const enrichedConversation = db.prepare(`
        SELECT c.id, c.type, c.name, c.created_at, c.disappear_after,
               GROUP_CONCAT(DISTINCT CASE WHEN u.deleted_at IS NOT NULL THEN 'Deleted User' ELSE u.username END) AS participant_usernames,
               GROUP_CONCAT(DISTINCT u.id) AS participant_ids,
               MAX(CASE WHEN u.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS has_deleted_participant
        FROM conversations c
        JOIN conversation_participants cp ON cp.conversation_id = c.id
        JOIN users u ON u.id = cp.user_id
        WHERE c.id = ?
        GROUP BY c.id
      `).get(conversationId);

      // Notify other participants in real-time
      const io = req.app.get('io');
      if (io) {
        const otherParticipants = allParticipants.filter((uid) => uid !== req.user.id);
        for (const uid of otherParticipants) {
          io.to(uid).emit('new_conversation', { conversation: enrichedConversation || conversation });
        }
      }

      return res.status(201).json({ conversation: enrichedConversation || conversation });
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
        SELECT id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, edited, timestamp, message_type, media_id, chain_idx, expires_at
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
        SELECT id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, edited, timestamp, message_type, media_id, chain_idx, expires_at
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
    const messages = rows.map((row) => {
      const payload = {
        ciphertext: row.ciphertext,
        iv: row.iv,
        version: row.version,
      };
      if (row.chain_idx != null) payload.chainIdx = row.chain_idx;
      return {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        timestamp: row.timestamp,
        replyToId: row.reply_to_id || null,
        edited: !!row.edited,
        payload,
        messageType: row.message_type || 'text',
        mediaId: row.media_id || null,
        expiresAt: row.expires_at || null,
      };
    });

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

        // Clean up associated media file from disk and DB if present
        if (message.media_id) {
          try {
            const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(message.media_id);
            if (media) {
              const filePath = path.join(UPLOADS_DIR, media.file_path);
              try { fs.unlinkSync(filePath); } catch (_e) { /* best-effort */ }
              db.prepare('DELETE FROM media WHERE id = ?').run(message.media_id);
            }
          } catch (mediaErr) {
            console.error('Failed to clean up media on REST delete:', mediaErr);
          }
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

// DELETE /api/conversations/:id/clear — clear all messages in a conversation for the current user
router.delete('/:id/clear', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);
    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    // Soft-delete all messages in this conversation for the current user
    const allMessages = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ?'
    ).all(req.params.id);

    const insertDeletion = db.prepare(
      'INSERT OR IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)'
    );

    const clearAll = db.transaction(() => {
      for (const msg of allMessages) {
        insertDeletion.run(msg.id, req.user.id);
      }
    });
    clearAll();

    return res.json({ cleared: true, count: allMessages.length });
  } catch (err) {
    console.error('Clear chat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/conversations/:id/disappear — update disappearing message timer
router.put(
  '/:id/disappear',
  [
    param('id').isUUID(),
    body('disappearAfter')
      .optional({ nullable: true })
      .custom((value) => {
        // Allow null (turn off) or specific timer durations
        if (value === null) return true;
        const validTimers = [0, 300000, 3600000, 86400000, 604800000, 2592000000]; // 5m, 1h, 24h, 7d, 30d
        if (!validTimers.includes(value)) throw new Error('Invalid timer duration');
        return true;
      }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

      const conversation = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

      const { disappearAfter } = req.body;
      const timerValue = (disappearAfter != null && disappearAfter > 0) ? disappearAfter : null;

      db.prepare('UPDATE conversations SET disappear_after = ? WHERE id = ?').run(timerValue, req.params.id);

      // Format a human-readable label for the timer
      const timerLabels = {
        300000: '5 minutes',
        3600000: '1 hour',
        86400000: '24 hours',
        604800000: '7 days',
        2592000000: '30 days',
      };
      const timerLabel = timerValue ? (timerLabels[timerValue] || `${timerValue}ms`) : null;

      // Look up the changer's username for the system message
      const changer = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
      const changerName = changer ? changer.username : 'Someone';
      const systemMessage = timerValue
        ? `${changerName} set messages to disappear after ${timerLabel}`
        : `${changerName} turned off disappearing messages`;

      // Notify all participants in real-time
      const io = req.app.get('io');
      if (io) {
        io.to(req.params.id).emit('conversation_timer_changed', {
          conversationId: req.params.id,
          disappearAfter: timerValue,
          changedBy: req.user.id,
          systemMessage,
        });
      }

      return res.json({
        updated: true,
        disappearAfter: timerValue,
        systemMessage,
      });
    } catch (err) {
      console.error('Update disappear timer error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/conversations/:id/nuke — permanently delete ALL messages + media for both participants
router.delete('/:id/nuke', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);
    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    // Find all messages and their media in this conversation
    const messages = db.prepare(
      'SELECT id, media_id FROM messages WHERE conversation_id = ?'
    ).all(req.params.id);

    // Collect media IDs for cleanup
    const mediaIds = messages.filter(m => m.media_id).map(m => m.media_id);
    const messageIds = messages.map(m => m.id);

    const nukeTransaction = db.transaction(() => {
      // 1. Delete media files from disk and DB
      for (const mediaId of mediaIds) {
        try {
          const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(mediaId);
          if (media) {
            const filePath = path.join(UPLOADS_DIR, media.file_path);
            try { fs.unlinkSync(filePath); } catch (_e) { /* best-effort */ }
            db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);
          }
        } catch (_e) { /* continue cleanup */ }
      }

      // 2. Delete all message_deletions for these messages
      if (messageIds.length > 0) {
        const placeholders = messageIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM message_deletions WHERE message_id IN (${placeholders})`).run(...messageIds);
      }

      // 3. Delete all messages in the conversation
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
    });
    nukeTransaction();

    // Look up the nuker's username for the system message
    const nuker = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
    const nukerName = nuker ? nuker.username : 'Someone';

    // Notify all participants in real-time
    const io = req.app.get('io');
    if (io) {
      io.to(req.params.id).emit('conversation_nuked', {
        conversationId: req.params.id,
        nukedBy: req.user.id,
        nukedByName: nukerName,
        messageCount: messages.length,
      });
    }

    return res.json({
      nuked: true,
      messagesDeleted: messages.length,
      mediaDeleted: mediaIds.length,
    });
  } catch (err) {
    console.error('Nuke chat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
