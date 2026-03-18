'use strict';

const express = require('express');
const { param, validationResult } = require('express-validator');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();
router.use(authenticateToken);

// GET /api/blocks — list all users the current user has blocked
router.get('/', (req, res) => {
  try {
    const blocks = db.prepare(`
      SELECT ub.blocked_id, u.username, ub.created_at
      FROM user_blocks ub
      JOIN users u ON u.id = ub.blocked_id
      WHERE ub.blocker_id = ?
      ORDER BY ub.created_at DESC
    `).all(req.user.id);

    return res.json({ blocks });
  } catch (err) {
    console.error('Get blocks error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/blocks/:userId — block a user
router.post(
  '/:userId',
  [param('userId').isString().trim().notEmpty()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const blockedId = req.params.userId;

    if (blockedId === req.user.id) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    // Verify target user exists
    const target = db.prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL').get(blockedId);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    try {
      db.prepare(
        'INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)'
      ).run(req.user.id, blockedId);

      return res.json({ blocked: true });
    } catch (err) {
      console.error('Block user error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/blocks/:userId — unblock a user
router.delete(
  '/:userId',
  [param('userId').isString().trim().notEmpty()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      db.prepare(
        'DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?'
      ).run(req.user.id, req.params.userId);

      return res.json({ unblocked: true });
    } catch (err) {
      console.error('Unblock user error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/blocks/check/:userId — check if a specific user is blocked
router.get(
  '/check/:userId',
  [param('userId').isString().trim().notEmpty()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const block = db.prepare(
        'SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?'
      ).get(req.user.id, req.params.userId);

      return res.json({ blocked: !!block });
    } catch (err) {
      console.error('Check block error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
