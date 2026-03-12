'use strict';

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { validateEncryptedMessage } = require('../shared/schemas');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

/**
 * Registers all Socket.io event handlers on the given io instance.
 * @param {import('socket.io').Server} io
 */
function registerSocketHandlers(io) {
  // Middleware: authenticate socket connections with JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return next(new Error('Invalid or expired token'));
      }
      socket.user = user;
      next();
    });
  });

  io.on('connection', (socket) => {
    const { id: userId, username } = socket.user;
    console.log(`[WS] User connected: ${username} (${userId})`);

    // Notify others in joined rooms that the user is online
    socket.broadcast.emit('user_connected', { userId, username });

    // join_conversation: add socket to a conversation room
    socket.on('join_conversation', ({ conversationId }) => {
      if (!conversationId || typeof conversationId !== 'string') return;

      // Verify the user is actually a participant before joining the room
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

    // send_message: validate, persist, relay encrypted message
    socket.on('send_message', (payload, ack) => {
      const { valid, errors } = validateEncryptedMessage(payload);
      if (!valid) {
        if (typeof ack === 'function') ack({ error: errors.join(', ') });
        return;
      }

      const { conversation_id, ciphertext, iv } = payload;

      // Ensure sender is a participant
      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversation_id, userId);

      if (!participant) {
        if (typeof ack === 'function') ack({ error: 'Not a participant in this conversation' });
        return;
      }

      try {
        const messageId = uuidv4();
        const timestamp = Date.now();

        db.prepare(
          'INSERT INTO messages (id, conversation_id, sender_id, ciphertext, iv, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(messageId, conversation_id, userId, ciphertext, iv, timestamp);

        const message = {
          id: messageId,
          conversation_id,
          sender_id: userId,
          ciphertext,
          iv,
          timestamp,
        };

        // Relay to all participants in the room (including sender)
        io.to(conversation_id).emit('message', message);

        if (typeof ack === 'function') ack({ success: true, message });
      } catch (err) {
        console.error('[WS] send_message error:', err);
        if (typeof ack === 'function') ack({ error: 'Failed to store message' });
      }
    });

    // key_exchange: relay ephemeral key data to other participants
    socket.on('key_exchange', (payload) => {
      const { conversation_id } = payload || {};
      if (!conversation_id || typeof conversation_id !== 'string') return;

      const participant = db.prepare(
        'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
      ).get(conversation_id, userId);

      if (!participant) return;

      // Relay to everyone else in the conversation room
      socket.to(conversation_id).emit('key_exchange', {
        ...payload,
        user_id: userId,
      });
    });

    socket.on('disconnect', () => {
      console.log(`[WS] User disconnected: ${username} (${userId})`);
      socket.broadcast.emit('user_disconnected', { userId, username });
    });
  });
}

module.exports = { registerSocketHandlers };
