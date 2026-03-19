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
    } catch (err) {
      console.error('[expiry] Cleanup error:', err);
    }
  }, 30_000); // every 30 seconds
  expiryCleanupInterval.unref();

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication token required'));
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return next(new Error('Invalid or expired token'));

      // Check ban/deletion status in DB so bans take effect immediately,
      // even if the JWT hasn't expired yet.
      const dbUser = db.prepare('SELECT is_banned, deleted_at, session_nonce FROM users WHERE id = ?').get(user.id);
      if (!dbUser) return next(new Error('User not found'));
      if (dbUser.is_banned) return next(new Error('Account suspended'));
      if (dbUser.deleted_at) return next(new Error('Account deleted'));

      // Single-session enforcement: reject if nonce doesn't match
      if (dbUser.session_nonce && user.nonce !== dbUser.session_nonce) {
        return next(new Error('session_expired'));
      }

      socket.user = user;
      next();
    });
  });

  io.on('connection', (socket) => {
    const { id: userId, username } = socket.user;
    console.log(`[WS] User connected: ${username} (${userId})`);

    // Join a personal room so we can send events directly to this user
    socket.join(userId);

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

    socket.on('disconnect', () => {
      console.log(`[WS] User disconnected: ${username} (${userId})`);
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
