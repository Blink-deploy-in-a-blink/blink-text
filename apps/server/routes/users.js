'use strict';

const express = require('express');
const { query, validationResult } = require('express-validator');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

router.use(authenticateToken);

// GET /api/users/search?q=username
router.get('/search', [
  query('q').isString().trim().isLength({ min: 1, max: 32 }),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const users = db.prepare(
      `SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 20`
    ).all(`%${req.query.q}%`, req.user.id);

    return res.json({ users });
  } catch (err) {
    console.error('Search users error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
