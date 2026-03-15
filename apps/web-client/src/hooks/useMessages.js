import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getMessages, deleteMessage as apiDeleteMessage } from '../services/api.js';
import { getSocket, joinConversation, sendMessage } from '../services/socket.js';
import {
  setupConversationKey,
  encryptForConversation,
  decryptConversationMessage,
  completeKeyExchangeFromSocket,
  hasConversationKey,
} from '../services/cryptoService.js';
import {
  getCachedMessages,
  setCachedMessages,
  appendCachedMessage,
  updateCachedMessage,
  removeCachedMessage,
} from '../services/messageCache.js';

export function useMessages(conversationId, myUserId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Decrypt a batch of raw messages
  const decryptBatch = useCallback(async (rawMessages) => {
    return Promise.all(
      rawMessages.map(async (msg) => {
        try {
          const plaintext = await decryptConversationMessage(conversationId, msg.payload);
          return { ...msg, plaintext };
        } catch (err) {
          console.warn('[useMessages] Failed to decrypt message:', msg.id, err);
          return { ...msg, plaintext: '[unable to decrypt]' };
        }
      })
    );
  }, [conversationId]);

  // Load message history when conversation changes (latest page)
  useEffect(() => {
    if (!conversationId) { setMessages([]); setHasMore(false); return; }

    // Show cached messages immediately if available
    const cached = getCachedMessages(conversationId);
    if (cached) {
      setMessages(cached.messages);
      setHasMore(cached.hasMore);
    }

    setLoading(!cached); // Only show loading spinner if no cache

    let cancelled = false;
    (async () => {
      try {
        // Join the socket room first so we receive key_exchange events during setup
        joinConversation(conversationId);

        // Set up key — uses 3 retries by default (max ~1.2s wait)
        await setupConversationKey(conversationId, myUserId);

        // If we still don't have a key (peer hasn't published yet), show cached or empty
        if (!hasConversationKey(conversationId)) {
          if (isMounted.current && !cancelled) setLoading(false);
          return;
        }

        const { messages: rawMessages, hasMore: more } = await getMessages(conversationId, { limit: 50 });
        const decrypted = await decryptBatch(rawMessages);

        if (isMounted.current && !cancelled) {
          setMessages(decrypted);
          setHasMore(more);
          setCachedMessages(conversationId, decrypted, more);
        }
      } catch (err) {
        console.error('Failed to load messages:', err);
      } finally {
        if (isMounted.current && !cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [conversationId, myUserId, decryptBatch]);

  // Load older messages (called when user scrolls to top)
  const loadMore = useCallback(async () => {
    if (!conversationId || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const oldestTimestamp = messages.length > 0 ? messages[0].timestamp : undefined;
      const { messages: rawOlder, hasMore: more } = await getMessages(conversationId, { limit: 50, before: oldestTimestamp });
      const decrypted = await decryptBatch(rawOlder);
      if (isMounted.current) {
        setMessages((prev) => {
          const merged = [...decrypted, ...prev];
          setCachedMessages(conversationId, merged, more);
          return merged;
        });
        setHasMore(more);
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      if (isMounted.current) setLoadingMore(false);
    }
  }, [conversationId, loadingMore, hasMore, messages, decryptBatch]);

  // Socket event listeners
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    if (!socket) return;

    const onMessage = async (msg) => {
      // Only handle messages for the currently active conversation
      if (msg.conversationId !== conversationId) return;
      try {
        const plaintext = await decryptConversationMessage(conversationId, msg.payload);
        const decryptedMsg = { ...msg, plaintext };
        appendCachedMessage(conversationId, decryptedMsg);
        if (isMounted.current) {
          setMessages((prev) => [...prev, decryptedMsg]);
        }
      } catch (err) {
        console.warn('[useMessages] Failed to decrypt incoming message:', msg.id, err);
        const failedMsg = { ...msg, plaintext: '[unable to decrypt]' };
        appendCachedMessage(conversationId, failedMsg);
        if (isMounted.current) {
          setMessages((prev) => [...prev, failedMsg]);
        }
      }
    };

    const onKeyExchange = async ({ conversationId: cid, ephemeralPublicKey }) => {
      if (cid !== conversationId) return;
      await completeKeyExchangeFromSocket(conversationId, ephemeralPublicKey);

      // Now that we have the key, fetch and decrypt messages
      if (!isMounted.current) return;
      if (!hasConversationKey(conversationId)) return;
      try {
        const { messages: rawMessages, hasMore: more } = await getMessages(conversationId, { limit: 50 });
        const decrypted = await Promise.all(
          rawMessages.map(async (msg) => {
            try {
              const plaintext = await decryptConversationMessage(conversationId, msg.payload);
              return { ...msg, plaintext };
            } catch {
              return { ...msg, plaintext: '[unable to decrypt]' };
            }
          })
        );
        if (isMounted.current) {
          setMessages(decrypted);
          setHasMore(more);
          setCachedMessages(conversationId, decrypted, more);
        }
      } catch {
        // If re-fetch fails, leave existing messages as-is
      }
    };

    const onMessageDeleted = ({ conversationId: cid, messageId }) => {
      if (cid !== conversationId) return;
      removeCachedMessage(conversationId, messageId);
      if (isMounted.current) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    };

    const onMessageEdited = async ({ conversationId: cid, messageId, payload }) => {
      if (cid !== conversationId) return;
      try {
        const plaintext = await decryptConversationMessage(conversationId, payload);
        updateCachedMessage(conversationId, messageId, (m) => ({ ...m, plaintext, edited: true, payload }));
        if (isMounted.current) {
          setMessages((prev) => prev.map((m) =>
            m.id === messageId ? { ...m, plaintext, edited: true, payload } : m
          ));
        }
      } catch (err) {
        console.warn('[useMessages] Failed to decrypt edited message:', messageId, err);
      }
    };

    socket.on('message', onMessage);
    socket.on('key_exchange', onKeyExchange);
    socket.on('message_deleted', onMessageDeleted);
    socket.on('message_edited', onMessageEdited);

    return () => {
      socket.off('message', onMessage);
      socket.off('key_exchange', onKeyExchange);
      socket.off('message_deleted', onMessageDeleted);
      socket.off('message_edited', onMessageEdited);
    };
  }, [conversationId]);

  const sendMsg = useCallback(async (plaintext, replyToId = null) => {
    if (!conversationId) return;

    // If we don't have a key yet, try to set up with more retries + longer delays
    if (!hasConversationKey(conversationId)) {
      await setupConversationKey(conversationId, myUserId, { maxRetries: 6, retryDelay: 500 });
    }

    // Still no key — wait a bit more for socket-based key_exchange to arrive
    if (!hasConversationKey(conversationId)) {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (hasConversationKey(conversationId)) break;
      }
    }

    if (!hasConversationKey(conversationId)) {
      throw new Error('Could not establish encryption with the other user. They may not have opened this conversation yet.');
    }
    const payload = await encryptForConversation(conversationId, plaintext);
    const id = uuidv4();
    await sendMessage(id, conversationId, myUserId, payload, replyToId);
  }, [conversationId, myUserId]);

  const deleteMsg = useCallback(async (messageId, mode = 'for_me') => {
    if (!conversationId) return;
    removeCachedMessage(conversationId, messageId);
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    try {
      if (mode === 'for_everyone') {
        const socket = getSocket();
        if (socket) {
          socket.emit('delete_message', { conversationId, messageId, mode });
        }
      } else {
        await apiDeleteMessage(conversationId, messageId, mode);
      }
    } catch (err) {
      console.error('Delete message failed:', err);
    }
  }, [conversationId]);

  const editMsg = useCallback(async (messageId, newPlaintext) => {
    if (!conversationId) return;
    if (!hasConversationKey(conversationId)) {
      await setupConversationKey(conversationId, myUserId);
    }
    const payload = await encryptForConversation(conversationId, newPlaintext);
    // Optimistic update
    updateCachedMessage(conversationId, messageId, (m) => ({ ...m, plaintext: newPlaintext, edited: true, payload }));
    setMessages((prev) => prev.map((m) =>
      m.id === messageId ? { ...m, plaintext: newPlaintext, edited: true, payload } : m
    ));
    const socket = getSocket();
    if (socket) {
      socket.emit('edit_message', { conversationId, messageId, payload });
    }
  }, [conversationId, myUserId]);

  return { messages, loading, loadingMore, hasMore, loadMore, sendMessage: sendMsg, deleteMessage: deleteMsg, editMessage: editMsg };
}
