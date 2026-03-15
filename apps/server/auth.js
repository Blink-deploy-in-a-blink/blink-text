'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

if (!process.env.JWT_SECRET) {
  console.warn(
    '[auth] WARNING: JWT_SECRET is not set. Using an insecure default. ' +
    'Set the JWT_SECRET environment variable before deploying.'
  );
}

/**
 * Express middleware that verifies a Bearer JWT in the Authorization header.
 * Attaches the decoded payload to req.user on success.
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

module.exports = { authenticateToken, signToken };
