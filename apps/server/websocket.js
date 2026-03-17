'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { validateEncryptedMessage, validateKeyExchange } = require('@blink-text/shared');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, 'uploads');

// WebSocket rate limiting: max messages per window per user
const WS_RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const WS_RATE_LIMIT_MAX = 30;           // max 30 messages per window

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

  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication token required'));
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return next(new Error('Invalid or expired token'));

      // Check ban/deletion status in DB so bans take effect immediately,
      // even if the JWT hasn't expired yet.
      const dbUser = db.prepare('SELECT is_banned, deleted_at FROM users WHERE id = ?').get(user.id);
      if (!dbUser) return next(new Error('User not found'));
      if (dbUser.is_banned) return next(new Error('Account suspended'));
      if (dbUser.deleted_at) return next(new Error('Account deleted'));

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

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversationId, userId);

      if (!participant) {
        if (typeof ack === 'function') ack({ error: 'Not a participant in this conversation' });
        return;
      }

      try {
        const messageId = payload.id || uuidv4();
        const timestamp = Date.now();
        const replyToId = (msg && msg.replyToId) || null;
        const messageType = (msg && msg.messageType) || 'text';
        const mediaId = (msg && msg.mediaId) || null;
        const chainIdx = (encPayload.chainIdx != null) ? encPayload.chainIdx : null;

        db.prepare(
          'INSERT INTO messages (id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, timestamp, message_type, media_id, chain_idx) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(messageId, conversationId, userId, ciphertext, iv, version || 'v1', replyToId, timestamp, messageType, mediaId, chainIdx);

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

        const { ciphertext, iv, version } = encPayload;
        db.prepare('UPDATE messages SET ciphertext = ?, iv = ?, version = ?, edited = 1, chain_idx = ? WHERE id = ?')
          .run(ciphertext, iv, version || 'v1', encPayload.chainIdx != null ? encPayload.chainIdx : null, messageId);

        io.to(conversationId).emit('message_edited', {
          conversationId, messageId,
          payload: { ciphertext, iv, version: version || 'v1', chainIdx: encPayload.chainIdx != null ? encPayload.chainIdx : undefined },
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
