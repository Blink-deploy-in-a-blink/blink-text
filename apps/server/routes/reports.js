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

    // If messageId provided, verify it exists, belongs to the conversation,
    // and was authored by the reported user
    if (messageId) {
      if (!conversationId) {
        return res.status(400).json({ error: 'conversationId is required when reporting a message' });
      }
      const message = db.prepare(
        'SELECT id, conversation_id, sender_id FROM messages WHERE id = ?'
      ).get(messageId);
      if (!message) {
        return res.status(404).json({ error: 'Message not found' });
      }
      if (message.conversation_id !== conversationId) {
        return res.status(400).json({ error: 'Message does not belong to the specified conversation' });
      }
      if (message.sender_id !== reportedUserId) {
        return res.status(400).json({ error: 'Reported user is not the author of the specified message' });
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
