import { useEffect, useRef } from 'react';
import { getConversations, getMessages } from '../services/api.js';
import { joinConversation, emitSenderKeyDistributed } from '../services/socket.js';
import {
  setupConversationKey,
  decryptConversationMessage,
  hasConversationKey,
} from '../services/cryptoService.js';
import { getCachedMessages, setCachedMessages } from '../services/messageCache.js';
import {
  isGroupConversation,
  registerGroupConversation,
  setupGroupKeys,
  hasGroupKeys,
} from '../services/groupCrypto.js';

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
    // Join the socket room
    joinConversation(conv.id);

    const isGroup = conv.type === 'group_chat';

    if (isGroup) {
      // Always run group key setup even when the message cache is warm — a new member may
      // have joined since the last load. setupGroupKeys returns early if all keys are present.
      if (!isGroupConversation(conv.id)) registerGroupConversation(conv.id);
      const participantIds = (conv.participant_ids || '').split(',').filter(Boolean);
      try {
        await setupGroupKeys(conv.id, userId, participantIds, { emitSenderKeyDistributed });
      } catch (err) {
        console.warn('[preloader] Group key setup failed:', conv.id, err.message);
      }
      // Skip message cache refresh if already populated
      if (getCachedMessages(conv.id)) return;
      if (!hasGroupKeys(conv.id)) return;
    } else {
      // DM: Skip entirely if already cached
      if (getCachedMessages(conv.id)) return;
      // Set up key with 0 retries — instant, no blocking
      await setupConversationKey(conv.id, userId, { maxRetries: 0, retryDelay: 0 });
      if (!hasConversationKey(conv.id)) return;
    }

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
