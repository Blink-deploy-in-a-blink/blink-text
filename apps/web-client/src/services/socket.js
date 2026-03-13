import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

let socket = null;

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(SOCKET_URL, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 5,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function joinConversation(conversationId) {
  if (socket) socket.emit('join_conversation', { conversationId });
}

/**
 * Send an encrypted message over the socket.
 * @param {string} id - UUID for the message
 * @param {string} conversationId
 * @param {string} senderId
 * @param {{ ciphertext: string, iv: string, version: string }} payload
 * @returns {Promise<{ success: boolean, message?: object }>}
 */
export function sendMessage(id, conversationId, senderId, payload) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not connected'));
    const msg = { id, conversationId, senderId, timestamp: Date.now(), payload };
    socket.emit('send_message', msg, (ack) => {
      if (ack?.error) reject(new Error(ack.error));
      else resolve(ack);
    });
  });
}

export function sendKeyExchange(conversationId, userId, deviceId, ephemeralPublicKey) {
  if (socket) socket.emit('key_exchange', { conversationId, userId, deviceId, ephemeralPublicKey });
}
