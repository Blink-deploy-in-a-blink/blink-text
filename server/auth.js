'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

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
 * Signs a JWT payload with a 24-hour expiry.
 * @param {Object} payload
 * @returns {string} signed JWT
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

module.exports = { authenticateToken, signToken };
