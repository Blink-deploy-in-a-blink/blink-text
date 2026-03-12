import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let socket = null;

/**
 * Connect to the server with a JWT auth token.
 * Calling connect() again while already connected is a no-op.
 * @param {string} token
 * @returns {Socket}
 */
export function connect(token) {
  if (socket && socket.connected) return socket;

  socket = io(SERVER_URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => console.log('[socket] connected'));
  socket.on('disconnect', (reason) => console.log('[socket] disconnected:', reason));
  socket.on('connect_error', (err) => console.error('[socket] connection error:', err.message));

  return socket;
}

/**
 * Disconnect and clean up the socket.
 */
export function disconnect() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Join a conversation room.
 * @param {string} conversationId
 */
export function joinConversation(conversationId) {
  if (!socket) throw new Error('Socket not connected');
  socket.emit('join_conversation', { conversationId });
}

/**
 * Send an encrypted message payload.
 * @param {string} conversationId
 * @param {{ ciphertext: string, iv: string }} encryptedPayload
 * @returns {Promise<Object>} server acknowledgement
 */
export function sendMessage(conversationId, encryptedPayload) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not connected'));

    socket.emit(
      'send_message',
      {
        conversation_id: conversationId,
        ...encryptedPayload,
        timestamp: Date.now(),
      },
      (ack) => {
        if (ack && ack.error) reject(new Error(ack.error));
        else resolve(ack);
      }
    );
  });
}

/**
 * Register a handler for incoming messages.
 * @param {(message: Object) => void} callback
 */
export function onMessage(callback) {
  if (!socket) throw new Error('Socket not connected');
  socket.on('message', callback);
}

/**
 * Remove a handler for incoming messages.
 * @param {(message: Object) => void} callback
 */
export function offMessage(callback) {
  if (socket) socket.off('message', callback);
}

/**
 * Emit a key exchange event.
 * @param {string} conversationId
 * @param {Object} ephemeralPublicKey
 */
export function emitKeyExchange(conversationId, ephemeralPublicKey) {
  if (!socket) throw new Error('Socket not connected');
  socket.emit('key_exchange', { conversation_id: conversationId, ephemeral_public_key: ephemeralPublicKey });
}

/**
 * Register a handler for incoming key_exchange events.
 * @param {(payload: Object) => void} callback
 */
export function onKeyExchange(callback) {
  if (!socket) throw new Error('Socket not connected');
  socket.on('key_exchange', callback);
}

export function getSocket() {
  return socket;
}
