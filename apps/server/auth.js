'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error(
    '[FATAL] JWT_SECRET must be set via environment variable and be at least 32 characters. Exiting.'
  );
  process.exit(1);
}

/**
 * Express middleware that verifies a Bearer JWT in the Authorization header.
 * Attaches the decoded payload to req.user on success.
 * Also checks the database for banned/deleted accounts so bans take effect immediately,
 * not just at token expiry.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Check ban/deletion status in the DB so bans are enforced immediately,
    // even if the JWT hasn't expired yet.
    const db = require('./db');
    const dbUser = db.prepare('SELECT is_banned, deleted_at, session_nonce FROM users WHERE id = ?').get(user.id);
    if (!dbUser) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (dbUser.is_banned) {
      return res.status(403).json({ error: 'This account has been suspended' });
    }
    if (dbUser.deleted_at) {
      return res.status(401).json({ error: 'This account has been deleted' });
    }

    // Single-session enforcement: if the JWT's nonce doesn't match the DB,
    // the user logged in from another device and this session is stale.
    if (dbUser.session_nonce && user.nonce !== dbUser.session_nonce) {
      return res.status(401).json({
        error: 'Session expired — you signed in on another device',
        reason: 'session_expired',
      });
    }

    req.user = user;
    next();
  });
}

/**
 * Signs a JWT payload with a 30-day expiry.
 * Crypto keys (ephemeral ECDH keys, device ID) are preserved across sessions
 * so old messages remain decryptable after re-login.  Only an explicit sign-out
 * wipes those keys.  The long-lived token avoids forcing re-login and losing
 * decryption ability.
 * @param {Object} payload
 * @returns {string} signed JWT
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

/**
 * Signs a short-lived guest JWT (24h).
 * Guest tokens carry: { guestId, conversationId, displayName, type: 'guest' }
 */
function signGuestToken(payload) {
  return jwt.sign({ ...payload, type: 'guest' }, JWT_SECRET, { expiresIn: '24h' });
}

/**
 * Express middleware that authenticates either a registered user JWT or a guest JWT.
 * Sets req.user with a `type` field ('registered' or 'guest').
 *
 * For registered users: same checks as authenticateToken (banned, deleted, nonce).
 * For guests: checks guest_sessions table, verifies not kicked.
 */
function authenticateAnyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    const db = require('./db');

    if (decoded.type === 'guest') {
      // Guest token — validate against guest_sessions
      const guestSession = db.prepare(
        'SELECT id, conversation_id, display_name, is_kicked FROM guest_sessions WHERE id = ?'
      ).get(decoded.guestId);

      if (!guestSession) {
        return res.status(401).json({ error: 'Guest session not found or expired' });
      }
      if (guestSession.is_kicked) {
        return res.status(403).json({ error: 'You have been removed from this room' });
      }

      // Update last_seen_at
      db.prepare('UPDATE guest_sessions SET last_seen_at = ? WHERE id = ?')
        .run(Date.now(), guestSession.id);

      req.user = {
        id: guestSession.id,
        displayName: guestSession.display_name,
        conversationId: guestSession.conversation_id,
        type: 'guest',
      };
      return next();
    }

    // Registered user token — same as authenticateToken
    const dbUser = db.prepare('SELECT is_banned, deleted_at, session_nonce FROM users WHERE id = ?').get(decoded.id);
    if (!dbUser) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (dbUser.is_banned) {
      return res.status(403).json({ error: 'This account has been suspended' });
    }
    if (dbUser.deleted_at) {
      return res.status(401).json({ error: 'This account has been deleted' });
    }
    if (dbUser.session_nonce && decoded.nonce !== dbUser.session_nonce) {
      return res.status(401).json({
        error: 'Session expired — you signed in on another device',
        reason: 'session_expired',
      });
    }

    req.user = { ...decoded, type: 'registered' };
    next();
  });
}

module.exports = { authenticateToken, authenticateAnyToken, signToken, signGuestToken };
