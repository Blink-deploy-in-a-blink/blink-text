'use strict';

const express = require('express');
const crypto = require('crypto');
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

// ---------------------------------------------------------------------------
// Proof of Work (PoW) — anti-spam for registration
// ---------------------------------------------------------------------------
// Difficulty: number of leading zero bits required in the SHA-256 hash.
// 18 bits ≈ 1-3 seconds on a modern device, ~30 min for 1000 registrations.
const POW_DIFFICULTY = 18;
const POW_CHALLENGE_TTL_MS = 5 * 60 * 1000; // challenges expire after 5 minutes

// In-memory store of issued challenges. Each challenge can be used exactly once.
// Map<challengeString, { createdAt: number }>
const powChallenges = new Map();

// Clean up expired challenges every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of powChallenges) {
    if (now - val.createdAt > POW_CHALLENGE_TTL_MS) powChallenges.delete(key);
  }
}, 60_000).unref();

/**
 * Verify that SHA-256(challenge + nonce) has at least `difficulty` leading zero bits.
 */
function verifyPoW(challenge, nonce, difficulty) {
  const hash = crypto.createHash('sha256')
    .update(challenge + String(nonce))
    .digest();
  const requiredFullBytes = Math.floor(difficulty / 8);
  for (let i = 0; i < requiredFullBytes; i++) {
    if (hash[i] !== 0) return false;
  }
  const remainingBits = difficulty % 8;
  if (remainingBits > 0) {
    if ((hash[requiredFullBytes] >> (8 - remainingBits)) !== 0) return false;
  }
  return true;
}

// GET /api/auth/pow-challenge — issue a fresh challenge for registration
router.get('/pow-challenge', authLimiter, (_req, res) => {
  const challenge = crypto.randomBytes(32).toString('hex');
  powChallenges.set(challenge, { createdAt: Date.now() });
  return res.json({ challenge, difficulty: POW_DIFFICULTY });
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
    body('powChallenge')
      .isString()
      .notEmpty()
      .withMessage('Proof of work challenge is required'),
    body('powNonce')
      .notEmpty()
      .withMessage('Proof of work solution is required'),
    body('acceptedTerms')
      .equals('true')
      .withMessage('You must accept the Terms of Service and Privacy Policy'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password, powChallenge, powNonce } = req.body;

    // Verify PoW challenge exists and hasn't expired
    const challengeEntry = powChallenges.get(powChallenge);
    if (!challengeEntry) {
      return res.status(400).json({ error: 'Invalid or expired proof-of-work challenge. Please try again.' });
    }
    if (Date.now() - challengeEntry.createdAt > POW_CHALLENGE_TTL_MS) {
      powChallenges.delete(powChallenge);
      return res.status(400).json({ error: 'Proof-of-work challenge expired. Please try again.' });
    }

    // Consume the challenge (one-time use)
    powChallenges.delete(powChallenge);

    // Verify the solution
    if (!verifyPoW(powChallenge, powNonce, POW_DIFFICULTY)) {
      return res.status(400).json({ error: 'Invalid proof-of-work solution.' });
    }

    try {
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        return res.status(409).json({ error: 'Username already taken' });
      }

      const password_hash = await bcrypt.hash(password, 12);
      const id = uuidv4();

      // Capture registration IP for law enforcement compliance
      const registrationIp = req.ip || req.connection?.remoteAddress || null;

      db.prepare(
        'INSERT INTO users (id, username, password_hash, registration_ip) VALUES (?, ?, ?, ?)'
      ).run(id, username, password_hash, registrationIp);

      // Generate a session nonce so only this session is valid.
      // If the user logs in elsewhere, a new nonce is generated and this JWT is invalidated.
      const sessionNonce = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET session_nonce = ? WHERE id = ?').run(sessionNonce, id);

      const token = signToken({ id, username, nonce: sessionNonce });
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

      if (user.deleted_at) {
        return res.status(401).json({ error: 'This account has been deleted' });
      }

      if (user.is_banned) {
        return res.status(403).json({ error: 'This account has been suspended' });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Generate a fresh session nonce — invalidates any previous session immediately.
      // The old JWT will fail nonce checks on the next API call or WebSocket event.
      const sessionNonce = crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE users SET session_nonce = ? WHERE id = ?').run(sessionNonce, user.id);

      const token = signToken({ id: user.id, username: user.username, nonce: sessionNonce });
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

// POST /api/auth/refresh — issue a fresh token while the current one is still valid
router.post('/refresh', authenticateToken, (req, res) => {
  try {
    // Verify user still exists and is not deleted
    const user = db.prepare('SELECT id, username, deleted_at, session_nonce FROM users WHERE id = ?').get(req.user.id);
    if (!user || user.deleted_at) {
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    // Re-use the current session nonce (don't generate a new one — refresh ≠ new login)
    const token = signToken({ id: user.id, username: user.username, nonce: user.session_nonce });
    return res.json({ token });
  } catch (err) {
    console.error('Token refresh error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

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

// DELETE /api/auth/account - soft-delete the user's account
router.delete(
  '/account',
  authenticateToken,
  [
    body('password').isString().notEmpty().withMessage('Password is required to delete account'),
    body('deleteConversations').optional().isBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { password, deleteConversations } = req.body;

    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Incorrect password' });

      const deleteAccount = db.transaction(() => {
        // Soft-delete: mark user as deleted, scramble credentials so they can't log in
        db.prepare(
          'UPDATE users SET deleted_at = unixepoch(), password_hash = ?, username = ? WHERE id = ?'
        ).run('DELETED', `deleted_${user.id.slice(0, 8)}`, req.user.id);

        // Remove devices and key exchange data
        db.prepare('DELETE FROM devices WHERE user_id = ?').run(req.user.id);
        db.prepare('DELETE FROM key_exchange_data WHERE user_id = ?').run(req.user.id);

        if (deleteConversations) {
          // Remove the user from all conversations; CASCADE will clean up
          // For DMs where user is removed, the other person keeps the convo
          db.prepare('DELETE FROM conversation_participants WHERE user_id = ?').run(req.user.id);
        }
      });
      deleteAccount();

      // Notify only users who share a conversation with the deleted user (Issue 5.2)
      const io = req.app.get('io');
      if (io) {
        const peers = db.prepare(`
          SELECT DISTINCT cp2.user_id FROM conversation_participants cp1
          JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
          WHERE cp1.user_id = ? AND cp2.user_id != ?
        `).all(req.user.id, req.user.id);
        for (const peer of peers) {
          io.to(peer.user_id).emit('user_deleted', { userId: req.user.id });
        }
      }

      return res.json({ message: 'Account deleted' });
    } catch (err) {
      console.error('Delete account error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
