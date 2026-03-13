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
    const conversations = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at,
             GROUP_CONCAT(u.username) AS participant_usernames,
             GROUP_CONCAT(u.id) AS participant_ids
      FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      JOIN conversation_participants cp2 ON cp2.conversation_id = c.id
        AND cp2.user_id = ?
      JOIN users u ON u.id = cp.user_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all(req.user.id);

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
      return res.status(201).json({ conversation });
    } catch (err) {
      console.error('Create conversation error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/conversations/:id/messages
router.get('/:id/messages', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    const rows = db.prepare(`
      SELECT id, conversation_id, sender_id, ciphertext, iv, version, timestamp
      FROM messages
      WHERE conversation_id = ?
      ORDER BY timestamp ASC
      LIMIT 200
    `).all(req.params.id);

    // Return messages in the canonical EncryptedMessage format
    const messages = rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      timestamp: row.timestamp,
      payload: {
        ciphertext: row.ciphertext,
        iv: row.iv,
        version: row.version,
      },
    }));

    return res.json({ messages });
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

module.exports = router;
