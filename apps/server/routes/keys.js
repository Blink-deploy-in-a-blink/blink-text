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

// ── Prekey Endpoints ──────────────────────────────────────────────────

// POST /api/keys/prekeys - upload signed prekey + one-time prekeys
router.post(
  '/prekeys',
  [
    body('deviceId').isUUID(),
    body('signedPrekey').isObject().withMessage('signedPrekey must be an object with publicKey and signature'),
    body('signedPrekey.publicKey').isObject(),
    body('signedPrekey.signature').isString(),
    body('oneTimePrekeys').isArray({ max: 100 }).withMessage('oneTimePrekeys must be an array (max 100)'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { deviceId, signedPrekey, oneTimePrekeys } = req.body;

    try {
      // Verify device belongs to user
      const device = db.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ?').get(deviceId, req.user.id);
      if (!device) return res.status(400).json({ error: 'Device not found or not owned by user' });

      // Upsert signed prekey: one per device
      db.prepare('DELETE FROM signed_prekeys WHERE user_id = ? AND device_id = ?').run(req.user.id, deviceId);
      const spkId = uuidv4();
      db.prepare(
        'INSERT INTO signed_prekeys (id, user_id, device_id, public_key, signature) VALUES (?, ?, ?, ?, ?)'
      ).run(spkId, req.user.id, deviceId, JSON.stringify(signedPrekey.publicKey), signedPrekey.signature);

      // Insert one-time prekeys
      const insertOtp = db.prepare(
        'INSERT INTO one_time_prekeys (id, user_id, device_id, public_key) VALUES (?, ?, ?, ?)'
      );
      const insertMany = db.transaction((keys) => {
        for (const key of keys) {
          insertOtp.run(uuidv4(), req.user.id, deviceId, JSON.stringify(key));
        }
      });
      insertMany(oneTimePrekeys);

      return res.status(201).json({ success: true, signedPrekeyId: spkId, oneTimeCount: oneTimePrekeys.length });
    } catch (err) {
      console.error('Upload prekeys error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/keys/prekeys/:userId - fetch a prekey bundle for a user (consumes one OTP)
router.get('/prekeys/:userId', [param('userId').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const targetUserId = req.params.userId;

    // Get signed prekey (most recent)
    const signedPrekey = db.prepare(
      'SELECT * FROM signed_prekeys WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(targetUserId);

    if (!signedPrekey) {
      return res.status(404).json({ error: 'No prekey bundle available for this user' });
    }

    // Get and consume one one-time prekey (oldest first, delete after use)
    const otp = db.prepare(
      'SELECT * FROM one_time_prekeys WHERE user_id = ? AND device_id = ? ORDER BY created_at ASC LIMIT 1'
    ).get(targetUserId, signedPrekey.device_id);

    let oneTimePrekey = null;
    if (otp) {
      oneTimePrekey = JSON.parse(otp.public_key);
      // Delete the consumed one-time prekey (single-use)
      db.prepare('DELETE FROM one_time_prekeys WHERE id = ?').run(otp.id);
    }

    // Get the device's identity/ECDH public key
    const device = db.prepare(
      'SELECT identity_public_key, ecdh_public_key FROM devices WHERE id = ?'
    ).get(signedPrekey.device_id);

    return res.json({
      bundle: {
        userId: targetUserId,
        deviceId: signedPrekey.device_id,
        identityKey: device ? JSON.parse(device.identity_public_key) : null,
        signedPrekey: {
          id: signedPrekey.id,
          publicKey: JSON.parse(signedPrekey.public_key),
          signature: signedPrekey.signature,
        },
        oneTimePrekey,
      },
    });
  } catch (err) {
    console.error('Get prekey bundle error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
