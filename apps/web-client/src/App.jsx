import { useState } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useMessages } from './hooks/useMessages.js';
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
  const [activeConversation, setActiveConversation] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const { messages, loading: msgLoading, sendMessage } = useMessages(
    activeConversation?.id || null,
    user.id
  );

  const handleSelectConversation = (conv) => {
    const names = (conv.participant_usernames || '').split(',').filter((n) => n !== user.username);
    setActiveConversation({ ...conv, displayName: conv.name || names.join(', ') || 'Conversation' });
  };

  const handleNewConversation = (conv) => {
    if (ConversationList.refresh) ConversationList.refresh();
    handleSelectConversation(conv);
  };

  const handleSend = async (text) => {
    try {
      await sendMessage(text);
    } catch (err) {
      console.error('Send failed:', err);
    }
  };

  return (
    <div style={appStyles.app}>
      <ConversationList
        activeConversationId={activeConversation?.id}
        onSelect={handleSelectConversation}
        onNewConversation={() => setShowNewModal(true)}
        onLogout={logout}
      />
      <div style={appStyles.main}>
        <ChatWindow
          conversation={activeConversation}
          messages={messages}
          myUserId={user.id}
          loading={msgLoading}
        />
        <MessageInput onSend={handleSend} disabled={!activeConversation} />
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
  const { user, login, register, logout } = useAuth();
  const [view, setView] = useState('login');

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
