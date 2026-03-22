import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useMessages } from './hooks/useMessages.js';
import { useBackgroundPreloader } from './hooks/useBackgroundPreloader.js';
import { getSocket, joinConversation } from './services/socket.js';
import { completeKeyExchangeFromSocket, setupConversationKey, handleKeyConfirm, decryptConversationMessage, hasConversationKey } from './services/cryptoService.js';
import { appendCachedMessage, incrementUnread, clearUnread, getUnreadCount, getTotalUnread, onUnreadChange } from './services/messageCache.js';
import { getConversations } from './services/api.js';
import { verifyAdmin } from './services/api.js';
import { forwardMessage } from './services/forwardService.js';
import { isGroupConversation, registerGroupConversation, setupGroupKeys } from './services/groupCrypto.js';
import { emitSenderKeyDistributed } from './services/socket.js';
import { isGuest, getGuestSession } from './services/guestSession.js';
import Login from './components/Login.jsx';
import Register from './components/Register.jsx';
import ConversationList from './components/ConversationList.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import MessageInput from './components/MessageInput.jsx';
import NewConversationModal from './components/NewConversationModal.jsx';
import ForwardModal from './components/ForwardModal.jsx';
import ReportModal from './components/ReportModal.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import TermsOfService from './components/TermsOfService.jsx';
import PrivacyPolicy from './components/PrivacyPolicy.jsx';
import WelcomePage from './components/WelcomePage.jsx';
import HelpPage from './components/HelpPage.jsx';
import SessionExpiredModal from './components/SessionExpiredModal.jsx';
import JoinRoomPage from './components/JoinRoomPage.jsx';
import GuestChatView from './components/GuestChatView.jsx';
import MaintenancePage from './components/MaintenancePage.jsx';

const MAINTENANCE_MODE = import.meta.env.VITE_MAINTENANCE_MODE === 'true';

