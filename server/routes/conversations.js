'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// GET /api/conversations - list user's conversations
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

// POST /api/conversations - create conversation
router.post(
  '/',
  [
    body('type').isIn(['direct', 'group']).withMessage('type must be direct or group'),
    body('participants')
      .isArray({ min: 1 })
      .withMessage('participants must be a non-empty array of user IDs'),
    body('name').optional().isString().trim().isLength({ max: 64 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { type, participants, name } = req.body;

    // Ensure the requesting user is included
    const allParticipants = Array.from(new Set([req.user.id, ...participants]));

    if (type === 'direct' && allParticipants.length !== 2) {
      return res.status(400).json({ error: 'Direct conversation must have exactly 2 participants' });
    }

    try {
      // Check for existing direct conversation between the same two users
      if (type === 'direct') {
        const [userA, userB] = allParticipants;
        const existing = db.prepare(`
          SELECT c.id FROM conversations c
          JOIN conversation_participants cpA ON cpA.conversation_id = c.id AND cpA.user_id = ?
          JOIN conversation_participants cpB ON cpB.conversation_id = c.id AND cpB.user_id = ?
          WHERE c.type = 'direct'
          LIMIT 1
        `).get(userA, userB);

        if (existing) {
          return res.json({ conversation: existing });
        }
      }

      // Verify all participant IDs exist
      for (const uid of allParticipants) {
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        if (!user) {
          return res.status(400).json({ error: `User ${uid} not found` });
        }
      }

      const conversationId = uuidv4();
      const insertConversation = db.prepare(
        'INSERT INTO conversations (id, type, name) VALUES (?, ?, ?)'
      );
      const insertParticipant = db.prepare(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)'
      );

      const createConversation = db.transaction(() => {
        insertConversation.run(conversationId, type, name || null);
        for (const uid of allParticipants) {
          insertParticipant.run(conversationId, uid);
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

// GET /api/conversations/:id/messages - get message history
router.get(
  '/:id/messages',
  [param('id').isUUID()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      // Verify user is a participant
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);

      if (!participant) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }

      const messages = db.prepare(`
        SELECT id, conversation_id, sender_id, ciphertext, iv, timestamp
        FROM messages
        WHERE conversation_id = ?
        ORDER BY timestamp ASC
        LIMIT 200
      `).all(req.params.id);

      return res.json({ messages });
    } catch (err) {
      console.error('Get messages error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/conversations/:id/participants - get participants
router.get(
  '/:id/participants',
  [param('id').isUUID()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);

      if (!participant) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }

      const participants = db.prepare(`
        SELECT u.id, u.username, u.public_key, u.identity_public_key, cp.joined_at
        FROM conversation_participants cp
        JOIN users u ON u.id = cp.user_id
        WHERE cp.conversation_id = ?
      `).all(req.params.id);

      return res.json({ participants });
    } catch (err) {
      console.error('Get participants error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
