// Guest session management service.
//
// Stores the guest JWT in sessionStorage (dies on tab close — intentional
// for burner room privacy). Provides helpers for the UI to detect guest mode
// and react to kicked/expired events.

import { connectSocket, getSocket, disconnectSocket } from './socket.js';

// ---------------------------------------------------------------------------
// Storage (sessionStorage only — ephemeral by design)
// ---------------------------------------------------------------------------

const GUEST_TOKEN_KEY = 'blink-guest-token';
const GUEST_SESSION_KEY = 'blink-guest-session';

/**
 * Save guest session info after successfully joining a room.
 */
export function saveGuestSession({ token, guestSessionId, conversationId, conversationName, expiresAt }) {
  sessionStorage.setItem(GUEST_TOKEN_KEY, token);
  sessionStorage.setItem(GUEST_SESSION_KEY, JSON.stringify({
    guestSessionId,
    conversationId,
    conversationName,
    expiresAt,
    joinedAt: Date.now(),
  }));
}

/**
 * Get the stored guest session, or null if not a guest.
 */
export function getGuestSession() {
  try {
    const raw = sessionStorage.getItem(GUEST_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Get the stored guest JWT token.
 */
export function getGuestToken() {
  return sessionStorage.getItem(GUEST_TOKEN_KEY);
}

/**
 * Check if the current session is a guest session.
 */
export function isGuest() {
  return !!sessionStorage.getItem(GUEST_TOKEN_KEY);
}

/**
 * Clear guest session (on kick, expiry, or manual leave).
 */
export function clearGuestSession() {
  sessionStorage.removeItem(GUEST_TOKEN_KEY);
  sessionStorage.removeItem(GUEST_SESSION_KEY);
}

/**
 * Connect the guest socket using the guest JWT.
 * Returns the socket instance.
 */
export function connectGuestSocket() {
  const token = getGuestToken();
  if (!token) throw new Error('No guest token found');
  return connectSocket(token);
}

/**
 * Disconnect and clear guest session.
 */
export function leaveGuestSession() {
  disconnectSocket();
  clearGuestSession();
}

// ---------------------------------------------------------------------------
// Socket event listeners for guest-specific events
// ---------------------------------------------------------------------------

/**
 * Register global handlers for kick and expiry.
 * Call this once after the guest socket is connected.
 *
 * @param {object} callbacks
 * @param {Function} callbacks.onKicked - Called when the guest is kicked
 * @param {Function} callbacks.onExpired - Called when the room expires
 */
export function registerGuestEventHandlers(callbacks = {}) {
  const socket = getSocket();
  if (!socket) return;

  socket.on('you_were_kicked', ({ conversationId }) => {
    console.warn('[guest] You were kicked from room', conversationId);
    clearGuestSession();
    if (callbacks.onKicked) {
      callbacks.onKicked({ conversationId });
    }
  });

  socket.on('conversation_expired', ({ conversationId }) => {
    const session = getGuestSession();
    if (session && session.conversationId === conversationId) {
      console.warn('[guest] Room expired:', conversationId);
      clearGuestSession();
      if (callbacks.onExpired) {
        callbacks.onExpired({ conversationId });
      }
    }
  });
}

/**
 * Check if the guest's room has expired based on stored expiresAt.
 * Returns true if expired.
 */
export function isGuestRoomExpired() {
  const session = getGuestSession();
  if (!session || !session.expiresAt) return false;
  return Date.now() >= session.expiresAt;
}
