import { useState, useEffect, useCallback } from 'react';
import { useMessages } from '../hooks/useMessages.js';
import { getSocket, joinConversation } from '../services/socket.js';
import { getGuestSession, isGuestRoomExpired, leaveGuestSession, registerGuestEventHandlers } from '../services/guestSession.js';
import { registerGroupConversation, setupGroupKeys, handleSenderKeyDistributed, handleSenderKeyRequest, handleGroupPairwiseExchange } from '../services/groupCrypto.js';
import { getParticipants } from '../services/api.js';
import { emitSenderKeyDistributed } from '../services/socket.js';
import ChatWindow from './ChatWindow.jsx';
import MessageInput from './MessageInput.jsx';

const s = {
  wrapper: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: 'var(--bg-primary)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.75rem 1rem', background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)',
  },
  roomName: { color: 'var(--text-primary)', fontWeight: 700, fontSize: 'var(--text-lg)' },
  guestBadge: {
    fontSize: 'var(--text-xs)', color: 'var(--accent-muted)', background: 'var(--accent-bg)',
    padding: '0.15rem 0.5rem', borderRadius: 'var(--radius-full)', fontWeight: 500,
  },
  leaveBtn: {
    background: 'transparent', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)',
    color: 'var(--danger-muted)', cursor: 'pointer', padding: '0.4rem 0.75rem', fontSize: 'var(--text-sm)',
    fontWeight: 500,
  },
  center: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
    background: 'var(--bg-primary)', color: 'var(--text-muted)', flexDirection: 'column', gap: '1rem',
  },
  link: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
  expired: { color: 'var(--danger-muted)', fontWeight: 600, fontSize: 'var(--text-md)' },
};

