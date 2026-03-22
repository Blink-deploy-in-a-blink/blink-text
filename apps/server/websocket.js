'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { v4: uuidv4, validate: uuidValidate } = require('uuid');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { validateEncryptedMessage, validateKeyExchange } = require('@blink-text/shared');

const JWT_SECRET = process.env.JWT_SECRET; // validated at startup by auth.js
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, 'uploads');

// WebSocket rate limiting: max messages per window per user
const WS_RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const WS_RATE_LIMIT_MAX = 30;           // max 30 messages per window

// Max ciphertext length (~24 KB of plaintext after base64 encoding)
const MAX_CIPHERTEXT_LENGTH = 32768;

/**
 * Simple in-memory rate limiter for WebSocket events.
 * Returns true if the event should be allowed, false if rate-limited.
 * Periodically cleans up expired buckets to avoid unbounded memory growth.
 */
function createWsRateLimiter() {
  const buckets = new Map(); // userId -> { count, resetAt }
  // Clean up expired buckets every 60 seconds
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }, 60_000);
  cleanupInterval.unref(); // don't keep the process alive for cleanup

  return function isAllowed(userId) {
    const now = Date.now();
    let bucket = buckets.get(userId);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + WS_RATE_LIMIT_WINDOW_MS };
      buckets.set(userId, bucket);
    }
    bucket.count++;
    return bucket.count <= WS_RATE_LIMIT_MAX;
  };
}

const ALLOWED_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

// Prepared statements for reactions (defined once, reused across all connections)
const stmtGetMsgConversation = db.prepare('SELECT conversation_id FROM messages WHERE id = ?');
const stmtIsParticipant = db.prepare(
  'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
);
const stmtInsertReaction = db.prepare(
  'INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)'
);
const stmtDeleteReaction = db.prepare(
  'DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
);
// One reaction per user: fetch & delete any existing reaction regardless of emoji
const stmtGetUserReaction = db.prepare(
  'SELECT emoji FROM reactions WHERE message_id = ? AND user_id = ?'
);
const stmtDeleteReactionByUser = db.prepare(
  'DELETE FROM reactions WHERE message_id = ? AND user_id = ?'
);

/**
 * Registers all Socket.io event handlers on the given io instance.
 * @param {import('socket.io').Server} io
 */
