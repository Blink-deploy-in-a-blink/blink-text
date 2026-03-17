'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

const VALID_REASONS = ['spam', 'harassment', 'illegal_content', 'impersonation', 'other'];

// POST /api/reports — submit a report against a user/message
router.post(
  '/',
  authenticateToken,
  [
    body('reportedUserId').isString().trim().notEmpty().withMessage('Reported user ID is required'),
    body('reason').isString().isIn(VALID_REASONS).withMessage(`Reason must be one of: ${VALID_REASONS.join(', ')}`),
    body('conversationId').optional().isString().trim(),
    body('messageId').optional().isString().trim(),
    body('details').optional().isString().trim().isLength({ max: 1000 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { reportedUserId, reason, conversationId, messageId, details } = req.body;

    // Cannot report yourself
    if (reportedUserId === req.user.id) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }

    // Verify reported user exists
    const reportedUser = db.prepare('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL').get(reportedUserId);
    if (!reportedUser) {
      return res.status(404).json({ error: 'Reported user not found' });
    }

    // If conversationId provided, verify reporter is a participant
    if (conversationId) {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, req.user.id);
      if (!participant) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }
    }

    try {
      const id = uuidv4();
      db.prepare(
        'INSERT INTO reports (id, reporter_id, reported_user_id, conversation_id, message_id, reason, details) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, req.user.id, reportedUserId, conversationId || null, messageId || null, reason, details || null);

      return res.status(201).json({ message: 'Report submitted', reportId: id });
    } catch (err) {
      console.error('Report submission error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
