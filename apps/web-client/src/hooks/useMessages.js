import { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getMessages, deleteMessage as apiDeleteMessage, uploadMedia, getParticipants } from '../services/api.js';
import { getSocket, joinConversation, leaveConversation, sendMessage } from '../services/socket.js';
import {
  setupConversationKey,
  encryptForConversation,
  encryptMediaForConversation,
  decryptConversationMessage,
  hasConversationKey,
  restoreConversationKey,
} from '../services/cryptoService.js';
import {
  isGroupConversation,
  setupGroupKeys,
  hasGroupKeys,
  rotateMySenderKey,
} from '../services/groupCrypto.js';
import { emitSenderKeyDistributed } from '../services/socket.js';
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
  const [keyReady, setKeyReady] = useState(false);
  const isMounted = useRef(true);
  const prevConversationId = useRef(null);
  // In-memory queue of messages waiting for key exchange to complete.
  // Each entry: { type: 'text'|'media', plaintext?, file?, messageType?, replyToId?, optimisticMsg }
  const pendingQueue = useRef([]);
  // Cache of messages that failed decryption — keyed by messageId.
  // Used for retry when keys arrive later (Fix 3).
  // Each entry: { msg (full raw message with payload), senderId }
  const failedDecryptCache = useRef(new Map());

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Retry decrypting previously failed messages when keys become available.
  const retryFailedDecryptions = useCallback(async () => {
    if (failedDecryptCache.current.size === 0) return;
    const retried = [];
    for (const [msgId, cached] of failedDecryptCache.current) {
      try {
        const plaintext = await decryptConversationMessage(conversationId, cached.msg.payload, cached.senderId);
        retried.push({ msgId, plaintext });
      } catch (err) {
        // Still can't decrypt — leave in cache for next retry
        console.debug('[useMessages] Retry decrypt still failed for', msgId, err.message);
      }
    }
    if (retried.length === 0) return;

    // Remove successfully decrypted messages from the cache
    for (const { msgId } of retried) {
      failedDecryptCache.current.delete(msgId);
    }

    // Update UI: replace stub messages with decrypted content
    if (isMounted.current) {
      setMessages((prev) => prev.map((m) => {
        const match = retried.find((r) => r.msgId === m.id);
        if (match) {
          const updated = { ...m, plaintext: match.plaintext, _undecryptable: false };
          updateCachedMessage(conversationId, m.id, () => updated);
          return updated;
        }
        return m;
      }));
    }
    console.log('[useMessages] Retried and decrypted', retried.length, 'previously failed messages');
  }, [conversationId]);

  // Decrypt a batch of raw messages — shows stubs for undecryptable ones (Fix 4)
  const decryptBatch = useCallback(async (rawMessages) => {
    return Promise.all(
      rawMessages.map(async (msg) => {
        try {
          const plaintext = await decryptConversationMessage(conversationId, msg.payload, msg.senderId);
          return { ...msg, plaintext };
        } catch (err) {
          console.warn('[useMessages] Failed to decrypt message:', msg.id, err);
          // Cache the failed message for later retry (Fix 3)
          failedDecryptCache.current.set(msg.id, { msg, senderId: msg.senderId });
          // Return a stub with metadata preserved (Fix 4)
          return { ...msg, plaintext: null, _undecryptable: true };
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

    if (!conversationId) { setMessages([]); setHasMore(false); setKeyReady(false); return; }

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

    // Reset queue and failed decryption cache for the new conversation
    pendingQueue.current = [];
    failedDecryptCache.current.clear();

    // Set initial keyReady state
    setKeyReady(hasConversationKey(conversationId));

    setLoading(!cached); // Only show loading spinner if no cache

    let cancelled = false;
    (async () => {
      try {
        // Join the socket room first so we receive key_exchange events during setup
        joinConversation(conversationId);

        if (isGroupConversation(conversationId)) {
          // Group conversations: check if we have sender keys (set up by App.jsx handleSelectConversation)
          // If not ready yet, just mark key as ready (group setup happens asynchronously)
          const groupReady = hasGroupKeys(conversationId);
          if (isMounted.current && !cancelled) setKeyReady(groupReady || true); // allow loading messages even if keys pending
        } else {
          // DM conversations: try restoring key from IndexedDB first, then ECDH exchange
          await setupConversationKey(conversationId, myUserId);

          // Update keyReady state
          const keyAvailable = hasConversationKey(conversationId);
          if (isMounted.current && !cancelled) setKeyReady(keyAvailable);

          // Even if no key, still load messages — show stubs (Fix 4)
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

  // Listen for key-ready events (fired by cryptoService when key exchange completes).
  // When the key arrives: mark keyReady, flush any queued messages, retry failed decryptions, and fetch history.
  useEffect(() => {
    if (!conversationId) return;

    const handleKeyReady = async (e) => {
      if (e.detail?.conversationId !== conversationId) return;
      if (!hasConversationKey(conversationId)) return;
      if (!isMounted.current) return;

      console.log('[useMessages] Key ready for', conversationId.slice(0, 8), '— flushing queue');
      setKeyReady(true);

      // Retry previously failed decryptions now that we have a key (Fix 3)
      await retryFailedDecryptions();

      // Flush queued messages
      const queue = [...pendingQueue.current];
      pendingQueue.current = [];

      for (const entry of queue) {
        try {
          if (entry.type === 'text') {
            const payload = await encryptForConversation(conversationId, entry.plaintext);
            // Update the optimistic message: remove _queued, set payload
            if (isMounted.current) {
              setMessages((prev) => prev.map((m) =>
                m.id === entry.id ? { ...m, _queued: false, _optimistic: true, payload } : m
              ));
            }
            await sendMessage(entry.id, conversationId, myUserId, payload, entry.replyToId);
          }
          // Media queuing is not supported (too complex with file references) —
          // the send button for media is disabled when key is not ready.
        } catch (err) {
          console.error('[useMessages] Failed to flush queued message:', entry.id, err);
          // Mark the message as failed
          if (isMounted.current) {
            setMessages((prev) => prev.map((m) =>
              m.id === entry.id ? { ...m, _queued: false, _failed: true } : m
            ));
          }
        }
      }

      // Now fetch message history (in case the peer sent messages before we had a key)
      try {
        const { messages: rawMessages, hasMore: more } = await getMessages(conversationId, { limit: 50 });
        const decrypted = await Promise.all(
          rawMessages.map(async (msg) => {
            try {
              const plaintext = await decryptConversationMessage(conversationId, msg.payload, msg.senderId);
              return { ...msg, plaintext };
            } catch {
              // Cache for retry (Fix 3), show stub (Fix 4)
              failedDecryptCache.current.set(msg.id, { msg, senderId: msg.senderId });
              return { ...msg, plaintext: null, _undecryptable: true };
            }
          })
        );
        if (isMounted.current) {
          setMessages((prev) => {
            const fetchedIds = new Set(decrypted.map((m) => m.id));
            const extras = prev.filter((m) => !fetchedIds.has(m.id));
            const merged = [...decrypted, ...extras];
            setCachedMessages(conversationId, merged, more);
            return merged;
          });
          setHasMore(more);
        }
      } catch (err) {
        console.warn('[useMessages] Failed to fetch messages after key ready:', err.message);
      }
    };

    window.addEventListener('blink-key-ready', handleKeyReady);
    return () => window.removeEventListener('blink-key-ready', handleKeyReady);
  }, [conversationId, myUserId, retryFailedDecryptions]);

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

  // Listen for group key ready events to retry failed group message decryptions (Fix 3)
  useEffect(() => {
    if (!conversationId) return;
    const handleGroupKeyReady = async (e) => {
      if (e.detail?.conversationId !== conversationId) return;
      if (!isMounted.current) return;
      console.log('[useMessages] Group key ready — retrying failed decryptions');
      await retryFailedDecryptions();
    };
    window.addEventListener('blink-group-key-ready', handleGroupKeyReady);
    return () => window.removeEventListener('blink-group-key-ready', handleGroupKeyReady);
  }, [conversationId, retryFailedDecryptions]);

  // Socket event listeners — key_exchange is now handled globally in App.jsx (Issue 2.2)
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    if (!socket) return;

    const onMessage = async (msg) => {
      // Only handle messages for the currently active conversation
      if (msg.conversationId !== conversationId) return;
      try {
        const plaintext = await decryptConversationMessage(conversationId, msg.payload, msg.senderId);
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
        // Cache for retry when keys arrive (Fix 3)
        failedDecryptCache.current.set(msg.id, { msg, senderId: msg.senderId });
        // Show stub with metadata (Fix 4)
        const stubMsg = { ...msg, plaintext: null, _undecryptable: true };
        appendCachedMessage(conversationId, stubMsg);
        if (isMounted.current) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === stubMsg.id)) return prev;
            return [...prev, stubMsg];
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
        // Look up the original sender from current messages (only the sender can edit)
        const originalMsg = messages.find((m) => m.id === messageId);
        const senderId = originalMsg?.senderId;
        const plaintext = await decryptConversationMessage(conversationId, payload, senderId);
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

    // Disappearing messages: server deleted expired messages
    const onMessagesExpired = ({ conversationId: cid, messageIds }) => {
      if (cid !== conversationId) return;
      if (!Array.isArray(messageIds) || messageIds.length === 0) return;
      const expiredSet = new Set(messageIds);
      // Remove from cache
      for (const mid of messageIds) removeCachedMessage(conversationId, mid);
      if (isMounted.current) {
        setMessages((prev) => prev.filter((m) => !expiredSet.has(m.id)));
      }
    };

    // Nuke chat: all messages wiped from server
    const onConversationNuked = ({ conversationId: cid }) => {
      if (cid !== conversationId) return;
      // Dispatch event so ChatWindow can play the nuke animation
      window.dispatchEvent(new CustomEvent('blink-nuke', { detail: { conversationId: cid } }));
      // Delay clearing messages so the animation plays over them before they vanish
      setTimeout(() => {
        setCachedMessages(conversationId, [], false);
        if (isMounted.current) {
          setMessages([]);
          setHasMore(false);
        }
      }, 800);
    };

    socket.on('messages_expired', onMessagesExpired);
    socket.on('conversation_nuked', onConversationNuked);

    // ── Group sender key socket events — kick/expire are kept per-conversation ──
    // sender_key_distributed and sender_key_request are now handled globally in App.jsx

    const onUserKicked = async ({ conversationId: cid, kickedUserId }) => {
      if (cid !== conversationId) return;
      // Rotate sender keys so the kicked member can no longer decrypt future messages
      if (isGroupConversation(conversationId) && kickedUserId !== myUserId) {
        try {
          // Server already removed the kicked user; fetch fresh participant list
          const participants = await getParticipants(conversationId);
          const remainingIds = participants.map(p => p.id);
          await rotateMySenderKey(conversationId, myUserId, remainingIds, { emitSenderKeyDistributed });
        } catch (err) {
          console.warn('[useMessages] Failed to rotate sender key after kick:', err.message);
        }
      }
      // Refresh participants list — dispatched as custom event for ChatWindow to handle
      window.dispatchEvent(new CustomEvent('blink-user-kicked', {
        detail: { conversationId: cid, kickedUserId },
      }));
    };

    const onConversationExpired = ({ conversationId: cid }) => {
      if (cid !== conversationId) return;
      window.dispatchEvent(new CustomEvent('blink-conversation-expired', {
        detail: { conversationId: cid },
      }));
    };

    socket.on('user_kicked', onUserKicked);
    socket.on('conversation_expired', onConversationExpired);

    return () => {
      socket.off('message', onMessage);
      socket.off('message_deleted', onMessageDeleted);
      socket.off('message_edited', onMessageEdited);
      socket.off('messages_expired', onMessagesExpired);
      socket.off('conversation_nuked', onConversationNuked);
      socket.off('user_kicked', onUserKicked);
      socket.off('conversation_expired', onConversationExpired);
    };
  }, [conversationId, myUserId]);

  // Ensure a conversation key is available, with retries and socket fallback.
  // Returns true if key is available, false if not (message will be queued).
  const tryEnsureKey = useCallback(async () => {
    if (!conversationId) return false;
    // Group conversations use sender keys, not DM key exchange
    if (isGroupConversation(conversationId)) {
      return hasGroupKeys(conversationId);
    }
    if (hasConversationKey(conversationId)) return true;
    await setupConversationKey(conversationId, myUserId, { maxRetries: 6, retryDelay: 500 });
    if (hasConversationKey(conversationId)) return true;
    // Wait a bit more for a key_exchange socket event
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (hasConversationKey(conversationId)) return true;
    }
    return false;
  }, [conversationId, myUserId]);

  // Optimistic send — show message locally before server confirms (Issue 3.1)
  // If no key is available, queues the message in memory and sends it when the key arrives.
  const sendMsg = useCallback(async (plaintext, replyToId = null) => {
    if (!conversationId) return;

    const id = uuidv4();
    const keyAvailable = isGroupConversation(conversationId)
      ? hasGroupKeys(conversationId)
      : hasConversationKey(conversationId);

    if (!keyAvailable) {
      // Queue the message in memory — it will be flushed when the key arrives
      const queuedMsg = {
        id,
        conversationId,
        senderId: myUserId,
        timestamp: Date.now(),
        replyToId: replyToId || null,
        edited: false,
        payload: null,
        plaintext,
        _queued: true, // visible clock icon in ChatWindow
      };
      pendingQueue.current.push({ type: 'text', id, plaintext, replyToId });
      if (isMounted.current) {
        setMessages((prev) => [...prev, queuedMsg]);
      }
      // Attempt key setup in background (non-blocking)
      tryEnsureKey().then((ready) => {
        if (ready && isMounted.current) setKeyReady(true);
      });
      return;
    }

    const payload = await encryptForConversation(conversationId, plaintext);

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
  }, [conversationId, myUserId, tryEnsureKey]);

  // Send a media message (image, video, or voice)
  // Media cannot be queued (file references may become stale) — requires key to be ready.
  const sendMediaMsg = useCallback(async (file, messageType, replyToId = null) => {
    if (!conversationId) return;
    const ready = await tryEnsureKey();
    if (!ready) {
      throw new Error('Encryption not established yet. The other user needs to open this conversation first.');
    }

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
  }, [conversationId, myUserId, tryEnsureKey]);

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
    if (!isGroupConversation(conversationId) && !hasConversationKey(conversationId)) {
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

  return { messages, loading, loadingMore, hasMore, keyReady, loadMore, sendMessage: sendMsg, sendMediaMessage: sendMediaMsg, deleteMessage: deleteMsg, editMessage: editMsg };
}
