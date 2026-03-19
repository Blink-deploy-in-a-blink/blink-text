import { useEffect, useRef } from 'react';
import { getConversations, getMessages } from '../services/api.js';
import { joinConversation } from '../services/socket.js';
import {
  setupConversationKey,
  decryptConversationMessage,
  hasConversationKey,
} from '../services/cryptoService.js';
import { getCachedMessages, setCachedMessages } from '../services/messageCache.js';

/**
 * Background preloader — after login, iterates all conversations and
 * sets up keys + prefetches the latest messages so switching is instant.
 * Uses zero retries for key exchange so it never blocks on missing peer keys.
 * Runs once per mount (when userId becomes truthy).
 */
export function useBackgroundPreloader(userId) {
  const started = useRef(false);

  useEffect(() => {
    if (!userId || started.current) return;
    started.current = true;

    (async () => {
      try {
        const conversations = await getConversations();
        if (!conversations?.length) return;

        // Preload conversations in parallel batches of 3
        const batchSize = 3;
        for (let i = 0; i < conversations.length; i += batchSize) {
          const batch = conversations.slice(i, i + batchSize);
          await Promise.allSettled(batch.map((conv) => preloadConversation(conv, userId)));
        }
        console.log('[preloader] Background preloading complete for', conversations.length, 'conversations');
      } catch (err) {
        console.warn('[preloader] Failed to fetch conversations:', err.message);
      }
    })();

    return () => { started.current = false; };
  }, [userId]);
}

async function preloadConversation(conv, userId) {
  try {
    // Skip if we already have a fresh cache
    if (getCachedMessages(conv.id)) return;

    // Join the socket room
    joinConversation(conv.id);

    // Set up key with 0 retries — instant, no blocking
    // If peer hasn't published yet, key will arrive via socket later
    await setupConversationKey(conv.id, userId, { maxRetries: 0, retryDelay: 0 });

    // Only fetch & decrypt messages if we actually have a key
    if (!hasConversationKey(conv.id)) return;

    const { messages: rawMessages, hasMore } = await getMessages(conv.id, { limit: 50 });

    const decrypted = await Promise.all(
      rawMessages.map(async (msg) => {
        try {
          const plaintext = await decryptConversationMessage(conv.id, msg.payload, msg.senderId);
          return { ...msg, plaintext };
        } catch {
          return { ...msg, plaintext: '[unable to decrypt]' };
        }
      })
    );

    setCachedMessages(conv.id, decrypted, hasMore);
  } catch (err) {
    console.warn('[preloader] Failed to preload conversation:', conv.id, err.message);
  }
}
