import { io } from 'socket.io-client';

// In production (served from same origin), connect to window.location.origin.
// In development (Vite dev server on 5173, API on 3001), connect to the API port.
const SOCKET_URL = import.meta.env.VITE_API_URL ||
  (window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin);

let socket = null;

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(SOCKET_URL, {
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 5,
  });

  // Listen for connection errors caused by session invalidation
  socket.on('connect_error', (err) => {
    if (err?.message === 'session_expired') {
      console.warn('[socket] Session expired — signed in on another device');
      localStorage.removeItem('blink-token');
      localStorage.removeItem('blink-user');
      localStorage.removeItem('blink-active-conv');
      sessionStorage.removeItem('blink-session');
      socket.disconnect();
      socket = null;
      window.dispatchEvent(new CustomEvent('blink-session-expired'));
    }
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

export function leaveConversation(conversationId) {
  if (socket) socket.emit('leave_conversation', { conversationId });
}

/**
 * Send an encrypted message over the socket.
 * @param {string} id - UUID for the message
 * @param {string} conversationId
 * @param {string} senderId
 * @param {{ ciphertext: string, iv: string, version: string }} payload
 * @param {string|null} replyToId
 * @param {string} [messageType='text'] - 'text', 'image', 'video', or 'voice'
 * @param {string|null} [mediaId=null] - media ID for non-text messages
 * @returns {Promise<{ success: boolean, message?: object }>}
 */
export function sendMessage(id, conversationId, senderId, payload, replyToId = null, messageType = 'text', mediaId = null) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('Socket not connected'));
    const msg = { id, conversationId, senderId, timestamp: Date.now(), payload, replyToId, messageType, mediaId };
    socket.emit('send_message', msg, (ack) => {
      if (ack?.error) reject(new Error(ack.error));
      else resolve(ack);
    });
  });
}

export function sendKeyExchange(conversationId, userId, deviceId, ephemeralPublicKey) {
  if (socket) socket.emit('key_exchange', { conversationId, userId, deviceId, ephemeralPublicKey });
}

export function sendKeyConfirm(conversationId, confirmToken) {
  if (socket) socket.emit('key_confirm', { conversationId, confirmToken });
}

/**
 * Notify group members that we've distributed a new/rotated sender key.
 */
export function emitSenderKeyDistributed(conversationId, keyGeneration) {
  if (socket) {
    socket.emit('sender_key_distributed', { conversationId, keyGeneration }, (ack) => {
      if (ack?.error) console.warn('[socket] sender_key_distributed error:', ack.error);
    });
  }
}

/**
 * Request a specific user to re-distribute their sender key.
 */
export function emitSenderKeyRequest(conversationId, targetUserId) {
  if (socket) {
    socket.emit('sender_key_request', { conversationId, targetUserId }, (ack) => {
      if (ack?.error) console.warn('[socket] sender_key_request error:', ack.error);
    });
  }
}
