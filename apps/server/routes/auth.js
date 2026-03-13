'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { signToken, authenticateToken } = require('../auth');

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// POST /api/auth/register
router.post(
  '/register',
  authLimiter,
  [
    body('username')
      .isString()
      .trim()
      .isLength({ min: 3, max: 32 })
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage('Username must be 3-32 alphanumeric characters or underscores'),
    body('password')
      .isString()
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        return res.status(409).json({ error: 'Username already taken' });
      }

      const password_hash = await bcrypt.hash(password, 12);
      const id = uuidv4();

      db.prepare(
        'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)'
      ).run(id, username, password_hash);

      const token = signToken({ id, username });
      return res.status(201).json({ token, user: { id, username } });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
  authLimiter,
  [
    body('username').isString().trim().notEmpty(),
    body('password').isString().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password } = req.body;

    try {
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = signToken({ id: user.id, username: user.username });
      return res.json({
        token,
        user: { id: user.id, username: user.username },
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// PUT /api/auth/password
router.put(
  '/password',
  authenticateToken,
  [
    body('currentPassword').isString().notEmpty().withMessage('Current password is required'),
    body('newPassword').isString().isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { currentPassword, newPassword } = req.body;

    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

      const newHash = await bcrypt.hash(newPassword, 12);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);

      return res.json({ message: 'Password changed successfully' });
    } catch (err) {
      console.error('Change password error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
