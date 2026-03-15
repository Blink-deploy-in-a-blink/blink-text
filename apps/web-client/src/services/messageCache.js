/**
 * In-memory message cache for background preloading.
 * Stores the latest messages per conversation so switching is instant.
 */

// Map<conversationId, { messages: decryptedMsg[], hasMore: boolean, timestamp: number }>
const cache = new Map();

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
}

export function isCacheFresh(conversationId, maxAgeMs = 60_000) {
  const entry = cache.get(conversationId);
  if (!entry) return false;
  return (Date.now() - entry.timestamp) < maxAgeMs;
}