const appStyles = {
  app: { display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg-primary)' },
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

// ── Hash-based routing ──────────────────────────────────────────────
// Every screen transition pushes a hash entry so the browser Back button
// navigates within the app instead of leaving it.
//
// Routes:
//   #/              → Welcome (unauth) or Messenger list (auth)
//   #/login         → Login page
//   #/register      → Register page
//   #/terms         → Terms of Service
//   #/privacy       → Privacy Policy
//   #/help          → Help page
//   #/r/:slug       → Room invite join page
//   #/chat/:convId  → Active conversation (auth, mobile back → list)
//   #/admin         → Admin panel (auth)

function parseHashRoute() {
  const hash = window.location.hash || '#/';
  // Room invite link
  const roomMatch = hash.match(/^#\/r\/([A-Za-z0-9_-]{4,32})$/);
  if (roomMatch) return { route: 'room', slug: roomMatch[1] };
  // Active conversation
  const chatMatch = hash.match(/^#\/chat\/([0-9a-f-]{36})$/);
  if (chatMatch) return { route: 'chat', convId: chatMatch[1] };
  // Named routes
  if (hash === '#/login') return { route: 'login' };
  if (hash === '#/register') return { route: 'register' };
  if (hash === '#/terms') return { route: 'terms' };
  if (hash === '#/privacy') return { route: 'privacy' };
  if (hash === '#/help') return { route: 'help' };
  if (hash === '#/admin') return { route: 'admin' };
  return { route: 'main' };
}

/** Push a new hash route (creates a browser history entry). */
function navigate(path) {
  const target = '#' + path;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
}

/** Replace current hash route without creating a history entry. */
function navigateReplace(path) {
  const target = '#' + path;
  if (window.location.hash !== target) {
    window.history.replaceState(null, '', target);
    // Manually dispatch hashchange so listeners pick it up
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
}

function MessengerView({ user, logout, onShowHelp }) {
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
  const [forwardingMsg, setForwardingMsg] = useState(null); // message to forward
  const [reportTarget, setReportTarget] = useState(null); // { userId, username, conversationId, messageId }
  const [showAdminPanel, setShowAdminPanel] = useState(() => parseHashRoute().route === 'admin');
  // Admin status is fetched fresh from the server on every mount.
  // NEVER stored in localStorage — always verified against the DB via /api/admin/verify.
  const [isAdmin, setIsAdmin] = useState(false);
  const conversationListRef = useRef(null);
  // Force re-render key for unread badges
  const [, setUnreadTick] = useState(0);

  // ── Sync hash → in-app state (browser Back navigates within the app) ──
  useEffect(() => {
    const onHash = () => {
      const r = parseHashRoute();
      if (r.route === 'admin') {
        setShowAdminPanel(true);
      } else if (r.route === 'chat' && r.convId) {
        setShowAdminPanel(false);
        // If we're navigating back to a different conversation, the selection
        // is updated from localStorage below. The convId in hash is the source
        // of truth for "should a conversation be open".
        // If convId doesn't match active, reload from localStorage (browser back)
        setActiveConversation((prev) => {
          if (prev && prev.id === r.convId) return prev;
          try {
            const raw = localStorage.getItem('blink-active-conv');
            const stored = raw ? JSON.parse(raw) : null;
            if (stored && stored.id === r.convId) return stored;
          } catch { /* ignore */ }
          return prev;
        });
      } else if (r.route === 'main' || r.route === 'help') {
        // Back to conversation list or help
        setShowAdminPanel(false);
        if (r.route === 'main') {
          setActiveConversation(null);
          localStorage.removeItem('blink-active-conv');
          setReplyTo(null);
          setEditingMsg(null);
        }
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Background preload all conversations' keys + messages
  useBackgroundPreloader(user.id);

  // Check admin status fresh from server on every mount.
  // This calls GET /api/admin/verify which checks the DB directly.
  // Never trusts client-side data — the server is the only source of truth.
  useEffect(() => {
    verifyAdmin().then(setIsAdmin);
  }, []);

  // Listen for unread count changes to re-render conversation list badges
  useEffect(() => {
    return onUnreadChange(() => setUnreadTick((t) => t + 1));
  }, []);

  // Update page title with total unread count (e.g., "(3) Blink Text")
  useEffect(() => {
    const updateTitle = () => {
      const total = getTotalUnread();
      document.title = total > 0 ? `(${total > 99 ? '99+' : total}) Blink Text` : 'Blink Text';
    };
    updateTitle();
    return onUnreadChange(updateTitle);
  }, []);

  // Request notification permission on first render (non-blocking)
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      // Delay the request slightly so it doesn't appear during page load
      const t = setTimeout(() => Notification.requestPermission(), 3000);
      return () => clearTimeout(t);
    }
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

      // Fire browser notification when tab is hidden (never reveal plaintext — privacy first)
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification('Blink Text', {
            body: 'New encrypted message',
            icon: '/favicon.ico',
            tag: 'blink-msg-' + msg.conversationId, // collapse multiple from same convo
            silent: false,
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch { /* notification not supported in this context */ }
      }

      if (!hasConversationKey(msg.conversationId)) return;
      try {
        const plaintext = await decryptConversationMessage(msg.conversationId, msg.payload, msg.senderId);
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

      if (conversation.type === 'group_chat') {
        // Group: register and set up sender keys
        registerGroupConversation(conversation.id);
        try {
          const participantIds = (conversation.participant_ids || '').split(',').filter(Boolean);
          await setupGroupKeys(conversation.id, user.id, participantIds, { emitSenderKeyDistributed });
        } catch (err) {
          console.warn('[global] Failed to setup group keys for new conversation:', conversation.id, err.message);
        }
      } else {
        // DM: Initiate key exchange (fire-and-forget, 0 retries)
        try {
          await setupConversationKey(conversation.id, user.id, { maxRetries: 0, retryDelay: 0 });
        } catch (err) {
          console.warn('[global] Failed to preload new conversation key:', conversation.id, err.message);
        }
      }
    };

    socket.on('new_conversation', handleNewConversation);
    return () => { socket.off('new_conversation', handleNewConversation); };
  }, [user.id]);

  const { messages, loading: msgLoading, loadingMore, hasMore, keyReady, loadMore, sendMessage, sendMediaMessage, deleteMessage, editMessage } = useMessages(
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

  // Global conversation_timer_changed listener — updates active conversation's timer
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleTimerChanged = ({ conversationId, disappearAfter }) => {
      // Update the active conversation in state so ChatWindow's header reflects the change
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => prev ? { ...prev, disappear_after: disappearAfter } : prev);
      }
      // Refresh conversation list to update timer badges
      conversationListRef.current?.refresh();
    };

    // Also listen for conversation_nuked to clear active chat + refresh list
    const handleConversationNuked = ({ conversationId }) => {
      conversationListRef.current?.refresh();
      // useMessages already handles clearing messages for the active conversation
    };

    socket.on('conversation_timer_changed', handleTimerChanged);
    socket.on('conversation_nuked', handleConversationNuked);

    // When a new user (or guest) joins a room we're in, refresh participant data
    // so display names resolve correctly instead of showing UUIDs.
    const handleUserJoined = async ({ conversationId }) => {
      if (activeConversation?.id !== conversationId) return;
      try {
        const conversations = await getConversations();
        const fresh = conversations.find((c) => c.id === conversationId);
        if (fresh) {
          const names = (fresh.participant_usernames || '').split(',').filter((n) => n !== user.username);
          setActiveConversation((prev) => prev ? {
            ...prev,
            participant_ids: fresh.participant_ids,
            participant_usernames: fresh.participant_usernames,
            displayName: fresh.name || names.join(', ') || 'Conversation',
          } : prev);
        }
      } catch { /* ignore */ }
      conversationListRef.current?.refresh();
    };
    socket.on('user_joined', handleUserJoined);

    return () => {
      socket.off('conversation_timer_changed', handleTimerChanged);
      socket.off('conversation_nuked', handleConversationNuked);
      socket.off('user_joined', handleUserJoined);
    };
  }, [activeConversation?.id, user.username]);

  const handleSelectConversation = useCallback(async (conv) => {
    const names = (conv.participant_usernames || '').split(',').filter((n) => n !== user.username);
    const selected = { ...conv, displayName: conv.name || names.join(', ') || 'Conversation' };
    setActiveConversation(selected);
    localStorage.setItem('blink-active-conv', JSON.stringify(selected));
    setReplyTo(null);
    setEditingMsg(null);
    // Clear unread count when switching to this conversation
    clearUnread(conv.id);

    // On mobile: push hash so Back returns to conversation list.
    // On desktop: replace hash so Back doesn't cycle through every conversation.
    if (isMobile) {
      navigate('/chat/' + conv.id);
    } else {
      navigateReplace('/chat/' + conv.id);
    }

    // For group conversations: ensure sender key is distributed
    if (conv.type === 'group_chat') {
      try {
        if (!isGroupConversation(conv.id)) {
          registerGroupConversation(conv.id);
        }
        const participantIds = (conv.participant_ids || '').split(',').filter(Boolean);
        await setupGroupKeys(conv.id, user.id, participantIds, {
          emitSenderKeyDistributed,
        });
      } catch (err) {
        console.warn('[group] Sender key setup failed for', conv.id, err.message);
      }
    }
  }, [user.username, user.id, isMobile]);

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

  const handleForward = async (msg, targetConversationId) => {
    try {
      await forwardMessage(msg, activeConversation.id, targetConversationId, user.id);
    } catch (err) {
      console.error('Forward failed:', err);
      throw err; // re-throw so ForwardModal can handle it
    }
  };

  const handleReport = (msg) => {
    // Look up the sender's username from participant info
    const ids = (activeConversation?.participant_ids || '').split(',').filter(Boolean);
    const names = (activeConversation?.participant_usernames || '').split(',').filter(Boolean);
    const idx = ids.indexOf(msg.senderId);
    const senderUsername = idx >= 0 && idx < names.length ? names[idx] : 'Unknown user';
    setReportTarget({
      userId: msg.senderId,
      username: senderUsername,
      conversationId: activeConversation?.id,
      messageId: msg.id,
    });
  };

  // On mobile: show sidebar when no conversation selected, show chat when one is selected
  const showSidebar = !isMobile || !activeConversation;
  const showChat = !isMobile || !!activeConversation;

  const handleBack = () => {
    if (isMobile) {
      // Mobile: use real browser back so the history stack stays clean.
      // navigate() pushed #/chat/:id, so back() pops to #/ (conversation list).
      if (window.history.length > 1) {
        window.history.back();
      } else {
        navigateReplace('/');
      }
    } else {
      // Desktop: conversation was opened via navigateReplace, so there's no
      // history entry to go back to. Just clear the selection directly.
      navigateReplace('/');
    }
  };

  return (
    <div style={appStyles.app}>
      {showAdminPanel ? (
        <AdminPanel onClose={() => window.history.back()} />
      ) : (
        <>
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
              isAdmin={isAdmin}
              onOpenAdmin={() => navigate('/admin')}
              onShowHelp={onShowHelp}
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
                keyReady={keyReady}
                onLoadMore={loadMore}
                onDeleteMessage={deleteMessage}
                onEditMessage={(msg) => { setEditingMsg(msg); setReplyTo(null); }}
                onReply={(msg) => { setReplyTo(msg); setEditingMsg(null); }}
                onForward={(msg) => setForwardingMsg(msg)}
                onReport={handleReport}
                onNewConversation={() => setShowNewModal(true)}
                onBack={handleBack}
                onTimerChanged={() => conversationListRef.current?.refresh()}
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
                keyReady={keyReady}
              />
            </div>
          )}
        </>
      )}

      {showNewModal && (
        <NewConversationModal
          currentUser={user}
          onClose={() => setShowNewModal(false)}
          onCreated={handleNewConversation}
        />
      )}

      {forwardingMsg && (
        <ForwardModal
          message={forwardingMsg}
          currentUserId={user.id}
          currentConversationId={activeConversation?.id}
          onForward={handleForward}
          onClose={() => setForwardingMsg(null)}
        />
      )}

      {reportTarget && (
        <ReportModal
          reportedUserId={reportTarget.userId}
          reportedUsername={reportTarget.username}
          conversationId={reportTarget.conversationId}
          messageId={reportTarget.messageId}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  const { user, login, register, logout, ready, identityError, retryIdentity } = useAuth();
  const [sessionExpired, setSessionExpired] = useState(false);
  const [hashRoute, setHashRoute] = useState(parseHashRoute);
  // Guest session state: set after a guest successfully joins a room
  const [guestSession, setGuestSession] = useState(() => getGuestSession());

  // Listen for hash changes (browser Back, navigate() calls, etc.)
  useEffect(() => {
    const onHash = () => setHashRoute(parseHashRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // ── SECURITY: Prevent stale authenticated content after logout ──
  // 1. bfcache: If the browser restores the page from back-forward cache after logout,
  //    detect it via the `pageshow` event and force a full reload.
  // 2. visibility: When the user switches back to this tab, verify the session is still
  //    valid. If the token was cleared (logout in another tab, or session expired), reload.
  useEffect(() => {
    const onPageShow = (e) => {
      if (e.persisted) {
        // Page was restored from bfcache — check if the user is still logged in
        const token = localStorage.getItem('blink-token');
        const session = sessionStorage.getItem('blink-session');
        if (!token && !session) {
          // Session was destroyed — force a clean reload to prevent stale content
          window.location.replace(window.location.pathname + '#/');
          window.location.reload();
        }
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        const token = localStorage.getItem('blink-token');
        const session = sessionStorage.getItem('blink-session');
        if (!token && !session && user) {
          // User was logged in but session is gone — force reload
          window.location.replace(window.location.pathname + '#/');
          window.location.reload();
        }
      }
    };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user]);

  // Listen for session-expired events from the API interceptor or WebSocket
  useEffect(() => {
    const handler = () => setSessionExpired(true);
    window.addEventListener('blink-session-expired', handler);
    return () => window.removeEventListener('blink-session-expired', handler);
  }, []);

  if (MAINTENANCE_MODE) {
    return <MaintenancePage />;
  }

  // Show the session expired modal on top of everything
  if (sessionExpired) {
    return <SessionExpiredModal />;
  }

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-primary, #0a0a0a)', color: 'var(--text-muted, #888)' }}>
        Initializing…
      </div>
    );
  }

  // Handle /#/r/:slug — room invite link (shown whether logged in or not)
  if (hashRoute.route === 'room') {
    return (
      <JoinRoomPage
        slug={hashRoute.slug}
        onJoined={(data) => {
          // After joining, transition to guest chat mode
          window.location.hash = '#/';
          setHashRoute({ route: 'main' });
          setGuestSession(getGuestSession());
        }}
      />
    );
  }

  // Guest mode: show the guest chat view for the joined room
  if (guestSession && !user) {
    return (
      <GuestChatView
        guestSession={guestSession}
        onLeave={() => {
          setGuestSession(null);
          navigateReplace('/');
        }}
      />
    );
  }

  // Logged-in users go straight to the messenger (or help/terms/privacy if requested)
  if (user) {
    // If logged in but hash is on an auth page, silently redirect to main
    if (['login', 'register', 'terms', 'privacy'].includes(hashRoute.route)) {
      navigateReplace('/');
    }
    if (hashRoute.route === 'help') {
      return <HelpPage onBack={() => navigate('/')} />;
    }
    return (
      <>
        {identityError && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: '#d32f2f', color: '#fff', padding: '10px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: '14px', fontFamily: 'inherit',
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
        <MessengerView user={user} logout={logout} onShowHelp={() => navigate('/help')} />
      </>
    );
  }

  // ── Not logged in — route based on hash ──

  // SECURITY: If the hash points to an authenticated route but user is not logged in,
  // redirect to the welcome page. This prevents stale hashes (e.g. from browser history)
  // from rendering any authenticated content.
  if (['chat', 'admin'].includes(hashRoute.route)) {
    navigateReplace('/');
    return null;
  }

  if (hashRoute.route === 'help') {
    return <HelpPage onBack={() => navigate('/')} />;
  }

  if (hashRoute.route === 'terms') {
    return <TermsOfService onBack={() => navigate('/register')} />;
  }

  if (hashRoute.route === 'privacy') {
    return <PrivacyPolicy onBack={() => navigate('/register')} />;
  }

  if (hashRoute.route === 'register') {
    return (
      <Register
        onRegister={register}
        onSwitchToLogin={() => navigate('/login')}
        onShowTerms={() => navigate('/terms')}
        onShowPrivacy={() => navigate('/privacy')}
      />
    );
  }

  if (hashRoute.route === 'login') {
    return (
      <Login
        onLogin={login}
        onSwitchToRegister={() => navigate('/register')}
      />
    );
  }

  // Default: welcome page
  return (
    <WelcomePage
      onLogin={() => navigate('/login')}
      onRegister={() => navigate('/register')}
      onShowTerms={() => navigate('/terms')}
      onShowPrivacy={() => navigate('/privacy')}
      onShowHelp={() => navigate('/help')}
    />
  );
}
