import { useState, useRef, useEffect } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useMessages } from './hooks/useMessages.js';
import { useBackgroundPreloader } from './hooks/useBackgroundPreloader.js';
import { getSocket } from './services/socket.js';
import { completeKeyExchangeFromSocket, decryptConversationMessage, hasConversationKey } from './services/cryptoService.js';
import { appendCachedMessage } from './services/messageCache.js';
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

  // Background preload all conversations' keys + messages
  useBackgroundPreloader(user.id);

  // Global key_exchange listener — handles key exchanges for ANY conversation,
  // not just the active one. This ensures that when the peer opens a conversation
  // and publishes their key, we derive the shared secret even if we're looking
  // at a different chat. The useMessages hook handles key_exchange for the active conv.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleGlobalKeyExchange = async ({ conversationId, ephemeralPublicKey }) => {
      // The active conversation's key_exchange is handled by useMessages, skip it here
      if (conversationId === activeConversation?.id) return;
      try {
        await completeKeyExchangeFromSocket(conversationId, ephemeralPublicKey);
      } catch (err) {
        console.warn('[global] key_exchange handling failed for', conversationId, err.message);
      }
    };

    socket.on('key_exchange', handleGlobalKeyExchange);
    return () => { socket.off('key_exchange', handleGlobalKeyExchange); };
  }, [activeConversation?.id]);

  // Global message listener — catches messages for NON-ACTIVE conversations so
  // they are decrypted and appended to the message cache.  Without this, messages
  // arriving while the user views a different chat would be silently dropped and
  // only appear after a full server re-fetch.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleGlobalMessage = async (msg) => {
      // The active conversation is handled by useMessages — skip it here
      if (msg.conversationId === activeConversation?.id) return;
      if (!hasConversationKey(msg.conversationId)) return;
      try {
        const plaintext = await decryptConversationMessage(msg.conversationId, msg.payload);
        appendCachedMessage(msg.conversationId, { ...msg, plaintext });
      } catch {
        appendCachedMessage(msg.conversationId, { ...msg, plaintext: '[unable to decrypt]' });
      }
    };

    socket.on('message', handleGlobalMessage);
    return () => { socket.off('message', handleGlobalMessage); };
  }, [activeConversation?.id]);

  const { messages, loading: msgLoading, loadingMore, hasMore, loadMore, sendMessage, deleteMessage, editMessage } = useMessages(
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

  const handleSelectConversation = (conv) => {
    const names = (conv.participant_usernames || '').split(',').filter((n) => n !== user.username);
    const selected = { ...conv, displayName: conv.name || names.join(', ') || 'Conversation' };
    setActiveConversation(selected);
    localStorage.setItem('blink-active-conv', JSON.stringify(selected));
    setReplyTo(null);
    setEditingMsg(null);
  };

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
  const { user, login, register, logout, ready } = useAuth();
  const [view, setView] = useState('login');

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: '#0f0f0f', color: '#888' }}>
        Initializing…
      </div>
    );
  }

  if (user) {
    return <MessengerView user={user} logout={logout} />;
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
