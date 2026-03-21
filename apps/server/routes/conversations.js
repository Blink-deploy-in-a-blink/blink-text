'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticateToken, authenticateAnyToken, signGuestToken } = require('../auth');

const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', 'uploads');

const router = express.Router();

const parsedMaxConversations = parseInt(process.env.MAX_CONVERSATIONS_PER_USER, 10);
const MAX_CONVERSATIONS_PER_USER = Number.isInteger(parsedMaxConversations) && parsedMaxConversations > 0
  ? parsedMaxConversations
  : 500;

// ── Slug generator for invite links ──
function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

// ── Enriched conversation SELECT fragment (reused in multiple queries) ──
const ENRICHED_CONV_SELECT = `
  SELECT c.id, c.type, c.name, c.created_at, c.disappear_after,
         c.slug, c.invite_enabled, c.allow_guests, c.max_participants,
         c.expires_at, c.created_by,
         GROUP_CONCAT(DISTINCT COALESCE(
           CASE WHEN u.deleted_at IS NOT NULL THEN 'Deleted User' ELSE u.username END,
           g.display_name,
           'Unknown'
         )) AS participant_usernames,
         GROUP_CONCAT(DISTINCT cp.user_id) AS participant_ids,
         MAX(CASE WHEN u.deleted_at IS NOT NULL AND u.id != ? THEN 1 ELSE 0 END) AS has_deleted_participant
  FROM conversations c
  JOIN conversation_participants cp ON cp.conversation_id = c.id
  LEFT JOIN users u ON u.id = cp.user_id
  LEFT JOIN guest_sessions g ON g.id = cp.user_id
`;

