import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getMessages, deleteMessage as apiDeleteMessage, uploadMedia } from '../services/api.js';
import { getSocket, joinConversation, leaveConversation, sendMessage } from '../services/socket.js';
import {
  setupConversationKey,
  encryptForConversation,
  encryptMediaForConversation,
  decryptConversationMessage,
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
  const prevConversationId = useRef(null);

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
    // Leave the previous conversation room when switching (Issue 1.2)
    if (prevConversationId.current && prevConversationId.current !== conversationId) {
      leaveConversation(prevConversationId.current);
    }
    prevConversationId.current = conversationId;

    if (!conversationId) { setMessages([]); setHasMore(false); return; }

    // Show cached messages immediately if available, otherwise clear old messages
    // to prevent the previous conversation's messages from bleeding through.
    const cached = getCachedMessages(conversationId);
    if (cached) {
      setMessages(cached.messages);
      setHasMore(cached.hasMore);
    } else {
      // CRITICAL: Clear messages from the previous conversation immediately.
      // Without this, old messages stay visible until the new ones load (or forever
      // if key setup fails), causing the "all convos show the same messages" bug.
      setMessages([]);
      setHasMore(false);
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
          // Merge: keep any messages that arrived via socket while we were loading
          // (e.g. optimistic sends or real-time echoes) that aren't in the fetch result.
          setMessages((prev) => {
            const fetchedIds = new Set(decrypted.map((m) => m.id));
            // Messages in prev that are NOT in the fetched set — they arrived
            // after the fetch started (optimistic sends, socket echoes).
            const extras = prev.filter((m) => !fetchedIds.has(m.id));
            const merged = [...decrypted, ...extras];
            setCachedMessages(conversationId, merged, more);
            return merged;
          });
          setHasMore(more);
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

  // Socket event listeners — key_exchange is now handled globally in App.jsx (Issue 2.2)
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
          setMessages((prev) => {
            // Single-pass: replace optimistic placeholder or append new
            const idx = prev.findIndex((m) => m.id === decryptedMsg.id);
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = decryptedMsg;
              return updated;
            }
            return [...prev, decryptedMsg];
          });
        }
      } catch (err) {
        console.warn('[useMessages] Failed to decrypt incoming message:', msg.id, err);
        const failedMsg = { ...msg, plaintext: '[unable to decrypt]' };
        appendCachedMessage(conversationId, failedMsg);
        if (isMounted.current) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === failedMsg.id)) return prev;
            return [...prev, failedMsg];
          });
        }
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
    socket.on('message_deleted', onMessageDeleted);
    socket.on('message_edited', onMessageEdited);

    return () => {
      socket.off('message', onMessage);
      socket.off('message_deleted', onMessageDeleted);
      socket.off('message_edited', onMessageEdited);
    };
  }, [conversationId]);

  // Ensure a conversation key is available, with retries and socket fallback
  const ensureConversationKey = useCallback(async () => {
    if (!conversationId) return;
    if (!hasConversationKey(conversationId)) {
      await setupConversationKey(conversationId, myUserId, { maxRetries: 6, retryDelay: 500 });
    }
    if (!hasConversationKey(conversationId)) {
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (hasConversationKey(conversationId)) break;
      }
    }
    if (!hasConversationKey(conversationId)) {
      throw new Error('Could not establish encryption with the other user. They may not have opened this conversation yet.');
    }
  }, [conversationId, myUserId]);

  // Optimistic send — show message locally before server confirms (Issue 3.1)
  const sendMsg = useCallback(async (plaintext, replyToId = null) => {
    if (!conversationId) return;
    await ensureConversationKey();

    const payload = await encryptForConversation(conversationId, plaintext);
    const id = uuidv4();

    // Optimistic: show the message locally before the server roundtrip
    const optimisticMsg = {
      id,
      conversationId,
      senderId: myUserId,
      timestamp: Date.now(),
      replyToId: replyToId || null,
      edited: false,
      payload,
      plaintext,
      _optimistic: true, // marker; replaced when server echo arrives
    };
    appendCachedMessage(conversationId, optimisticMsg);
    if (isMounted.current) {
      setMessages((prev) => [...prev, optimisticMsg]);
    }

    await sendMessage(id, conversationId, myUserId, payload, replyToId);
  }, [conversationId, myUserId, ensureConversationKey]);

  // Send a media message (image, video, or voice)
  const sendMediaMsg = useCallback(async (file, messageType, replyToId = null) => {
    if (!conversationId) return;
    await ensureConversationKey();

    // Read the file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuffer);

    // Encrypt the file binary
    const { encrypted, iv } = await encryptMediaForConversation(conversationId, fileBytes);

    // Base64-encode IV for upload
    let binary = '';
    for (let i = 0; i < iv.byteLength; i++) binary += String.fromCharCode(iv[i]);
    const ivBase64 = btoa(binary);

    // Upload encrypted file to server
    const { mediaId } = await uploadMedia(conversationId, encrypted, ivBase64);

    // Encrypt metadata as the message payload (text portion)
    const metadata = JSON.stringify({
      fileName: file.name || (messageType === 'voice' ? 'voice-note.webm' : 'media'),
      mimeType: file.type || 'application/octet-stream',
      fileSize: file.size,
    });
    const payload = await encryptForConversation(conversationId, metadata);
    const id = uuidv4();

    // Optimistic: show the message locally
    const optimisticMsg = {
      id,
      conversationId,
      senderId: myUserId,
      timestamp: Date.now(),
      replyToId: replyToId || null,
      edited: false,
      payload,
      plaintext: metadata,
      messageType,
      mediaId,
      _optimistic: true,
    };
    appendCachedMessage(conversationId, optimisticMsg);
    if (isMounted.current) {
      setMessages((prev) => [...prev, optimisticMsg]);
    }

    await sendMessage(id, conversationId, myUserId, payload, replyToId, messageType, mediaId);
  }, [conversationId, myUserId, ensureConversationKey]);

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

  return { messages, loading, loadingMore, hasMore, loadMore, sendMessage: sendMsg, sendMediaMessage: sendMediaMsg, deleteMessage: deleteMsg, editMessage: editMsg };
}