export default function GuestChatView({ guestSession, onLeave }) {
  const { guestSessionId, conversationId, conversationName, expiresAt } = guestSession;
  const [kicked, setKicked] = useState(false);
  const [expired, setExpired] = useState(() => isGuestRoomExpired());
  const [groupKeysReady, setGroupKeysReady] = useState(false);

  // Build conversation object with live participant data
  const [participantIds, setParticipantIds] = useState('');
  const [participantUsernames, setParticipantUsernames] = useState('');

  const conversation = {
    id: conversationId,
    name: conversationName,
    displayName: conversationName,
    type: 'group_chat',
    participant_ids: participantIds,
    participant_usernames: participantUsernames,
  };

  // Helper: fetch participants and update the conversation object
  const refreshParticipants = useCallback(async () => {
    try {
      const participants = await getParticipants(conversationId);
      setParticipantIds(participants.map((p) => p.id).join(','));
      setParticipantUsernames(participants.map((p) => p.username || 'Unknown').join(','));
      return participants;
    } catch (err) {
      console.warn('[GuestChat] Failed to fetch participants:', err.message);
      return [];
    }
  }, [conversationId]);

  // Register group conversation + set up keys.
  // No setupDone ref — setupGroupKeys has its own per-conversation lock and
  // short-circuits if keys already exist, so repeated calls are safe.
  // This ensures crypto state is restored on remount / page reload.
  useEffect(() => {
    registerGroupConversation(conversationId);
    joinConversation(conversationId);

    let cancelled = false;
    (async () => {
      try {
        const participants = await refreshParticipants();
        if (cancelled) return;
        const pIds = participants.map((p) => p.user_id || p.id);
        await setupGroupKeys(conversationId, guestSessionId, pIds, {
          emitSenderKeyDistributed,
        });
        if (!cancelled) setGroupKeysReady(true);
      } catch (err) {
        console.warn('[GuestChat] Group key setup failed:', err.message);
        if (!cancelled) setGroupKeysReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [conversationId, guestSessionId, refreshParticipants]);

  // Refresh participant list when someone joins or leaves
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onUserJoined = ({ conversationId: cid }) => {
      if (cid !== conversationId) return;
      refreshParticipants().then((participants) => {
        if (!participants.length) return;
        const pIds = participants.map((p) => p.user_id || p.id);
        setupGroupKeys(conversationId, guestSessionId, pIds, {
          emitSenderKeyDistributed,
        }).catch((err) => {
          console.warn('[GuestChat] Re-setup after user_joined failed:', err.message);
        });
      });
    };
    const onUserKicked = ({ conversationId: cid }) => {
      if (cid === conversationId) refreshParticipants();
    };
    socket.on('user_joined', onUserJoined);
    socket.on('user_kicked', onUserKicked);
    return () => {
      socket.off('user_joined', onUserJoined);
      socket.off('user_kicked', onUserKicked);
    };
  }, [conversationId, refreshParticipants]);

  // Register guest event handlers (kick, expiry)
  useEffect(() => {
    registerGuestEventHandlers({
      onKicked: () => setKicked(true),
      onExpired: () => setExpired(true),
    });
  }, []);

  // Global sender key handlers for the guest context
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const deps = {
      emitSenderKeyDistributed,
      getMyUserId: () => guestSessionId,
    };

    const onSenderKeyDistributed = async ({ conversationId: cid, senderUserId }) => {
      if (cid !== conversationId) return;
      try {
        await handleSenderKeyDistributed(conversationId, senderUserId, deps);
      } catch (err) {
        console.warn('[guest] sender_key_distributed failed:', err.message);
      }
    };

    const onSenderKeyRequest = async ({ conversationId: cid, requestingUserId }) => {
      if (cid !== conversationId) return;
      try {
        await handleSenderKeyRequest(conversationId, requestingUserId, deps);
      } catch (err) {
        console.warn('[guest] sender_key_request failed:', err.message);
      }
    };

    const onGroupPairwiseExchange = async ({ conversationId: cid, fromUserId }) => {
      if (cid !== conversationId) return;
      try {
        await handleGroupPairwiseExchange(conversationId, fromUserId, guestSessionId, deps);
      } catch (err) {
        console.warn('[guest] group_pairwise_exchange failed:', err.message);
      }
    };

    socket.on('sender_key_distributed', onSenderKeyDistributed);
    socket.on('sender_key_request', onSenderKeyRequest);
    socket.on('group_pairwise_exchange', onGroupPairwiseExchange);
    return () => {
      socket.off('sender_key_distributed', onSenderKeyDistributed);
      socket.off('sender_key_request', onSenderKeyRequest);
      socket.off('group_pairwise_exchange', onGroupPairwiseExchange);
    };
  }, [conversationId, guestSessionId]);

  // Use the standard messages hook
  const {
    messages, loading: msgLoading, loadingMore, hasMore, keyReady,
    loadMore, sendMessage, sendMediaMessage, deleteMessage,
  } = useMessages(groupKeysReady ? conversationId : null, guestSessionId);

  const handleSend = useCallback(async (text, replyToId) => {
    if (!text.trim()) return;
    await sendMessage(text, replyToId);
  }, [sendMessage]);

  const handleSendMedia = useCallback(async (file, messageType, replyToId) => {
    await sendMediaMessage(file, messageType, replyToId);
  }, [sendMediaMessage]);

  const handleLeave = () => {
    leaveGuestSession();
    onLeave();
  };

  // Kicked state
  if (kicked) {
    return (
      <div style={s.center}>
        <p style={s.expired}>You have been removed from this room</p>
        <a href="/#/" style={s.link} onClick={handleLeave}>Back to Blink</a>
      </div>
    );
  }

  // Expired state
  if (expired) {
    return (
      <div style={s.center}>
        <p style={s.expired}>This room has expired</p>
        <a href="/#/" style={s.link} onClick={handleLeave}>Back to Blink</a>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={s.roomName}>{conversationName}</span>
          <span style={s.guestBadge}>Guest</span>
        </div>
        <button style={s.leaveBtn} onClick={handleLeave}>Leave Room</button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
        <ChatWindow
          conversation={conversation}
          messages={messages}
          myUserId={guestSessionId}
          loading={msgLoading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          keyReady={keyReady}
          onLoadMore={loadMore}
          onDeleteMessage={deleteMessage}
          onEditMessage={() => {}}
          onReply={() => {}}
          onForward={() => {}}
          onReport={() => {}}
          onNewConversation={() => {}}
          onBack={null}
          onTimerChanged={() => {}}
          isGuest
        />
        <MessageInput
          onSend={handleSend}
          onSendMedia={handleSendMedia}
          onSaveEdit={() => {}}
          disabled={false}
          replyTo={null}
          editingMsg={null}
          onCancelReply={() => {}}
          onCancelEdit={() => {}}
          peerDeleted={false}
          keyReady={keyReady}
        />
      </div>
    </div>
  );
}
