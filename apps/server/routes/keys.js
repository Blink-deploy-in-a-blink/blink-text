'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

router.use(authenticateToken);

// GET /api/keys/exchange/:conversationId - get key exchange data for conversation
router.get('/exchange/:conversationId', [param('conversationId').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.conversationId, req.user.id);

    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    const keyData = db.prepare(
      'SELECT * FROM key_exchange_data WHERE conversation_id = ?'
    ).all(req.params.conversationId);

    return res.json({
      keyExchangeData: keyData.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        userId: row.user_id,
        deviceId: row.device_id,
        ephemeralPublicKey: JSON.parse(row.ephemeral_public_key),
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error('Get key exchange error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/keys/exchange - store ephemeral key for key exchange
router.post(
  '/exchange',
  [
    body('conversationId').isUUID(),
    body('deviceId').isUUID().withMessage('deviceId must be a UUID'),
    body('ephemeralPublicKey').isObject().withMessage('ephemeralPublicKey must be a JWK object'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { conversationId, deviceId, ephemeralPublicKey } = req.body;

    try {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, req.user.id);

      if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

      // Verify device belongs to user
      const device = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(deviceId, req.user.id);
      if (!device) return res.status(400).json({ error: 'Device not found or not owned by user' });

      // Upsert: remove ALL existing ephemeral keys for this user+conversation.
      // A user should only have one active ephemeral key per conversation,
      // regardless of which device it came from.  This prevents stale entries
      // from old devices accumulating and confusing peer key selection.
      db.prepare('DELETE FROM key_exchange_data WHERE conversation_id = ? AND user_id = ?').run(conversationId, req.user.id);

      const id = uuidv4();
      db.prepare(
        'INSERT INTO key_exchange_data (id, conversation_id, user_id, device_id, ephemeral_public_key) VALUES (?, ?, ?, ?, ?)'
      ).run(id, conversationId, req.user.id, deviceId, JSON.stringify(ephemeralPublicKey));

      return res.status(201).json({ success: true, id });
    } catch (err) {
      console.error('Store key exchange error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