// ── Public route: GET /api/conversations/join/:slug (no auth) ──
// Returns basic room info for the join page. No messages, keys, or participant details.
router.get('/join/:slug', (req, res) => {
  const { slug } = req.params;
  if (!slug || typeof slug !== 'string' || slug.length < 4 || slug.length > 32) {
    return res.status(400).json({ error: 'Invalid room link' });
  }

  try {
    const conv = db.prepare(
      `SELECT c.id, c.name, c.max_participants, c.expires_at, c.invite_enabled, c.allow_guests,
              (c.password_hash IS NOT NULL) AS has_password
       FROM conversations c WHERE c.slug = ?`
    ).get(slug);

    if (!conv) return res.status(404).json({ error: 'Room not found' });
    if (!conv.invite_enabled) return res.status(403).json({ error: 'This room does not accept invites' });

    // Check if expired
    if (conv.expires_at && conv.expires_at <= Date.now()) {
      return res.status(410).json({ error: 'This room has expired' });
    }

    // Count current participants
    const { count: participantCount } = db.prepare(
      'SELECT COUNT(*) as count FROM conversation_participants WHERE conversation_id = ?'
    ).get(conv.id);

    return res.json({
      room: {
        name: conv.name,
        participantCount,
        maxParticipants: conv.max_participants,
        hasPassword: !!conv.has_password,
        expiresAt: conv.expires_at,
        allowGuests: !!conv.allow_guests,
      },
    });
  } catch (err) {
    console.error('Get room info error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PoW for guest joins (same algorithm as auth route) ──
const POW_DIFFICULTY = 18;
const POW_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const joinPowChallenges = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of joinPowChallenges) {
    if (now - val.createdAt > POW_CHALLENGE_TTL_MS) joinPowChallenges.delete(key);
  }
}, 60_000).unref();

function verifyJoinPoW(challenge, nonce, difficulty) {
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

// ── GET /api/conversations/join/:slug/challenge — PoW challenge for guest join ──
router.get('/join/:slug/challenge', (req, res) => {
  const { slug } = req.params;
  if (!slug || typeof slug !== 'string' || slug.length < 4 || slug.length > 32) {
    return res.status(400).json({ error: 'Invalid room link' });
  }

  // Verify the room actually exists and accepts guests before issuing a challenge
  const conv = db.prepare(
    'SELECT id, invite_enabled, allow_guests, expires_at FROM conversations WHERE slug = ?'
  ).get(slug);
  if (!conv || !conv.invite_enabled) {
    return res.status(404).json({ error: 'Room not found' });
  }
  if (conv.expires_at && conv.expires_at <= Date.now()) {
    return res.status(410).json({ error: 'This room has expired' });
  }

  const challenge = crypto.randomBytes(32).toString('hex');
  joinPowChallenges.set(challenge, { createdAt: Date.now() });
  return res.json({ challenge, difficulty: POW_DIFFICULTY });
});

// ── POST /api/conversations/join/:slug — join a room as a guest ──
router.post(
  '/join/:slug',
  [
    body('displayName')
      .isString()
      .trim()
      .isLength({ min: 1, max: 32 })
      .withMessage('Display name must be 1-32 characters'),
    body('powChallenge')
      .isString()
      .notEmpty()
      .withMessage('Proof of work challenge is required'),
    body('powNonce')
      .notEmpty()
      .withMessage('Proof of work solution is required'),
    body('password')
      .optional()
      .isString(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { slug } = req.params;
    if (!slug || typeof slug !== 'string' || slug.length < 4 || slug.length > 32) {
      return res.status(400).json({ error: 'Invalid room link' });
    }

    const { displayName, powChallenge, powNonce, password } = req.body;

    // Verify PoW
    const challengeEntry = joinPowChallenges.get(powChallenge);
    if (!challengeEntry) {
      return res.status(400).json({ error: 'Invalid or expired proof-of-work challenge. Please try again.' });
    }
    if (Date.now() - challengeEntry.createdAt > POW_CHALLENGE_TTL_MS) {
      joinPowChallenges.delete(powChallenge);
      return res.status(400).json({ error: 'Proof-of-work challenge expired. Please try again.' });
    }
    joinPowChallenges.delete(powChallenge);

    if (!verifyJoinPoW(powChallenge, powNonce, POW_DIFFICULTY)) {
      return res.status(400).json({ error: 'Invalid proof-of-work solution.' });
    }

    try {
      const conv = db.prepare(
        `SELECT id, name, invite_enabled, allow_guests, password_hash, max_participants, expires_at
         FROM conversations WHERE slug = ?`
      ).get(slug);

      if (!conv) return res.status(404).json({ error: 'Room not found' });
      if (!conv.invite_enabled) return res.status(403).json({ error: 'This room does not accept invites' });
      if (!conv.allow_guests) return res.status(403).json({ error: 'This room does not allow guest access' });

      // Check expiry
      if (conv.expires_at && conv.expires_at <= Date.now()) {
        return res.status(410).json({ error: 'This room has expired' });
      }

      // Check password
      if (conv.password_hash) {
        const bcrypt = require('bcryptjs');
        if (!password || !bcrypt.compareSync(password, conv.password_hash)) {
          return res.status(403).json({ error: 'Incorrect room password' });
        }
      }

      // Check room capacity
      const { count: participantCount } = db.prepare(
        'SELECT COUNT(*) as count FROM conversation_participants WHERE conversation_id = ?'
      ).get(conv.id);
      if (participantCount >= conv.max_participants) {
        return res.status(409).json({ error: 'Room is full' });
      }

      // Rate limit: basic IP-based guest creation throttle
      // (PoW already provides anti-spam, this is a secondary guard)
      const ipHash = crypto.createHash('sha256')
        .update(req.ip || 'unknown')
        .digest('hex')
        .slice(0, 16);

      // Create guest session
      const guestId = uuidv4();
      const now = Date.now();

      const joinTransaction = db.transaction(() => {
        // Insert guest session
        db.prepare(
          `INSERT INTO guest_sessions (id, conversation_id, display_name, ip_hash, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(guestId, conv.id, displayName, ipHash, now, now);

        // Add as participant
        db.prepare(
          'INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)'
        ).run(conv.id, guestId, 'guest');
      });
      joinTransaction();

      // Sign guest JWT
      const token = signGuestToken({
        guestId,
        conversationId: conv.id,
        displayName,
      });

      // Notify existing participants
      const io = req.app.get('io');
      if (io) {
        io.to(conv.id).emit('user_joined', {
          conversationId: conv.id,
          userId: guestId,
          displayName,
          type: 'guest',
        });
      }

      return res.status(201).json({
        token,
        guestSessionId: guestId,
        conversationId: conv.id,
        conversationName: conv.name,
        expiresAt: conv.expires_at,
      });
    } catch (err) {
      console.error('Guest join error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// All routes below require authentication (registered users OR guests)
router.use(authenticateAnyToken);

// GET /api/conversations
router.get('/', (req, res) => {
  try {
    const conversations = db.prepare(`
      SELECT c.id, c.type, c.name, c.created_at, c.disappear_after,
             c.slug, c.invite_enabled, c.allow_guests, c.max_participants,
             c.expires_at, c.created_by,
             GROUP_CONCAT(DISTINCT COALESCE(
               CASE WHEN u.deleted_at IS NOT NULL THEN 'Deleted User' ELSE u.username END,
               g.display_name,
               'Unknown'
             )) AS participant_usernames,
             GROUP_CONCAT(DISTINCT cp.user_id) AS participant_ids,
             MAX(CASE WHEN u.deleted_at IS NOT NULL AND u.id != ? THEN 1 ELSE 0 END) AS has_deleted_participant
      FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id
      LEFT JOIN users u ON u.id = cp.user_id
      LEFT JOIN guest_sessions g ON g.id = cp.user_id
      WHERE c.id IN (
        SELECT conversation_id FROM conversation_participants WHERE user_id = ?
      )
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all(req.user.id, req.user.id);

    return res.json({ conversations });
  } catch (err) {
    console.error('Get conversations error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/conversations
router.post(
  '/',
  [
    body('type').isIn(['direct_message', 'group_chat']).withMessage('type must be direct_message or group_chat'),
    body('participants').isArray({ min: 0 }).withMessage('participants must be an array of user IDs'),
    body('name').optional().isString().trim().isLength({ max: 64 }),
    body('disappearAfter').optional({ nullable: true }).isInt({ min: 0 }).withMessage('disappearAfter must be a non-negative integer (ms)'),
    // Group/room-specific fields
    body('maxParticipants').optional().isInt({ min: 2, max: 200 }).withMessage('maxParticipants must be 2-200'),
    body('expiresIn').optional({ nullable: true }).isInt({ min: 0 }).withMessage('expiresIn must be a non-negative integer (ms)'),
    body('inviteEnabled').optional().isBoolean(),
    body('allowGuests').optional().isBoolean(),
    body('password').optional({ nullable: true }).isString().isLength({ max: 128 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { type, participants, name, disappearAfter, maxParticipants, expiresIn, inviteEnabled, allowGuests, password } = req.body;
    const allParticipants = Array.from(new Set([req.user.id, ...participants]));

    if (type === 'direct_message' && allParticipants.length !== 2) {
      return res.status(400).json({ error: 'Direct message must have exactly 2 participants' });
    }

    try {
      if (type === 'direct_message') {
        const [userA, userB] = allParticipants;
        const existing = db.prepare(`
          SELECT c.id FROM conversations c
          JOIN conversation_participants cpA ON cpA.conversation_id = c.id AND cpA.user_id = ?
          JOIN conversation_participants cpB ON cpB.conversation_id = c.id AND cpB.user_id = ?
          WHERE c.type = 'direct_message'
          LIMIT 1
        `).get(userA, userB);
        if (existing) {
          // Return enriched conversation data (not just {id}) so the client
          // gets participant_usernames, participant_ids, etc.
          const enriched = db.prepare(`
            SELECT c.id, c.type, c.name, c.created_at, c.disappear_after,
                   c.slug, c.invite_enabled, c.allow_guests, c.max_participants,
                   c.expires_at, c.created_by,
                   GROUP_CONCAT(DISTINCT COALESCE(
                     CASE WHEN u.deleted_at IS NOT NULL THEN 'Deleted User' ELSE u.username END,
                     g.display_name,
                     'Unknown'
                   )) AS participant_usernames,
                   GROUP_CONCAT(DISTINCT cp.user_id) AS participant_ids,
                   MAX(CASE WHEN u.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS has_deleted_participant
            FROM conversations c
            JOIN conversation_participants cp ON cp.conversation_id = c.id
            LEFT JOIN users u ON u.id = cp.user_id
            LEFT JOIN guest_sessions g ON g.id = cp.user_id
            WHERE c.id = ?
            GROUP BY c.id
          `).get(existing.id);
          return res.json({ conversation: enriched || existing });
        }
      }

      for (const uid of allParticipants) {
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
        if (!user) return res.status(400).json({ error: `User ${uid} not found` });
      }

      // Check for blocks between the creator and any participant
      for (const uid of participants) {
        const blocked = db.prepare(
          'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
        ).get(req.user.id, uid, uid, req.user.id);
        if (blocked) {
          return res.status(403).json({ error: 'Cannot create conversation — one of you has blocked the other' });
        }
      }

      // Enforce per-user conversation limit to prevent database exhaustion
      const convCount = db.prepare(
        'SELECT COUNT(*) as count FROM conversation_participants WHERE user_id = ?'
      ).get(req.user.id).count;
      if (convCount >= MAX_CONVERSATIONS_PER_USER) {
        return res.status(400).json({ error: 'Maximum conversation limit reached. Remove some conversations first.' });
      }

      const conversationId = uuidv4();
      // Validate disappearAfter: only allow known timer values (null, 0, or positive integers)
      const validTimers = [null, 0, 300000, 3600000, 86400000, 604800000, 2592000000]; // off, 5m, 1h, 24h, 7d, 30d
      const timerValue = (disappearAfter != null && validTimers.includes(disappearAfter)) ? disappearAfter : null;

      // Group/room-specific fields
      const isGroup = type === 'group_chat';
      const shouldHaveSlug = isGroup && (inviteEnabled || allowGuests);
      const slug = shouldHaveSlug ? generateSlug() : null;
      const maxPart = isGroup ? (maxParticipants || 50) : 2;
      const expiresAt = (isGroup && expiresIn && expiresIn > 0) ? (Date.now() + expiresIn) : null;
      const createdBy = req.user.id;

      // Hash password if provided (for rooms)
      let passwordHash = null;
      if (isGroup && password) {
        const bcrypt = require('bcryptjs');
        passwordHash = bcrypt.hashSync(password, 10);
      }

      const createConversation = db.transaction(() => {
        db.prepare(
          `INSERT INTO conversations
           (id, type, name, disappear_after, slug, invite_enabled, allow_guests, password_hash, max_participants, expires_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          conversationId, type, name || null, timerValue || null,
          slug, inviteEnabled ? 1 : 0, allowGuests ? 1 : 0,
          passwordHash, maxPart, expiresAt, createdBy
        );
        for (const uid of allParticipants) {
          // Creator gets admin role for groups; all others get member
          const role = (isGroup && uid === req.user.id) ? 'admin' : 'member';
          db.prepare(
            'INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)'
          ).run(conversationId, uid, role);
        }
      });
      createConversation();

      const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);

      // Fetch enriched conversation data including participant usernames (Issue 4.3)
      const enrichedConversation = db.prepare(`
        SELECT c.id, c.type, c.name, c.created_at, c.disappear_after,
               c.slug, c.invite_enabled, c.allow_guests, c.max_participants,
               c.expires_at, c.created_by,
               GROUP_CONCAT(DISTINCT COALESCE(
                 CASE WHEN u.deleted_at IS NOT NULL THEN 'Deleted User' ELSE u.username END,
                 g.display_name,
                 'Unknown'
               )) AS participant_usernames,
               GROUP_CONCAT(DISTINCT cp.user_id) AS participant_ids,
               MAX(CASE WHEN u.deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS has_deleted_participant
        FROM conversations c
        JOIN conversation_participants cp ON cp.conversation_id = c.id
        LEFT JOIN users u ON u.id = cp.user_id
        LEFT JOIN guest_sessions g ON g.id = cp.user_id
        WHERE c.id = ?
        GROUP BY c.id
      `).get(conversationId);

      // Notify other participants in real-time
      const io = req.app.get('io');
      if (io) {
        const otherParticipants = allParticipants.filter((uid) => uid !== req.user.id);
        for (const uid of otherParticipants) {
          io.to(uid).emit('new_conversation', { conversation: enrichedConversation || conversation });
        }
      }

      return res.status(201).json({ conversation: enrichedConversation || conversation });
    } catch (err) {
      console.error('Create conversation error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /api/conversations/:id/messages?limit=50&before=<timestamp>
router.get('/:id/messages', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before ? parseInt(req.query.before) : null;

    let rows;
    if (before) {
      // Load older messages before the cursor timestamp
      rows = db.prepare(`
        SELECT id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, edited, timestamp, message_type, media_id, chain_idx, expires_at
        FROM messages
        WHERE conversation_id = ?
          AND id NOT IN (SELECT message_id FROM message_deletions WHERE user_id = ?)
          AND timestamp < ?
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(req.params.id, req.user.id, before, limit);
      // Reverse to get chronological order
      rows.reverse();
    } else {
      // Load the latest messages
      rows = db.prepare(`
        SELECT id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, edited, timestamp, message_type, media_id, chain_idx, expires_at
        FROM messages
        WHERE conversation_id = ?
          AND id NOT IN (SELECT message_id FROM message_deletions WHERE user_id = ?)
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(req.params.id, req.user.id, limit);
      // Reverse to get chronological order
      rows.reverse();
    }

    // Return messages in the canonical EncryptedMessage format
    const messages = rows.map((row) => {
      const payload = {
        ciphertext: row.ciphertext,
        iv: row.iv,
        version: row.version,
      };
      if (row.chain_idx != null) payload.chainIdx = row.chain_idx;
      return {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        timestamp: row.timestamp,
        replyToId: row.reply_to_id || null,
        edited: !!row.edited,
        payload,
        messageType: row.message_type || 'text',
        mediaId: row.media_id || null,
        expiresAt: row.expires_at || null,
      };
    });

    // hasMore: true if we got exactly `limit` rows (more might exist)
    return res.json({ messages, hasMore: rows.length === limit });
  } catch (err) {
    console.error('Get messages error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/conversations/:id/participants
router.get('/:id/participants', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    const participants = db.prepare(`
      SELECT cp.user_id AS id, COALESCE(u.username, g.display_name, 'Unknown') AS username,
             cp.joined_at, cp.role,
             CASE WHEN u.id IS NULL AND g.id IS NOT NULL THEN 1 ELSE 0 END AS is_guest
      FROM conversation_participants cp
      LEFT JOIN users u ON u.id = cp.user_id
      LEFT JOIN guest_sessions g ON g.id = cp.user_id
      WHERE cp.conversation_id = ?
    `).all(req.params.id);

    return res.json({ participants });
  } catch (err) {
    console.error('Get participants error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/conversations/:id/messages/:messageId — edit a message
router.put(
  '/:id/messages/:messageId',
  [
    param('id').isUUID(),
    param('messageId').isUUID(),
    body('payload').isObject().withMessage('payload is required'),
    body('payload.ciphertext').isString().notEmpty(),
    body('payload.iv').isString().notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

      const message = db.prepare(
        'SELECT * FROM messages WHERE id = ? AND conversation_id = ?'
      ).get(req.params.messageId, req.params.id);
      if (!message) return res.status(404).json({ error: 'Message not found' });
      if (message.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });

      const { ciphertext, iv, version } = req.body.payload;
      db.prepare(
        'UPDATE messages SET ciphertext = ?, iv = ?, version = ?, edited = 1 WHERE id = ?'
      ).run(ciphertext, iv, version || 'v1', req.params.messageId);

      return res.json({ edited: true });
    } catch (err) {
      console.error('Edit message error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/conversations/:id/messages/:messageId?mode=for_me|for_everyone
router.delete(
  '/:id/messages/:messageId',
  [
    param('id').isUUID(),
    param('messageId').isUUID(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const mode = req.query.mode || 'for_me';
    if (!['for_me', 'for_everyone'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be for_me or for_everyone' });
    }

    try {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

      const message = db.prepare(
        'SELECT * FROM messages WHERE id = ? AND conversation_id = ?'
      ).get(req.params.messageId, req.params.id);
      if (!message) return res.status(404).json({ error: 'Message not found' });

      if (mode === 'for_everyone') {
        if (message.sender_id !== req.user.id) {
          return res.status(403).json({ error: 'You can only delete your own messages for everyone' });
        }

        // Clean up associated media file from disk and DB if present
        if (message.media_id) {
          try {
            const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(message.media_id);
            if (media) {
              const filePath = path.join(UPLOADS_DIR, media.file_path);
              try { fs.unlinkSync(filePath); } catch (_e) { /* best-effort */ }
              db.prepare('DELETE FROM media WHERE id = ?').run(message.media_id);
            }
          } catch (mediaErr) {
            console.error('Failed to clean up media on REST delete:', mediaErr);
          }
        }

        db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.messageId);
      } else {
        db.prepare(
          'INSERT OR IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)'
        ).run(req.params.messageId, req.user.id);
      }

      return res.json({ deleted: true, mode });
    } catch (err) {
      console.error('Delete message error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/conversations/:id/clear — clear all messages in a conversation for the current user
router.delete('/:id/clear', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);
    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    // Soft-delete all messages in this conversation for the current user
    const allMessages = db.prepare(
      'SELECT id FROM messages WHERE conversation_id = ?'
    ).all(req.params.id);

    const insertDeletion = db.prepare(
      'INSERT OR IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)'
    );

    const clearAll = db.transaction(() => {
      for (const msg of allMessages) {
        insertDeletion.run(msg.id, req.user.id);
      }
    });
    clearAll();

    return res.json({ cleared: true, count: allMessages.length });
  } catch (err) {
    console.error('Clear chat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/conversations/:id/disappear — update disappearing message timer
router.put(
  '/:id/disappear',
  [
    param('id').isUUID(),
    body('disappearAfter')
      .optional({ nullable: true })
      .custom((value) => {
        // Allow null (turn off) or specific timer durations
        if (value === null) return true;
        const validTimers = [0, 300000, 3600000, 86400000, 604800000, 2592000000]; // 5m, 1h, 24h, 7d, 30d
        if (!validTimers.includes(value)) throw new Error('Invalid timer duration');
        return true;
      }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

      const conversation = db.prepare('SELECT id FROM conversations WHERE id = ?').get(req.params.id);
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

      const { disappearAfter } = req.body;
      const timerValue = (disappearAfter != null && disappearAfter > 0) ? disappearAfter : null;

      db.prepare('UPDATE conversations SET disappear_after = ? WHERE id = ?').run(timerValue, req.params.id);

      // Format a human-readable label for the timer
      const timerLabels = {
        300000: '5 minutes',
        3600000: '1 hour',
        86400000: '24 hours',
        604800000: '7 days',
        2592000000: '30 days',
      };
      const timerLabel = timerValue ? (timerLabels[timerValue] || `${timerValue}ms`) : null;

      // Look up the changer's username for the system message
      const changer = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
      const changerName = changer ? changer.username : 'Someone';
      const systemMessage = timerValue
        ? `${changerName} set messages to disappear after ${timerLabel}`
        : `${changerName} turned off disappearing messages`;

      // Notify all participants in real-time
      const io = req.app.get('io');
      if (io) {
        io.to(req.params.id).emit('conversation_timer_changed', {
          conversationId: req.params.id,
          disappearAfter: timerValue,
          changedBy: req.user.id,
          systemMessage,
        });
      }

      return res.json({
        updated: true,
        disappearAfter: timerValue,
        systemMessage,
      });
    } catch (err) {
      console.error('Update disappear timer error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /api/conversations/:id/nuke — permanently delete ALL messages + media for both participants
router.delete('/:id/nuke', [param('id').isUUID()], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);
    if (!participant) return res.status(403).json({ error: 'Not a participant in this conversation' });

    // Find all messages and their media in this conversation
    const messages = db.prepare(
      'SELECT id, media_id FROM messages WHERE conversation_id = ?'
    ).all(req.params.id);

    // Collect media IDs for cleanup
    const mediaIds = messages.filter(m => m.media_id).map(m => m.media_id);
    const messageIds = messages.map(m => m.id);

    const nukeTransaction = db.transaction(() => {
      // 1. Delete media files from disk and DB
      for (const mediaId of mediaIds) {
        try {
          const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(mediaId);
          if (media) {
            const filePath = path.join(UPLOADS_DIR, media.file_path);
            try { fs.unlinkSync(filePath); } catch (_e) { /* best-effort */ }
            db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);
          }
        } catch (_e) { /* continue cleanup */ }
      }

      // 2. Delete all message_deletions for these messages
      if (messageIds.length > 0) {
        const placeholders = messageIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM message_deletions WHERE message_id IN (${placeholders})`).run(...messageIds);
      }

      // 3. Delete all messages in the conversation
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(req.params.id);
    });
    nukeTransaction();

    // Look up the nuker's username for the system message
    const nuker = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id);
    const nukerName = nuker ? nuker.username : 'Someone';

    // Notify all participants in real-time
    const io = req.app.get('io');
    if (io) {
      io.to(req.params.id).emit('conversation_nuked', {
        conversationId: req.params.id,
        nukedBy: req.user.id,
        nukedByName: nukerName,
        messageCount: messages.length,
      });
    }

    return res.json({
      nuked: true,
      messagesDeleted: messages.length,
      mediaDeleted: mediaIds.length,
    });
  } catch (err) {
    console.error('Nuke chat error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/conversations/:id/invite — enable/disable/regenerate invite link ──
router.put(
  '/:id/invite',
  [
    param('id').isUUID(),
    body('enabled').isBoolean().withMessage('enabled must be a boolean'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      // Only admins can manage invite links
      const participantRow = db.prepare(
        'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participantRow) return res.status(403).json({ error: 'Not a participant' });
      if (participantRow.role !== 'admin') return res.status(403).json({ error: 'Only admins can manage invite links' });

      const conv = db.prepare('SELECT id, type, slug FROM conversations WHERE id = ?').get(req.params.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      if (conv.type !== 'group_chat') return res.status(400).json({ error: 'Invite links are only for group conversations' });

      const { enabled } = req.body;

      if (enabled) {
        // Reuse existing slug if one exists; only generate a new one if there isn't one
        const slug = conv.slug || generateSlug();
        db.prepare('UPDATE conversations SET invite_enabled = 1, slug = ? WHERE id = ?').run(slug, req.params.id);
        return res.json({ inviteEnabled: true, slug });
      } else {
        db.prepare('UPDATE conversations SET invite_enabled = 0 WHERE id = ?').run(req.params.id);
        return res.json({ inviteEnabled: false, slug: conv.slug });
      }
    } catch (err) {
      console.error('Update invite error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── PUT /api/conversations/:id/settings — update group/room settings (admin only) ──
router.put(
  '/:id/settings',
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().isLength({ min: 1, max: 64 }),
    body('maxParticipants').optional().isInt({ min: 2, max: 200 }),
    body('allowGuests').optional().isBoolean(),
    body('password').optional({ nullable: true }).isString().isLength({ max: 128 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const participantRow = db.prepare(
        'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participantRow) return res.status(403).json({ error: 'Not a participant' });
      if (participantRow.role !== 'admin') return res.status(403).json({ error: 'Only admins can change settings' });

      const conv = db.prepare('SELECT id, type FROM conversations WHERE id = ?').get(req.params.id);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });
      if (conv.type !== 'group_chat') return res.status(400).json({ error: 'Settings are only for group conversations' });

      const updates = [];
      const params = [];

      if (req.body.name !== undefined) {
        updates.push('name = ?');
        params.push(req.body.name);
      }
      if (req.body.maxParticipants !== undefined) {
        updates.push('max_participants = ?');
        params.push(req.body.maxParticipants);
      }
      if (req.body.allowGuests !== undefined) {
        updates.push('allow_guests = ?');
        params.push(req.body.allowGuests ? 1 : 0);
      }
      if (req.body.password !== undefined) {
        if (req.body.password === null) {
          updates.push('password_hash = NULL');
        } else {
          const bcrypt = require('bcryptjs');
          updates.push('password_hash = ?');
          params.push(bcrypt.hashSync(req.body.password, 10));
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No settings to update' });
      }

      params.push(req.params.id);
      db.prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      // Notify participants of settings change
      const io = req.app.get('io');
      if (io) {
        io.to(req.params.id).emit('conversation_settings_changed', {
          conversationId: req.params.id,
          changedBy: req.user.id,
        });
      }

      return res.json({ updated: true });
    } catch (err) {
      console.error('Update settings error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/conversations/:id/kick — remove a member (admin only) ──
router.post(
  '/:id/kick',
  [
    param('id').isUUID(),
    body('userId').isString().notEmpty().withMessage('userId is required'),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const participantRow = db.prepare(
        'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, req.user.id);
      if (!participantRow) return res.status(403).json({ error: 'Not a participant' });
      if (participantRow.role !== 'admin') return res.status(403).json({ error: 'Only admins can kick members' });

      const { userId } = req.body;

      // Cannot kick yourself
      if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot kick yourself' });
      }

      // Verify target is a participant
      const target = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(req.params.id, userId);
      if (!target) return res.status(404).json({ error: 'User is not a participant' });

      const kickTransaction = db.transaction(() => {
        // Remove from participants
        db.prepare(
          'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
        ).run(req.params.id, userId);

        // Delete their sender keys
        db.prepare(
          'DELETE FROM group_sender_keys WHERE conversation_id = ? AND sender_user_id = ?'
        ).run(req.params.id, userId);

        // Also delete copies addressed to them
        db.prepare(
          'DELETE FROM group_sender_keys WHERE conversation_id = ? AND recipient_user_id = ?'
        ).run(req.params.id, userId);

        // If guest, mark as kicked
        db.prepare(
          'UPDATE guest_sessions SET is_kicked = 1 WHERE conversation_id = ? AND id = ?'
        ).run(req.params.id, userId);
      });
      kickTransaction();

      // Notify the room
      const io = req.app.get('io');
      if (io) {
        io.to(req.params.id).emit('user_kicked', {
          conversationId: req.params.id,
          kickedUserId: userId,
          kickedBy: req.user.id,
        });
        // Also notify the kicked user directly
        io.to(userId).emit('you_were_kicked', {
          conversationId: req.params.id,
          kickedBy: req.user.id,
        });
      }

      return res.json({ kicked: true, userId });
    } catch (err) {
      console.error('Kick member error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
