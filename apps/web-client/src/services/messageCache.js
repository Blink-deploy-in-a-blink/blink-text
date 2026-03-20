/**
 * In-memory message cache for background preloading.
 * Stores the latest messages per conversation so switching is instant.
 */

// Map<conversationId, { messages: decryptedMsg[], hasMore: boolean, timestamp: number }>
const cache = new Map();

// Map<conversationId, number> — unread message counts per conversation
const unreadCounts = new Map();

// Callbacks registered by components that want to be notified of unread changes
let unreadListeners = [];

export function getCachedMessages(conversationId) {
  return cache.get(conversationId) || null;
}

export function setCachedMessages(conversationId, messages, hasMore) {
  cache.set(conversationId, { messages, hasMore, timestamp: Date.now() });
}

export function appendCachedMessage(conversationId, msg) {
  const entry = cache.get(conversationId);
  if (!entry) return;
  // Deduplicate — avoid adding the same message twice (e.g. reconnect, multi-tab)
  if (entry.messages.some((m) => m.id === msg.id)) return;
  entry.messages = [...entry.messages, msg];
  entry.timestamp = Date.now();
}

export function updateCachedMessage(conversationId, messageId, updater) {
  const entry = cache.get(conversationId);
  if (!entry) return;
  entry.messages = entry.messages.map((m) => m.id === messageId ? updater(m) : m);
}

export function removeCachedMessage(conversationId, messageId) {
  const entry = cache.get(conversationId);
  if (!entry) return;
  entry.messages = entry.messages.filter((m) => m.id !== messageId);
}

export function clearCache() {
  cache.clear();
  unreadCounts.clear();
  _notifyUnreadListeners();
}

export function isCacheFresh(conversationId, maxAgeMs = 60_000) {
  const entry = cache.get(conversationId);
  if (!entry) return false;
  return (Date.now() - entry.timestamp) < maxAgeMs;
}

// --- Unread count tracking ---

export function incrementUnread(conversationId) {
  unreadCounts.set(conversationId, (unreadCounts.get(conversationId) || 0) + 1);
  _notifyUnreadListeners();
}

export function clearUnread(conversationId) {
  if (unreadCounts.has(conversationId)) {
    unreadCounts.delete(conversationId);
    _notifyUnreadListeners();
  }
}

export function getUnreadCount(conversationId) {
  return unreadCounts.get(conversationId) || 0;
}

export function getTotalUnread() {
  let total = 0;
  for (const count of unreadCounts.values()) total += count;
  return total;
}

export function getAllUnreadCounts() {
  return Object.fromEntries(unreadCounts);
}

export function onUnreadChange(listener) {
  unreadListeners.push(listener);
  return () => { unreadListeners = unreadListeners.filter((l) => l !== listener); };
}

function _notifyUnreadListeners() {
  const counts = Object.fromEntries(unreadCounts);
  for (const fn of unreadListeners) {
    try { fn(counts); } catch { /* ignore */ }
  }
}
