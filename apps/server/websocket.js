'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { validateEncryptedMessage, validateKeyExchange } = require('@blink-text/shared');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

/**
 * Registers all Socket.io event handlers on the given io instance.
 * @param {import('socket.io').Server} io
 */
function registerSocketHandlers(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication token required'));
    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return next(new Error('Invalid or expired token'));
      socket.user = user;
      next();
    });
  });

  io.on('connection', (socket) => {
    const { id: userId, username } = socket.user;
    console.log(`[WS] User connected: ${username} (${userId})`);
    socket.broadcast.emit('user_connected', { userId, username });

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

    // send_message: validate, persist, relay encrypted message using EncryptedMessage format
    socket.on('send_message', (msg, ack) => {
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

        db.prepare(
          'INSERT INTO messages (id, conversation_id, sender_id, ciphertext, iv, version, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(messageId, conversationId, userId, ciphertext, iv, version || 'v1', timestamp);

        const message = {
          id: messageId,
          conversationId,
          senderId: userId,
          timestamp,
          payload: { ciphertext, iv, version: version || 'v1' },
        };

        io.to(conversationId).emit('message', message);
        if (typeof ack === 'function') ack({ success: true, message });
      } catch (err) {
        console.error('[WS] send_message error:', err);
        if (typeof ack === 'function') ack({ error: 'Failed to store message' });
      }
    });

    socket.on('key_exchange', (payload) => {
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
          const message = db.prepare('SELECT sender_id FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
          if (!message || message.sender_id !== userId) {
            if (typeof ack === 'function') ack({ error: 'Cannot delete others\' messages for everyone' });
            return;
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
      socket.broadcast.emit('user_disconnected', { userId, username });
    });
  });
}

module.exports = { registerSocketHandlers };
