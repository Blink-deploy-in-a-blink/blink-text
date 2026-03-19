'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

const parsedMaxDevices = parseInt(process.env.MAX_DEVICES_PER_USER, 10);
const MAX_DEVICES_PER_USER = Number.isInteger(parsedMaxDevices) && parsedMaxDevices > 0
  ? parsedMaxDevices
  : 5;

router.use(authenticateToken);

// POST /api/devices - register a new device for the authenticated user
router.post(
  '/',
  [
    body('identityPublicKey').isObject().withMessage('identityPublicKey must be a JWK object'),
    body('ecdhPublicKey').isObject().withMessage('ecdhPublicKey must be a JWK object'),
    body('deviceName').optional().isString().trim().isLength({ max: 64 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { identityPublicKey, ecdhPublicKey, deviceName } = req.body;

    try {
      // Enforce per-user device limit to prevent database exhaustion
      const deviceCount = db.prepare('SELECT COUNT(*) as count FROM devices WHERE user_id = ?').get(req.user.id).count;
      if (deviceCount >= MAX_DEVICES_PER_USER) {
        return res.status(400).json({ error: `Maximum device limit (${MAX_DEVICES_PER_USER}) reached. Remove a device first.` });
      }

      const id = uuidv4();
      db.prepare(
        'INSERT INTO devices (id, user_id, device_name, identity_public_key, ecdh_public_key) VALUES (?, ?, ?, ?, ?)'
      ).run(id, req.user.id, deviceName || null, JSON.stringify(identityPublicKey), JSON.stringify(ecdhPublicKey));

      return res.status(201).json({ device: { id, userId: req.user.id, deviceName: deviceName || null } });
    } catch (err) {
      console.error('Register device error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/devices/:userId - get all devices for a user
router.get('/:userId', [param('userId').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const devices = db.prepare(
      'SELECT id, user_id, device_name, identity_public_key, ecdh_public_key, created_at FROM devices WHERE user_id = ?'
    ).all(req.params.userId);

    return res.json({
      devices: devices.map((d) => ({
        id: d.id,
        userId: d.user_id,
        deviceName: d.device_name,
        identityPublicKey: JSON.parse(d.identity_public_key),
        ecdhPublicKey: JSON.parse(d.ecdh_public_key),
        createdAt: d.created_at,
      })),
    });
  } catch (err) {
    console.error('Get devices error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
