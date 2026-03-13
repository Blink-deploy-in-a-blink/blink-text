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
        if (!hasConversationKey(conversationId)) {
          await setupConversationKey(conversationId, myUserId);
        }

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
      if (cid === conversationId) {
        await completeKeyExchangeFromSocket(conversationId, ephemeralPublicKey);
      }
    };

    socket.on('message', onMessage);
    socket.on('key_exchange', onKeyExchange);

    const onMessageDeleted = ({ messageId }) => {
      if (isMounted.current) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
      }
    };
    socket.on('message_deleted', onMessageDeleted);

    return () => {
      socket.off('message', onMessage);
      socket.off('key_exchange', onKeyExchange);
      socket.off('message_deleted', onMessageDeleted);
    };
  }, [conversationId]);

  const sendMsg = useCallback(async (plaintext) => {
    if (!conversationId) return;
    if (!hasConversationKey(conversationId)) {
      await setupConversationKey(conversationId, myUserId);
    }
    const payload = await encryptForConversation(conversationId, plaintext);
    const id = uuidv4();
    await sendMessage(id, conversationId, myUserId, payload);
  }, [conversationId, myUserId]);

  const deleteMsg = useCallback(async (messageId, mode = 'for_me') => {
    if (!conversationId) return;
    // Optimistic removal from local state
    setMessages((prev) => prev.filter((m) => m.id !== messageId));

    try {
      if (mode === 'for_everyone') {
        // Use socket so other participants get real-time removal
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

  return { messages, loading, sendMessage: sendMsg, deleteMessage: deleteMsg };
}
