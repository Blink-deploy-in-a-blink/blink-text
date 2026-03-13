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

export function useMessages(conversationId, myUserId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Load message history when conversation changes
  useEffect(() => {
    if (!conversationId) { setMessages([]); return; }

    setLoading(true);
    (async () => {
      try {
        // Always run setupConversationKey — it checks for stale keys and re-derives if needed
        await setupConversationKey(conversationId, myUserId);

        joinConversation(conversationId);

        const rawMessages = await getMessages(conversationId);
        const decrypted = await Promise.all(
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

        if (isMounted.current) setMessages(decrypted);
      } catch (err) {
        console.error('Failed to load messages:', err);
      } finally {
        if (isMounted.current) setLoading(false);
      }
    })();
  }, [conversationId, myUserId]);

  // Socket event listeners
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    if (!socket) return;

    const onMessage = async (msg) => {
      try {
        const plaintext = await decryptConversationMessage(conversationId, msg.payload);
        if (isMounted.current) {
          setMessages((prev) => [...prev, { ...msg, plaintext }]);
        }
      } catch (err) {
        console.warn('[useMessages] Failed to decrypt incoming message:', msg.id, err);
        if (isMounted.current) {
          setMessages((prev) => [...prev, { ...msg, plaintext: '[unable to decrypt]' }]);
        }
      }
    };

    const onKeyExchange = async ({ conversationId: cid, ephemeralPublicKey }) => {
      if (cid !== conversationId) return;
      await completeKeyExchangeFromSocket(conversationId, ephemeralPublicKey);

      // Re-decrypt all loaded messages with the (possibly updated) key
      if (!isMounted.current) return;
      try {
        const rawMessages = await getMessages(conversationId);
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
        if (isMounted.current) setMessages(decrypted);
      } catch {
        // If re-fetch fails, leave existing messages as-is
      }
    };

    const onMessageDeleted = ({ messageId }) => {
      if (isMounted.current) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    };

    const onMessageEdited = async ({ messageId, payload }) => {
      try {
        const plaintext = await decryptConversationMessage(conversationId, payload);
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
    if (!hasConversationKey(conversationId)) {
      await setupConversationKey(conversationId, myUserId);
    }
    const payload = await encryptForConversation(conversationId, plaintext);
    const id = uuidv4();
    await sendMessage(id, conversationId, myUserId, payload, replyToId);
  }, [conversationId, myUserId]);

  const deleteMsg = useCallback(async (messageId, mode = 'for_me') => {
    if (!conversationId) return;
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
    setMessages((prev) => prev.map((m) =>
      m.id === messageId ? { ...m, plaintext: newPlaintext, edited: true, payload } : m
    ));
    const socket = getSocket();
    if (socket) {
      socket.emit('edit_message', { conversationId, messageId, payload });
    }
  }, [conversationId, myUserId]);

  return { messages, loading, sendMessage: sendMsg, deleteMessage: deleteMsg, editMessage: editMsg };
}
