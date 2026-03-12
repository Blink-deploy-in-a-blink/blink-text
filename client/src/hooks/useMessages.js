import { useState, useEffect, useCallback, useRef } from 'react';
import { getMessages } from '../services/api.js';
import { onMessage, offMessage, joinConversation, sendMessage as socketSend } from '../services/socket.js';
import {
  setupConversationKey,
  encryptAndSend,
  decryptMessage,
  hasConversationKey,
  completeKeyExchangeFromSocket,
} from '../services/cryptoService.js';
import { onKeyExchange } from '../services/socket.js';

/**
 * Hook that manages messages for a single conversation.
 * @param {string|null} conversationId
 * @param {string} myUserId
 */
export function useMessages(conversationId, myUserId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const setupRef = useRef(new Set());

  // Load historical messages and set up encryption when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    const init = async () => {
      setLoading(true);
      setError(null);

      try {
        joinConversation(conversationId);

        // Set up conversation key if not already done
        if (!setupRef.current.has(conversationId) && !hasConversationKey(conversationId)) {
          setupRef.current.add(conversationId);
          await setupConversationKey(conversationId, myUserId);
        }

        const raw = await getMessages(conversationId);
        if (cancelled) return;

        // Decrypt historical messages
        const decrypted = await Promise.all(
          raw.map(async (msg) => {
            if (!hasConversationKey(conversationId)) {
              return { ...msg, plaintext: '[key not available]' };
            }
            try {
              const plaintext = await decryptMessage(conversationId, msg);
              return { ...msg, plaintext };
            } catch {
              return { ...msg, plaintext: '[decryption failed]' };
            }
          })
        );

        if (!cancelled) setMessages(decrypted);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();

    // Handle incoming key exchange events for this conversation
    const handleKeyExchange = async (payload) => {
      if (payload.conversation_id !== conversationId) return;
      await completeKeyExchangeFromSocket(conversationId, payload.ephemeral_public_key);
    };
    onKeyExchange(handleKeyExchange);

    return () => {
      cancelled = true;
    };
  }, [conversationId, myUserId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to real-time incoming messages
  useEffect(() => {
    if (!conversationId) return;

    const handleIncoming = async (msg) => {
      if (msg.conversation_id !== conversationId) return;

      let plaintext = '[decryption failed]';
      try {
        if (hasConversationKey(conversationId)) {
          plaintext = await decryptMessage(conversationId, msg);
        }
      } catch {
        // leave default
      }

      setMessages((prev) => {
        // Deduplicate by id
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, { ...msg, plaintext }];
      });
    };

    onMessage(handleIncoming);
    return () => offMessage(handleIncoming);
  }, [conversationId]);

  const sendMessage = useCallback(
    async (plaintext) => {
      if (!conversationId) throw new Error('No active conversation');
      if (!hasConversationKey(conversationId)) {
        throw new Error('Conversation key not yet established');
      }

      const encrypted = await encryptAndSend(conversationId, plaintext);
      await socketSend(conversationId, encrypted);
    },
    [conversationId]
  );

  return { messages, loading, error, sendMessage };
}
