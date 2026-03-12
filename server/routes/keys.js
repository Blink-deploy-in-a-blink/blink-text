'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

router.use(authenticateToken);

// GET /api/keys/:userId - get a user's public keys
router.get(
  '/:userId',
  [param('userId').isUUID()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const user = db.prepare(
        'SELECT id, username, public_key, identity_public_key FROM users WHERE id = ?'
      ).get(req.params.userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Parse stored JSON keys back to objects
      return res.json({
        userId: user.id,
        username: user.username,
        public_key: user.public_key ? JSON.parse(user.public_key) : null,
        identity_public_key: user.identity_public_key
          ? JSON.parse(user.identity_public_key)
          : null,
      });
    } catch (err) {
      console.error('Get keys error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/keys - store/update user's public keys
router.post(
  '/',
  [
    body('identity_public_key').isObject().withMessage('identity_public_key must be a JWK object'),
    body('public_key').isObject().withMessage('public_key must be a JWK object'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { identity_public_key, public_key } = req.body;

    try {
      db.prepare(
        'UPDATE users SET identity_public_key = ?, public_key = ? WHERE id = ?'
      ).run(JSON.stringify(identity_public_key), JSON.stringify(public_key), req.user.id);

      return res.json({ success: true });
    } catch (err) {
      console.error('Store keys error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/keys/exchange/:conversationId - get key exchange data for conversation
router.get(
  '/exchange/:conversationId',
  [param('conversationId').isUUID()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      // Verify requester is a participant
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.conversationId, req.user.id);

      if (!participant) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }

      const keyData = db.prepare(
        'SELECT * FROM key_exchange_data WHERE conversation_id = ?'
      ).all(req.params.conversationId);

      return res.json({
        keyExchangeData: keyData.map((row) => ({
          ...row,
          ephemeral_public_key: JSON.parse(row.ephemeral_public_key),
        })),
      });
    } catch (err) {
      console.error('Get key exchange error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/keys/exchange - store ephemeral key for key exchange
router.post(
  '/exchange',
  [
    body('conversation_id').isUUID(),
    body('ephemeral_public_key').isObject().withMessage('ephemeral_public_key must be a JWK object'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { conversation_id, ephemeral_public_key } = req.body;

    try {
      // Verify requester is a participant
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversation_id, req.user.id);

      if (!participant) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }

      // Upsert: remove existing entry for this user+conversation, then insert fresh
      db.prepare(
        'DELETE FROM key_exchange_data WHERE conversation_id = ? AND user_id = ?'
      ).run(conversation_id, req.user.id);

      const id = uuidv4();
      db.prepare(
        'INSERT INTO key_exchange_data (id, conversation_id, user_id, ephemeral_public_key) VALUES (?, ?, ?, ?)'
      ).run(id, conversation_id, req.user.id, JSON.stringify(ephemeral_public_key));

      return res.status(201).json({ success: true, id });
    } catch (err) {
      console.error('Store key exchange error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
