import { useState, useRef, useEffect } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useMessages } from './hooks/useMessages.js';
import { getSocket } from './services/socket.js';
import Login from './components/Login.jsx';
import Register from './components/Register.jsx';
import ConversationList from './components/ConversationList.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import MessageInput from './components/MessageInput.jsx';
import NewConversationModal from './components/NewConversationModal.jsx';

const appStyles = {
  app: { display: 'flex', height: '100vh', overflow: 'hidden', background: '#0f0f0f' },
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
};

function MessengerView({ user, logout }) {
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

  const { messages, loading: msgLoading, sendMessage, deleteMessage, editMessage } = useMessages(
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

  return (
    <div style={appStyles.app}>
      <ConversationList
        ref={conversationListRef}
        activeConversationId={activeConversation?.id}
        onSelect={handleSelectConversation}
        onNewConversation={() => setShowNewModal(true)}
        onLogout={logout}
        currentUser={user}
      />
      <div style={appStyles.main}>
        <ChatWindow
          conversation={activeConversation}
          messages={messages}
          myUserId={user.id}
          loading={msgLoading}
          onDeleteMessage={deleteMessage}
          onEditMessage={(msg) => { setEditingMsg(msg); setReplyTo(null); }}
          onReply={(msg) => { setReplyTo(msg); setEditingMsg(null); }}
          onNewConversation={() => setShowNewModal(true)}
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f0f0f', color: '#888' }}>
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
