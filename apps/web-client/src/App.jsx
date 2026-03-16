import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useMessages } from './hooks/useMessages.js';
import { useBackgroundPreloader } from './hooks/useBackgroundPreloader.js';
import { getSocket, joinConversation } from './services/socket.js';
import { completeKeyExchangeFromSocket, setupConversationKey, handleKeyConfirm, decryptConversationMessage, hasConversationKey } from './services/cryptoService.js';
import { appendCachedMessage, incrementUnread, clearUnread, getUnreadCount, onUnreadChange } from './services/messageCache.js';
import { getConversations } from './services/api.js';
import Login from './components/Login.jsx';
import Register from './components/Register.jsx';
import ConversationList from './components/ConversationList.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import MessageInput from './components/MessageInput.jsx';
import NewConversationModal from './components/NewConversationModal.jsx';

const appStyles = {
  app: { display: 'flex', height: '100%', overflow: 'hidden', background: '#0f0f0f' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
};

// Simple mobile detection via width
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return mobile;
}

function MessengerView({ user, logout }) {
  const isMobile = useIsMobile();

  const [activeConversation, setActiveConversation] = useState(() => {
    try {
      const raw = localStorage.getItem('blink-active-conv');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [showNewModal, setShowNewModal] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMsg, setEditingMsg] = useState(null);
  const conversationListRef = useRef(null);
  // Force re-render key for unread badges
  const [, setUnreadTick] = useState(0);

  // Background preload all conversations' keys + messages
  useBackgroundPreloader(user.id);

  // Listen for unread count changes to re-render conversation list badges
  useEffect(() => {
    return onUnreadChange(() => setUnreadTick((t) => t + 1));
  }, []);

  // Validate activeConversation on mount — clear if stale (Issue 4.4)
  useEffect(() => {
    if (!activeConversation) return;
    (async () => {
      try {
        const conversations = await getConversations();
        const found = conversations.find((c) => c.id === activeConversation.id);
        if (!found) {
          // Conversation no longer exists or user was removed
          setActiveConversation(null);
          localStorage.removeItem('blink-active-conv');
        } else {
          // Update with fresh data (e.g. has_deleted_participant may have changed)
          const names = (found.participant_usernames || '').split(',').filter((n) => n !== user.username);
          setActiveConversation({ ...found, displayName: found.name || names.join(', ') || 'Conversation' });
        }
      } catch {
        // If API fails, keep the cached version
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Unified key_exchange listener — handles key exchanges for ALL conversations (Issue 2.2).
  // A single global handler eliminates the gap that occurred when two split listeners
  // (useMessages + App.jsx global) were removed and re-registered during conversation switches.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleKeyExchange = async ({ conversationId, ephemeralPublicKey }) => {
      try {
        await completeKeyExchangeFromSocket(conversationId, ephemeralPublicKey);
      } catch (err) {
        console.warn('[global] key_exchange handling failed for', conversationId, err.message);
      }
    };

    const handleKeyConfirmEvent = async ({ conversationId, confirmToken }) => {
      try {
        await handleKeyConfirm(conversationId, confirmToken, user.id);
      } catch (err) {
        console.warn('[global] key_confirm handling failed for', conversationId, err.message);
      }
    };

    socket.on('key_exchange', handleKeyExchange);
    socket.on('key_confirm', handleKeyConfirmEvent);
    return () => {
      socket.off('key_exchange', handleKeyExchange);
      socket.off('key_confirm', handleKeyConfirmEvent);
    };
  }, [user.id]);

  // Global message listener — catches messages for NON-ACTIVE conversations so
  // they are decrypted and appended to the message cache + unread count.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleGlobalMessage = async (msg) => {
      // The active conversation is handled by useMessages — skip it here
      if (msg.conversationId === activeConversation?.id) return;
      // Track unread regardless of whether we can decrypt
      incrementUnread(msg.conversationId);
      if (!hasConversationKey(msg.conversationId)) return;
      try {
        const plaintext = await decryptConversationMessage(msg.conversationId, msg.payload);
        appendCachedMessage(msg.conversationId, { ...msg, plaintext });
      } catch (err) {
        console.warn('[global] Failed to decrypt message for', msg.conversationId, err.message);
        appendCachedMessage(msg.conversationId, { ...msg, plaintext: '[unable to decrypt]' });
      }
    };

    socket.on('message', handleGlobalMessage);
    return () => { socket.off('message', handleGlobalMessage); };
  }, [activeConversation?.id]);

  // When a new_conversation event arrives, auto-join the room and start key exchange (Issue 1.4)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewConversation = async ({ conversation }) => {
      if (!conversation?.id) return;
      // Join the socket room immediately so we receive messages and key_exchange events
      joinConversation(conversation.id);
      // Initiate key exchange (fire-and-forget, 0 retries)
      try {
        await setupConversationKey(conversation.id, user.id, { maxRetries: 0, retryDelay: 0 });
      } catch (err) {
        console.warn('[global] Failed to preload new conversation key:', conversation.id, err.message);
      }
    };

    socket.on('new_conversation', handleNewConversation);
    return () => { socket.off('new_conversation', handleNewConversation); };
  }, [user.id]);

  const { messages, loading: msgLoading, loadingMore, hasMore, loadMore, sendMessage, sendMediaMessage, deleteMessage, editMessage } = useMessages(
    activeConversation?.id || null,
    user.id
  );

  // When a user is deleted, update the active conversation if they were the peer
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleUserDeleted = ({ userId }) => {
      if (!activeConversation) return;
      const participantIds = (activeConversation.participant_ids || '').split(',');
      if (participantIds.includes(userId)) {
        setActiveConversation((prev) => prev ? { ...prev, has_deleted_participant: 1, displayName: 'Deleted User' } : prev);
      }
    };

    socket.on('user_deleted', handleUserDeleted);
    return () => { socket.off('user_deleted', handleUserDeleted); };
  }, [activeConversation]);

  const handleSelectConversation = useCallback((conv) => {
    const names = (conv.participant_usernames || '').split(',').filter((n) => n !== user.username);
    const selected = { ...conv, displayName: conv.name || names.join(', ') || 'Conversation' };
    setActiveConversation(selected);
    localStorage.setItem('blink-active-conv', JSON.stringify(selected));
    setReplyTo(null);
    setEditingMsg(null);
    // Clear unread count when switching to this conversation
    clearUnread(conv.id);
  }, [user.username]);

  const handleNewConversation = (conv) => {
    conversationListRef.current?.refresh();
    handleSelectConversation(conv);
  };

  const handleSend = async (text, replyToId) => {
    try {
      await sendMessage(text, replyToId);
      setReplyTo(null);
    } catch (err) {
      console.error('Send failed:', err);
    }
  };

  const handleSendMedia = async (file, messageType, replyToId) => {
    try {
      await sendMediaMessage(file, messageType, replyToId);
      setReplyTo(null);
    } catch (err) {
      console.error('Send media failed:', err);
    }
  };

  const handleSaveEdit = async (messageId, newText) => {
    try {
      await editMessage(messageId, newText);
      setEditingMsg(null);
    } catch (err) {
      console.error('Edit failed:', err);
    }
  };

  // On mobile: show sidebar when no conversation selected, show chat when one is selected
  const showSidebar = !isMobile || !activeConversation;
  const showChat = !isMobile || !!activeConversation;

  const handleBack = () => {
    setActiveConversation(null);
    localStorage.removeItem('blink-active-conv');
    setReplyTo(null);
    setEditingMsg(null);
  };

  return (
    <div style={appStyles.app}>
      {showSidebar && (
        <ConversationList
          ref={conversationListRef}
          activeConversationId={activeConversation?.id}
          onSelect={handleSelectConversation}
          onNewConversation={() => setShowNewModal(true)}
          onLogout={logout}
          currentUser={user}
          isMobile={isMobile}
          getUnreadCount={getUnreadCount}
        />
      )}
      {showChat && (
        <div style={appStyles.main}>
          <ChatWindow
            conversation={activeConversation}
            messages={messages}
            myUserId={user.id}
            loading={msgLoading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onLoadMore={loadMore}
            onDeleteMessage={deleteMessage}
            onEditMessage={(msg) => { setEditingMsg(msg); setReplyTo(null); }}
            onReply={(msg) => { setReplyTo(msg); setEditingMsg(null); }}
            onNewConversation={() => setShowNewModal(true)}
            onBack={isMobile ? handleBack : null}
          />
          <MessageInput
            onSend={handleSend}
            onSendMedia={handleSendMedia}
            onSaveEdit={handleSaveEdit}
            disabled={!activeConversation || !!activeConversation?.has_deleted_participant}
            replyTo={replyTo}
            editingMsg={editingMsg}
            onCancelReply={() => setReplyTo(null)}
            onCancelEdit={() => setEditingMsg(null)}
            peerDeleted={!!activeConversation?.has_deleted_participant}
          />
        </div>
      )}

      {showNewModal && (
        <NewConversationModal
          currentUser={user}
          onClose={() => setShowNewModal(false)}
          onCreated={handleNewConversation}
        />
      )}
    </div>
  );
}

export default function App() {
  const { user, login, register, logout, ready, identityError, retryIdentity } = useAuth();
  const [view, setView] = useState('login');

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0f0f0f', color: '#888' }}>
        Initializing…
      </div>
    );
  }

  if (user) {
    return (
      <>
        {identityError && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: '#d32f2f', color: '#fff', padding: '10px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: '14px', fontFamily: 'sans-serif',
          }}>
            <span>⚠️ Encryption setup failed: {identityError}. Messages cannot be sent until this is resolved.</span>
            <button
              onClick={retryIdentity}
              style={{
                background: '#fff', color: '#d32f2f', border: 'none', borderRadius: '4px',
                padding: '6px 14px', cursor: 'pointer', fontWeight: 'bold', marginLeft: '12px',
                whiteSpace: 'nowrap',
              }}
            >
              Retry
            </button>
          </div>
        )}
        <MessengerView user={user} logout={logout} />
      </>
    );
  }

  if (view === 'register') {
    return (
      <Register
        onRegister={register}
        onSwitchToLogin={() => setView('login')}
      />
    );
  }

  return (
    <Login
      onLogin={login}
      onSwitchToRegister={() => setView('register')}
    />
  );
}
