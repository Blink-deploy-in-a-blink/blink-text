'use strict';

const express = require('express');
const { param, body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

router.use(authenticateToken);

// ── GET /api/group-keys/:conversationId ──
// Returns all encrypted sender key copies addressed to the current user.
router.get(
  '/:conversationId',
  [param('conversationId').isUUID()],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { conversationId } = req.params;

    try {
      // Verify the requester is a participant
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, req.user.id);
      if (!participant) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }

      const keys = db.prepare(
        `SELECT sender_user_id, encrypted_sender_key, iv, key_generation, signature, created_at
         FROM group_sender_keys
         WHERE conversation_id = ? AND recipient_user_id = ?
         ORDER BY key_generation DESC`
      ).all(conversationId, req.user.id);

      return res.json({
        senderKeys: keys.map((k) => ({
          senderUserId: k.sender_user_id,
          encryptedSenderKey: k.encrypted_sender_key,
          iv: k.iv,
          keyGeneration: k.key_generation,
          signature: k.signature,
          createdAt: k.created_at,
        })),
      });
    } catch (err) {
      console.error('Get sender keys error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/group-keys/:conversationId ──
// Store encrypted sender key copies for each recipient.
// Body: { keys: [{ recipientUserId, encryptedSenderKey, iv, keyGeneration, signature }] }
router.post(
  '/:conversationId',
  [
    param('conversationId').isUUID(),
    body('keys').isArray({ min: 1, max: 50 }).withMessage('keys must be an array (1-50 items)'),
    body('keys.*.recipientUserId').isString().notEmpty(),
    body('keys.*.encryptedSenderKey').isString().notEmpty(),
    body('keys.*.iv').isString().notEmpty(),
    body('keys.*.keyGeneration').isInt({ min: 0 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { conversationId } = req.params;
    const { keys } = req.body;

    try {
      // Verify sender is a participant
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, req.user.id);
      if (!participant) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }

      // Verify the conversation is a group_chat
      const conv = db.prepare('SELECT type FROM conversations WHERE id = ?').get(conversationId);
      if (!conv || conv.type !== 'group_chat') {
        return res.status(400).json({ error: 'Sender keys are only for group conversations' });
      }

      // Verify each recipient is also a participant
      const checkParticipant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      );
      for (const key of keys) {
        if (!checkParticipant.get(conversationId, key.recipientUserId)) {
          return res.status(400).json({ error: `Recipient ${key.recipientUserId} is not a participant` });
        }
      }

      const insertKey = db.prepare(
        `INSERT INTO group_sender_keys
         (id, conversation_id, sender_user_id, recipient_user_id, encrypted_sender_key, iv, key_generation, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // Delete any older copies from this sender to these recipients at the same or older generation,
      // then insert new copies. This handles key rotation cleanly.
      const deleteOld = db.prepare(
        `DELETE FROM group_sender_keys
         WHERE conversation_id = ? AND sender_user_id = ? AND recipient_user_id = ? AND key_generation <= ?`
      );

      const storeTransaction = db.transaction(() => {
        for (const key of keys) {
          deleteOld.run(conversationId, req.user.id, key.recipientUserId, key.keyGeneration);
          insertKey.run(
            uuidv4(),
            conversationId,
            req.user.id,
            key.recipientUserId,
            key.encryptedSenderKey,
            key.iv,
            key.keyGeneration,
            key.signature || null
          );
        }
      });
      storeTransaction();

      return res.status(201).json({ success: true, stored: keys.length });
    } catch (err) {
      console.error('Store sender keys error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── DELETE /api/group-keys/:conversationId/:senderUserId ──
// Delete all sender key copies from a specific sender (used during key rotation on member removal).
router.delete(
  '/:conversationId/:senderUserId',
  [
    param('conversationId').isUUID(),
    param('senderUserId').isString().notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { conversationId, senderUserId } = req.params;

    try {
      // Only the admin of the conversation or the sender themselves can delete sender keys
      const participantRow = db.prepare(
        'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, req.user.id);
      if (!participantRow) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }

      const isAdmin = participantRow.role === 'admin';
      const isSelf = req.user.id === senderUserId;

      if (!isAdmin && !isSelf) {
        return res.status(403).json({ error: 'Only admins or the key owner can delete sender keys' });
      }

      const result = db.prepare(
        'DELETE FROM group_sender_keys WHERE conversation_id = ? AND sender_user_id = ?'
      ).run(conversationId, senderUserId);

      return res.json({ deleted: true, count: result.changes });
    } catch (err) {
      console.error('Delete sender keys error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