function registerSocketHandlers(io) {
  const wsRateCheck = createWsRateLimiter();

  // ── Disappearing messages: cleanup interval (every 30s) ──
  // Deletes expired messages + associated media files from disk, then notifies clients.
  const expiryCleanupInterval = setInterval(() => {
    try {
      const now = Date.now();
      // Find expired messages grouped by conversation
      const expired = db.prepare(
        'SELECT id, conversation_id, media_id FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?'
      ).all(now);

      if (expired.length === 0) return;

      // Group by conversation for batched socket events
      const byConversation = {};
      for (const msg of expired) {
        if (!byConversation[msg.conversation_id]) byConversation[msg.conversation_id] = [];
        byConversation[msg.conversation_id].push(msg);
      }

      // Delete media files from disk + DB, then delete messages
      const deleteMedia = db.prepare('DELETE FROM media WHERE id = ?');
      const deleteMessage = db.prepare('DELETE FROM messages WHERE id = ?');
      const deleteMessageDeletions = db.prepare('DELETE FROM message_deletions WHERE message_id = ?');

      const cleanupTransaction = db.transaction(() => {
        for (const msg of expired) {
          // Clean up media file if present
          if (msg.media_id) {
            try {
              const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(msg.media_id);
              if (media) {
                const filePath = path.join(UPLOADS_DIR, media.file_path);
                try { fs.unlinkSync(filePath); } catch (_e) { /* best-effort */ }
                deleteMedia.run(msg.media_id);
              }
            } catch (_e) { /* continue cleanup */ }
          }
          deleteMessageDeletions.run(msg.id);
          deleteMessage.run(msg.id);
        }
      });
      cleanupTransaction();

      // Notify connected clients per conversation
      for (const [conversationId, msgs] of Object.entries(byConversation)) {
        io.to(conversationId).emit('messages_expired', {
          conversationId,
          messageIds: msgs.map(m => m.id),
        });
      }

      if (expired.length > 0) {
        console.log(`[expiry] Cleaned up ${expired.length} expired message(s)`);
      }

      // ── Conversation expiry: clean up expired rooms/groups ──
      const expiredConvs = db.prepare(
        "SELECT id FROM conversations WHERE expires_at IS NOT NULL AND expires_at <= ?"
      ).all(now);

      if (expiredConvs.length > 0) {
        const deleteConvMessages = db.prepare('DELETE FROM messages WHERE conversation_id = ?');
        const deleteConvParticipants = db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ?');
        const deleteConvSenderKeys = db.prepare('DELETE FROM group_sender_keys WHERE conversation_id = ?');
        const deleteConvPairwiseKeys = db.prepare('DELETE FROM group_pairwise_keys WHERE conversation_id = ?');
        const deleteConvGuestSessions = db.prepare('DELETE FROM guest_sessions WHERE conversation_id = ?');
        const deleteConv = db.prepare('DELETE FROM conversations WHERE id = ?');

        const convCleanupTx = db.transaction(() => {
          for (const conv of expiredConvs) {
            // Clean up media files for this conversation's messages
            const mediaMessages = db.prepare(
              'SELECT m.media_id FROM messages m WHERE m.conversation_id = ? AND m.media_id IS NOT NULL'
            ).all(conv.id);
            for (const mm of mediaMessages) {
              try {
                const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(mm.media_id);
                if (media) {
                  const filePath = path.join(UPLOADS_DIR, media.file_path);
                  try { fs.unlinkSync(filePath); } catch (_e) { /* best-effort */ }
                  db.prepare('DELETE FROM media WHERE id = ?').run(mm.media_id);
                }
              } catch (_e) { /* continue */ }
            }

            deleteConvMessages.run(conv.id);
            deleteConvSenderKeys.run(conv.id);
            deleteConvPairwiseKeys.run(conv.id);
            deleteConvGuestSessions.run(conv.id);
            deleteConvParticipants.run(conv.id);
            deleteConv.run(conv.id);

            // Notify connected clients that the conversation has expired
            io.to(conv.id).emit('conversation_expired', { conversationId: conv.id });
          }
        });
        convCleanupTx();

        console.log(`[expiry] Cleaned up ${expiredConvs.length} expired conversation(s)`);
      }

      // ── Stale guest session cleanup: remove guests not seen for 24h ──
      const GUEST_STALE_MS = 24 * 60 * 60 * 1000;
      const staleGuests = db.prepare(
        'SELECT id, conversation_id FROM guest_sessions WHERE last_seen_at < ? AND is_kicked = 0'
      ).all(now - GUEST_STALE_MS);

      if (staleGuests.length > 0) {
        const deleteGuestSession = db.prepare('DELETE FROM guest_sessions WHERE id = ?');
        const deleteGuestParticipant = db.prepare(
          'DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
        );
        const deleteGuestSenderKeys = db.prepare(
          'DELETE FROM group_sender_keys WHERE conversation_id = ? AND (sender_user_id = ? OR recipient_user_id = ?)'
        );
        const deleteGuestPairwiseKeys = db.prepare(
          'DELETE FROM group_pairwise_keys WHERE conversation_id = ? AND (user_id = ? OR peer_user_id = ?)'
        );

        const guestCleanupTx = db.transaction(() => {
          for (const guest of staleGuests) {
            deleteGuestSenderKeys.run(guest.conversation_id, guest.id, guest.id);
            deleteGuestPairwiseKeys.run(guest.conversation_id, guest.id, guest.id);
            deleteGuestParticipant.run(guest.conversation_id, guest.id);
            deleteGuestSession.run(guest.id);
          }
        });
        guestCleanupTx();

        console.log(`[expiry] Cleaned up ${staleGuests.length} stale guest session(s)`);
      }
    } catch (err) {
      console.error('[expiry] Cleanup error:', err);
    }
  }, 30_000); // every 30 seconds
  expiryCleanupInterval.unref();

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication token required'));
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) return next(new Error('Invalid or expired token'));

      // ── Guest token ──
      if (decoded.type === 'guest') {
        const guestSession = db.prepare(
          'SELECT id, conversation_id, display_name, is_kicked FROM guest_sessions WHERE id = ?'
        ).get(decoded.guestId);

        if (!guestSession) return next(new Error('Guest session not found'));
        if (guestSession.is_kicked) return next(new Error('You have been removed from this room'));

        // Update last_seen
        db.prepare('UPDATE guest_sessions SET last_seen_at = ? WHERE id = ?')
          .run(Date.now(), guestSession.id);

        socket.user = {
          id: guestSession.id,
          username: guestSession.display_name,
          displayName: guestSession.display_name,
          conversationId: guestSession.conversation_id,
          type: 'guest',
        };
        return next();
      }

      // ── Registered user token ──
      // Check ban/deletion status in DB so bans take effect immediately,
      // even if the JWT hasn't expired yet.
      const dbUser = db.prepare('SELECT is_banned, deleted_at, session_nonce FROM users WHERE id = ?').get(decoded.id);
      if (!dbUser) return next(new Error('User not found'));
      if (dbUser.is_banned) return next(new Error('Account suspended'));
      if (dbUser.deleted_at) return next(new Error('Account deleted'));

      // Single-session enforcement: reject if nonce doesn't match
      if (dbUser.session_nonce && decoded.nonce !== dbUser.session_nonce) {
        return next(new Error('session_expired'));
      }

      socket.user = { ...decoded, type: 'registered' };
      next();
    });
  });

  io.on('connection', (socket) => {
    const { id: userId, username, type: userType } = socket.user;
    console.log(`[WS] ${userType === 'guest' ? 'Guest' : 'User'} connected: ${username} (${userId})`);

    // Join a personal room so we can send events directly to this user
    socket.join(userId);

    // Guests auto-join their specific conversation room only
    if (userType === 'guest' && socket.user.conversationId) {
      socket.join(socket.user.conversationId);
    }

    // Emit presence events only to users who share at least one conversation (Issue 5.1)
    const peers = db.prepare(`
      SELECT DISTINCT cp2.user_id FROM conversation_participants cp1
      JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
      WHERE cp1.user_id = ? AND cp2.user_id != ?
    `).all(userId, userId);
    for (const peer of peers) {
      io.to(peer.user_id).emit('user_connected', { userId, username });
    }

    socket.on('join_conversation', ({ conversationId }) => {
      if (!conversationId || typeof conversationId !== 'string') return;

      // Guests can only join their assigned conversation
      if (userType === 'guest' && conversationId !== socket.user.conversationId) {
        socket.emit('error', { message: 'Guests can only join their assigned room' });
        return;
      }

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);

      if (!participant) {
        socket.emit('error', { message: 'Not a participant in this conversation' });
        return;
      }

      socket.join(conversationId);
      console.log(`[WS] ${username} joined room ${conversationId}`);
    });

    // Leave a conversation room — called when the user switches away (Issue 1.2)
    socket.on('leave_conversation', ({ conversationId }) => {
      if (!conversationId || typeof conversationId !== 'string') return;
      socket.leave(conversationId);
      console.log(`[WS] ${username} left room ${conversationId}`);
    });

    // send_message: validate, persist, relay encrypted message using EncryptedMessage format
    socket.on('send_message', (msg, ack) => {
      // Rate limit: reject if user is sending too fast
      if (!wsRateCheck(userId)) {
        if (typeof ack === 'function') ack({ error: 'Rate limit exceeded. Please slow down.' });
        return;
      }

      // Build the validated payload from only the fields we trust.
      // conversationId, id, timestamp, and payload come from the client;
      // senderId is always taken from the authenticated socket user.
      const payload = {
        id: msg && msg.id,
        conversationId: msg && msg.conversationId,
        senderId: userId, // always override — never trust client-provided senderId
        timestamp: msg && msg.timestamp,
        payload: msg && msg.payload,
      };

      const { valid, errors } = validateEncryptedMessage(payload);
      if (!valid) {
        if (typeof ack === 'function') ack({ error: errors.join(', ') });
        return;
      }

      const { conversationId, payload: encPayload } = payload;
      const { ciphertext, iv, version } = encPayload;

      // Reject oversized ciphertext to prevent database bloat
      if (typeof ciphertext !== 'string' || ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
        if (typeof ack === 'function') ack({ error: 'Message payload too large' });
        return;
      }

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);

      if (!participant) {
        if (typeof ack === 'function') ack({ error: 'Not a participant in this conversation' });
        return;
      }

      try {
        // Prefer a valid, unused client-provided message ID to support optimistic UI reconciliation.
        // Fall back to server-generated UUID when invalid or colliding.
        let messageId;
        const clientId = msg && typeof msg.id === 'string' ? msg.id : null;
        if (clientId && uuidValidate(clientId)) {
          // messages.id is a global primary key — check across all conversations
          const existing = db.prepare('SELECT 1 FROM messages WHERE id = ?').get(clientId);
          messageId = existing ? uuidv4() : clientId;
        } else {
          messageId = uuidv4();
        }
        const timestamp = Date.now();
        const replyToId = (msg && msg.replyToId) || null;
        const messageType = (msg && msg.messageType) || 'text';
        const mediaId = (msg && msg.mediaId) || null;
        const chainIdx = (encPayload.chainIdx != null) ? encPayload.chainIdx : null;

        // Check if sender is blocked by any participant or has blocked any participant
        const otherParticipants = db.prepare(
          'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?'
        ).all(conversationId, userId);

        for (const p of otherParticipants) {
          const blocked = db.prepare(
            'SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
          ).get(userId, p.user_id, p.user_id, userId);
          if (blocked) {
            if (typeof ack === 'function') ack({ error: 'Cannot send messages — one of you has blocked the other' });
            return;
          }
        }

        // Look up conversation's disappearing message timer
        const conv = db.prepare('SELECT disappear_after FROM conversations WHERE id = ?').get(conversationId);
        const expiresAt = (conv && conv.disappear_after) ? timestamp + conv.disappear_after : null;

        db.prepare(
          'INSERT INTO messages (id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, timestamp, message_type, media_id, chain_idx, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(messageId, conversationId, userId, ciphertext, iv, version || 'v1', replyToId, timestamp, messageType, mediaId, chainIdx, expiresAt);

        const message = {
          id: messageId,
          conversationId,
          senderId: userId,
          timestamp,
          replyToId,
          edited: false,
          payload: { ciphertext, iv, version: version || 'v1', chainIdx },
          messageType,
          mediaId,
          expiresAt,
        };

        io.to(conversationId).emit('message', message);
        if (typeof ack === 'function') ack({ success: true, message });
      } catch (err) {
        console.error('[WS] send_message error:', err);
        if (typeof ack === 'function') ack({ error: 'Failed to store message' });
      }
    });

    socket.on('key_exchange', (payload, ack) => {
      if (!wsRateCheck(userId)) {
        // Key exchange is critical for conversation setup — notify the sender
        // so the client can back off and retry instead of getting stuck.
        if (typeof ack === 'function') {
          ack({ error: 'Rate limit exceeded. Please slow down.' });
        } else {
          socket.emit('error', { message: 'Rate limit exceeded for key_exchange' });
        }
        return;
      }

      const normalized = { ...payload, userId };
      const { valid } = validateKeyExchange(normalized);
      if (!valid) return;

      const { conversationId } = normalized;
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);

      if (!participant) return;

      socket.to(conversationId).emit('key_exchange', normalized);
    });

    // key_confirm: relay key confirmation token to conversation peers
    socket.on('key_confirm', (payload) => {
      if (!payload || typeof payload !== 'object') return;
      const { conversationId, confirmToken } = payload;
      if (!conversationId || typeof conversationId !== 'string') return;
      if (!confirmToken || typeof confirmToken !== 'string') return;

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);
      if (!participant) return;

      socket.to(conversationId).emit('key_confirm', {
        conversationId,
        userId,
        confirmToken,
      });
    });

    // ── sender_key_distributed: notify group members that new sender keys are available ──
    socket.on('sender_key_distributed', (payload, ack) => {
      if (!payload || typeof payload !== 'object') {
        if (typeof ack === 'function') ack({ error: 'Invalid payload' });
        return;
      }
      const { conversationId, keyGeneration } = payload;
      if (!conversationId || typeof conversationId !== 'string') {
        if (typeof ack === 'function') ack({ error: 'Missing conversationId' });
        return;
      }

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);
      if (!participant) {
        if (typeof ack === 'function') ack({ error: 'Not a participant' });
        return;
      }

      // Relay to all other members in the room
      socket.to(conversationId).emit('sender_key_distributed', {
        conversationId,
        senderUserId: userId,
        keyGeneration: keyGeneration || 0,
      });
      if (typeof ack === 'function') ack({ success: true });
    });

    // ── sender_key_request: ask a specific user to re-distribute their sender key ──
    socket.on('sender_key_request', (payload, ack) => {
      if (!payload || typeof payload !== 'object') {
        if (typeof ack === 'function') ack({ error: 'Invalid payload' });
        return;
      }
      const { conversationId, targetUserId } = payload;
      if (!conversationId || typeof conversationId !== 'string') {
        if (typeof ack === 'function') ack({ error: 'Missing conversationId' });
        return;
      }
      if (!targetUserId || typeof targetUserId !== 'string') {
        if (typeof ack === 'function') ack({ error: 'Missing targetUserId' });
        return;
      }

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);
      if (!participant) {
        if (typeof ack === 'function') ack({ error: 'Not a participant' });
        return;
      }

      // Send directly to the target user
      io.to(targetUserId).emit('sender_key_request', {
        conversationId,
        requestingUserId: userId,
      });
      if (typeof ack === 'function') ack({ success: true });
    });

    // ── group_pairwise_exchange: notify a peer that we've published a pairwise ECDH key ──
    socket.on('group_pairwise_exchange', (payload, ack) => {
      if (!payload || typeof payload !== 'object') {
        if (typeof ack === 'function') ack({ error: 'Invalid payload' });
        return;
      }
      const { conversationId, targetUserId } = payload;
      if (!conversationId || typeof conversationId !== 'string') {
        if (typeof ack === 'function') ack({ error: 'Missing conversationId' });
        return;
      }
      if (!targetUserId || typeof targetUserId !== 'string') {
        if (typeof ack === 'function') ack({ error: 'Missing targetUserId' });
        return;
      }

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);
      if (!participant) {
        if (typeof ack === 'function') ack({ error: 'Not a participant' });
        return;
      }

      // Relay to the target user so they can complete the pairwise handshake
      io.to(targetUserId).emit('group_pairwise_exchange', {
        conversationId,
        fromUserId: userId,
      });
      if (typeof ack === 'function') ack({ success: true });
    });

    socket.on('edit_message', ({ conversationId, messageId, payload: encPayload }, ack) => {
      if (!wsRateCheck(userId)) {
        if (typeof ack === 'function') ack({ error: 'Rate limit exceeded. Please slow down.' });
        return;
      }

      if (!conversationId || !messageId || !encPayload) {
        if (typeof ack === 'function') ack({ error: 'Missing fields' });
        return;
      }

      // Validate edit payload: require ciphertext + iv, enforce size limit
      if (typeof encPayload !== 'object') {
        if (typeof ack === 'function') ack({ error: 'Invalid encrypted payload' });
        return;
      }
      const { ciphertext, iv, version, chainIdx } = encPayload;
      if (typeof ciphertext !== 'string' || ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_LENGTH) {
        if (typeof ack === 'function') ack({ error: 'Edited message payload missing or too large' });
        return;
      }
      if (typeof iv !== 'string' || iv.length === 0) {
        if (typeof ack === 'function') ack({ error: 'Invalid encrypted payload' });
        return;
      }

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);
      if (!participant) {
        if (typeof ack === 'function') ack({ error: 'Not a participant' });
        return;
      }

      try {
        const message = db.prepare('SELECT sender_id FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
        if (!message || message.sender_id !== userId) {
          if (typeof ack === 'function') ack({ error: 'Can only edit your own messages' });
          return;
        }

        db.prepare('UPDATE messages SET ciphertext = ?, iv = ?, version = ?, edited = 1, chain_idx = ? WHERE id = ?')
          .run(ciphertext, iv, version || 'v1', chainIdx != null ? chainIdx : null, messageId);

        io.to(conversationId).emit('message_edited', {
          conversationId, messageId,
          payload: { ciphertext, iv, version: version || 'v1', chainIdx: chainIdx != null ? chainIdx : undefined },
        });
        if (typeof ack === 'function') ack({ success: true });
      } catch (err) {
        console.error('[WS] edit_message error:', err);
        if (typeof ack === 'function') ack({ error: 'Failed to edit message' });
      }
    });

    socket.on('delete_message', ({ conversationId, messageId, mode }, ack) => {
      if (!conversationId || !messageId) {
        if (typeof ack === 'function') ack({ error: 'Missing fields' });
        return;
      }

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);
      if (!participant) {
        if (typeof ack === 'function') ack({ error: 'Not a participant' });
        return;
      }

      try {
        if (mode === 'for_everyone') {
          const message = db.prepare('SELECT sender_id, media_id FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
          if (!message || message.sender_id !== userId) {
            if (typeof ack === 'function') ack({ error: 'Cannot delete others\' messages for everyone' });
            return;
          }

          // Clean up associated media file from disk and DB if present
          if (message.media_id) {
            try {
              const media = db.prepare('SELECT file_path FROM media WHERE id = ?').get(message.media_id);
              if (media) {
                const filePath = path.join(UPLOADS_DIR, media.file_path);
                if (fs.existsSync(filePath)) {
                  fs.unlinkSync(filePath);
                  console.log(`[WS] Deleted media file: ${filePath}`);
                }
                db.prepare('DELETE FROM media WHERE id = ?').run(message.media_id);
              }
            } catch (mediaErr) {
              console.error('[WS] Failed to clean up media:', mediaErr);
              // Continue with message deletion even if media cleanup fails
            }
          }

          db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
          // Broadcast to all participants so they remove it in real time
          io.to(conversationId).emit('message_deleted', { conversationId, messageId, mode: 'for_everyone' });
        } else {
          db.prepare('INSERT OR IGNORE INTO message_deletions (message_id, user_id) VALUES (?, ?)').run(messageId, userId);
        }
        if (typeof ack === 'function') ack({ success: true });
      } catch (err) {
        console.error('[WS] delete_message error:', err);
        if (typeof ack === 'function') ack({ error: 'Failed to delete message' });
      }
    });

    // ── reaction_add: add an emoji reaction to a message (one per user — replaces old) ──
    socket.on('reaction_add', ({ message_id, emoji }) => {
      if (!message_id || typeof message_id !== 'string') return;
      if (!emoji || typeof emoji !== 'string') return;
      if (!ALLOWED_EMOJI.includes(emoji)) return;

      const msg = stmtGetMsgConversation.get(message_id);
      if (!msg) return;

      const member = stmtIsParticipant.get(msg.conversation_id, userId);
      if (!member) return;

      // Enforce one reaction per user: remove any existing reaction first
      const existing = stmtGetUserReaction.get(message_id, userId);
      if (existing) {
        stmtDeleteReactionByUser.run(message_id, userId);
        if (existing.emoji === emoji) {
          // Same emoji clicked again → toggle off (just broadcast removal, don't re-add)
          io.to(msg.conversation_id).emit('reaction_removed', {
            message_id, user_id: userId, emoji,
          });
          return;
        }
        // Different emoji → broadcast removal of old emoji before adding new one
        io.to(msg.conversation_id).emit('reaction_removed', {
          message_id, user_id: userId, emoji: existing.emoji,
        });
      }

      stmtInsertReaction.run(message_id, userId, emoji);
      io.to(msg.conversation_id).emit('reaction_added', {
        message_id,
        user_id: userId,
        username,
        emoji,
      });
    });

    // ── reaction_remove: remove an emoji reaction from a message ──
    socket.on('reaction_remove', ({ message_id, emoji }) => {
      if (!message_id || typeof message_id !== 'string') return;
      if (!emoji || typeof emoji !== 'string') return;

      const msg = stmtGetMsgConversation.get(message_id);
      if (!msg) return;

      const member = stmtIsParticipant.get(msg.conversation_id, userId);
      if (!member) return;

      stmtDeleteReaction.run(message_id, userId, emoji);

      io.to(msg.conversation_id).emit('reaction_removed', {
        message_id,
        user_id: userId,
        emoji,
      });
    });

    socket.on('disconnect', () => {
      console.log(`[WS] ${userType === 'guest' ? 'Guest' : 'User'} disconnected: ${username} (${userId})`);
      // Emit disconnect only to conversation peers (Issue 5.1)
      const disconnectPeers = db.prepare(`
        SELECT DISTINCT cp2.user_id FROM conversation_participants cp1
        JOIN conversation_participants cp2 ON cp2.conversation_id = cp1.conversation_id
        WHERE cp1.user_id = ? AND cp2.user_id != ?
      `).all(userId, userId);
      for (const peer of disconnectPeers) {
        io.to(peer.user_id).emit('user_disconnected', { userId, username });
      }
    });
  });
}

module.exports = { registerSocketHandlers };
