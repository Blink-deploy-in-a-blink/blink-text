import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { getConversations, changePassword, deleteAccount } from '../services/api.js';
import { getSocket } from '../services/socket.js';

/* ── tiny SVG icons ── */
const ChatIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{position:'absolute',left:'0.65rem',top:'50%',transform:'translateY(-50%)',color:'var(--text-faint)',pointerEvents:'none'}}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
);
const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
);
const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
);
const ShieldIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
);
const HelpIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);
const ChevronIcon = ({ up }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{transition:'transform 0.2s',transform:up?'rotate(180deg)':'rotate(0deg)'}}><polyline points="6 9 12 15 18 9"/></svg>
);
const AlertIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);

const s = {
  sidebar: {
    width: '300px', borderRight: '1px solid var(--border-default)', display: 'flex',
    flexDirection: 'column', background: 'var(--bg-secondary)', flexShrink: 0,
    height: '100%', overflow: 'hidden',
  },
  header: {
    padding: '0.85rem 1rem', borderBottom: '1px solid var(--border-default)', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
  },
  title: { color: 'var(--text-primary)', fontWeight: 700, fontSize: 'var(--text-lg)', display: 'flex', alignItems: 'center', gap: '0.45rem' },
  newBtn: {
    background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
    padding: '0.4rem 0.85rem', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600,
  },
  list: { flex: 1, overflowY: 'auto', padding: '0.25rem 0' },
  item: (active) => ({
    padding: '0.7rem 1rem', cursor: 'pointer',
    background: active ? 'var(--bg-active)' : 'transparent',
    borderLeft: active ? '3px solid var(--accent)' : '3px solid transparent',
    transition: 'background 0.15s',
  }),
  name: { color: 'var(--text-primary)', fontWeight: 500, fontSize: 'var(--text-md)' },
  sub: { color: 'var(--text-faint)', fontSize: 'var(--text-xs)', marginTop: '0.15rem' },
  empty: { color: 'var(--text-faint)', textAlign: 'center', padding: '2rem 1rem', fontSize: 'var(--text-sm)', lineHeight: 1.6 },
  footer: {
    borderTop: '1px solid var(--border-default)', padding: '0.5rem 0.65rem',
    flexShrink: 0, overflowY: 'auto', maxHeight: '50%',
  },
  profileBtn: {
    width: '100%', padding: '0.55rem 0.65rem', border: 'none', borderRadius: 'var(--radius-md)',
    background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer',
    fontSize: 'var(--text-sm)', fontWeight: 600, textAlign: 'left',
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    transition: 'background 0.15s',
  },
  profilePanel: {
    padding: '0.65rem 0.75rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
    margin: '0.25rem 0',
  },
  profileLabel: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '0.35rem', fontWeight: 500 },
  profileInput: {
    width: '100%', padding: '0.45rem 0.6rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
    fontSize: 'var(--text-sm)', marginBottom: '0.5rem',
  },
  profileSaveBtn: {
    width: '100%', padding: '0.45rem', borderRadius: 'var(--radius-md)', border: 'none',
    background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-xs)',
    fontWeight: 600, marginBottom: '0.25rem',
  },
  profileMsg: { fontSize: 'var(--text-xs)', textAlign: 'center', marginBottom: '0.25rem' },
  logoutBtn: {
    width: '100%', padding: '0.5rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)',
    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)',
    marginTop: '0.25rem', fontWeight: 500, transition: 'background 0.15s, color 0.15s',
  },
  searchWrap: {
    padding: '0 0.75rem', flexShrink: 0, position: 'relative',
  },
  searchInput: {
    width: '100%', padding: '0.5rem 0.75rem 0.5rem 2rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-default)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
    fontSize: '16px', margin: '0.5rem 0',
  },
};

const ConversationList = forwardRef(function ConversationList({ activeConversationId, onSelect, onNewConversation, onLogout, currentUser, isMobile, getUnreadCount, isAdmin, onOpenAdmin, onShowHelp }, ref) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePw, setDeletePw] = useState('');
  const [keepConvos, setKeepConvos] = useState(true);
  const [deleteMsg, setDeleteMsg] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const load = async () => {
    try {
      const data = await getConversations();
      setConversations(data || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Listen for new conversations created by other users
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleNewConversation = () => {
      load(); // Refresh the full conversation list
    };

    const handleUserDeleted = () => {
      load(); // Refresh to pick up 'Deleted User' display names
    };

    socket.on('new_conversation', handleNewConversation);
    socket.on('user_deleted', handleUserDeleted);
    return () => {
      socket.off('new_conversation', handleNewConversation);
      socket.off('user_deleted', handleUserDeleted);
    };
  }, []);

  useImperativeHandle(ref, () => ({ refresh: load }));

  const username = currentUser?.username || (() => {
    try {
      const raw = localStorage.getItem('blink-user');
      return raw ? JSON.parse(raw).username : 'User';
    } catch { return 'User'; }
  })();

  const getDisplayName = (conv) => {
    if (conv.name) return conv.name;
    if (conv.type === 'direct_message') {
      const names = (conv.participant_usernames || '').split(',')
        .filter((n) => n && n !== username);
      return names.length > 0 ? names.join(', ') : 'Direct Message';
    }
    return `Group (${(conv.participant_usernames || '').split(',').filter(Boolean).length})`;
  };

  const handleChangePassword = async () => {
    setPwMsg(null);
    if (!currentPw || !newPw) { setPwMsg({ type: 'error', text: 'Fill in both fields' }); return; }
    if (newPw.length < 8) { setPwMsg({ type: 'error', text: 'New password must be at least 8 characters' }); return; }
    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setPwMsg({ type: 'success', text: 'Password changed!' });
      setCurrentPw('');
      setNewPw('');
    } catch (err) {
      setPwMsg({ type: 'error', text: err.response?.data?.error || 'Failed to change password' });
    } finally {
      setPwLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteMsg(null);
    if (!deletePw) { setDeleteMsg({ type: 'error', text: 'Enter your password to confirm' }); return; }
    setDeleteLoading(true);
    try {
      await deleteAccount(deletePw, !keepConvos);
      // Account deleted — log out
      onLogout();
    } catch (err) {
      setDeleteMsg({ type: 'error', text: err.response?.data?.error || 'Failed to delete account' });
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <aside style={{
      ...s.sidebar,
      ...(isMobile ? { width: '100%', borderRight: 'none' } : {}),
    }}>
      <div style={s.header}>
        <span style={s.title}><ChatIcon /> Conversations</span>
        <button style={s.newBtn} onClick={onNewConversation}>+ New</button>
      </div>
      <div style={s.searchWrap}>
        <SearchIcon />
        <input
          style={s.searchInput}
          type="text"
          placeholder="Search conversations…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div style={s.list}>
        {loading && <p style={s.empty}>Loading…</p>}
        {!loading && conversations.length === 0 && (
          <p style={s.empty}>No conversations yet.<br />Start one with "+ New".</p>
        )}
        {conversations
          .filter((conv) => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.toLowerCase();
            const displayName = getDisplayName(conv).toLowerCase();
            const usernames = (conv.participant_usernames || '').toLowerCase();
            return displayName.includes(q) || usernames.includes(q);
          })
          .map((conv) => (
          <div
            key={conv.id}
            style={s.item(conv.id === activeConversationId)}
            onClick={() => onSelect(conv)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={s.name}>{getDisplayName(conv)}</div>
              {getUnreadCount && getUnreadCount(conv.id) > 0 && (
                <span style={{
                  background: 'var(--accent)', color: '#fff', borderRadius: '10px',
                  fontSize: 'var(--text-xs)', fontWeight: 700, padding: '0.1rem 0.45rem',
                  minWidth: '18px', textAlign: 'center', lineHeight: '1.3',
                }}>
                  {getUnreadCount(conv.id) > 99 ? '99+' : getUnreadCount(conv.id)}
                </span>
              )}
            </div>
            <div style={s.sub}>{conv.type === 'direct_message' ? 'Direct' : 'Group'}</div>
          </div>
        ))}
      </div>
      <div style={s.footer}>
        <button
          style={s.profileBtn}
          onClick={() => setShowProfile(!showProfile)}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <UserIcon />
          <span>{username}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', display: 'flex' }}><ChevronIcon up={showProfile} /></span>
        </button>

        {showProfile && (
          <div style={s.profilePanel}>
            <div style={s.profileLabel}>Change Password</div>
            <input
              style={s.profileInput}
              type="password"
              placeholder="Current password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
            />
            <input
              style={s.profileInput}
              type="password"
              placeholder="New password (min 8 chars)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
            {pwMsg && (
              <p style={{ ...s.profileMsg, color: pwMsg.type === 'error' ? 'var(--danger-muted)' : '#4ade80' }}>
                {pwMsg.text}
              </p>
            )}
            <button style={s.profileSaveBtn} onClick={handleChangePassword} disabled={pwLoading}>
              {pwLoading ? 'Saving…' : 'Update Password'}
            </button>

            <div style={{ borderTop: '1px solid var(--border-light)', marginTop: '0.75rem', paddingTop: '0.75rem' }}>
              {!showDeleteConfirm ? (
                <button
                  style={{ ...s.logoutBtn, color: 'var(--danger-muted)', borderColor: 'rgba(248,113,113,0.2)', marginTop: 0 }}
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><TrashIcon /> Delete Account</span>
                </button>
              ) : (
                <>
                  <div style={{ ...s.profileLabel, color: 'var(--danger-muted)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}><AlertIcon /> Delete Account</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '0.5rem' }}>
                    This action cannot be undone.
                  </p>
                  <input
                    style={s.profileInput}
                    type="password"
                    placeholder="Enter your password"
                    value={deletePw}
                    onChange={(e) => setDeletePw(e.target.value)}
                    autoComplete="current-password"
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={keepConvos}
                      onChange={(e) => setKeepConvos(e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    Keep my conversations for others
                  </label>
                  {deleteMsg && (
                    <p style={{ ...s.profileMsg, color: 'var(--danger-muted)' }}>
                      {deleteMsg.text}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      style={{ ...s.profileSaveBtn, background: '#dc2626', flex: 1 }}
                      onClick={handleDeleteAccount}
                      disabled={deleteLoading}
                    >
                      {deleteLoading ? 'Deleting…' : 'Delete Forever'}
                    </button>
                    <button
                      style={{ ...s.logoutBtn, flex: 1, marginTop: 0 }}
                      onClick={() => { setShowDeleteConfirm(false); setDeletePw(''); setDeleteMsg(null); }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {isAdmin && (
          <button
            style={{ ...s.logoutBtn, color: 'var(--accent-muted)', borderColor: 'rgba(129,140,248,0.2)', marginBottom: '0.25rem' }}
            onClick={onOpenAdmin}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><ShieldIcon /> Admin Dashboard</span>
          </button>
        )}

        {onShowHelp && (
          <button style={{ ...s.logoutBtn, marginBottom: '0.25rem' }} onClick={onShowHelp}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><HelpIcon /> Help &amp; How-to</span>
          </button>
        )}

        <button style={s.logoutBtn} onClick={() => setShowLogoutConfirm(true)}>Sign Out</button>

        {/* Logout confirmation modal */}
        {showLogoutConfirm && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}>
            <div style={{
              background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '2rem',
              maxWidth: '420px', width: '90%', color: 'var(--text-primary)',
              boxShadow: 'var(--shadow-lg)',
            }}>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Sign out?
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)', lineHeight: 1.6, margin: '0 0 0.5rem' }}>
                You will be signed out of your account on this device.
              </p>
              <p style={{ color: 'var(--text-faint)', fontSize: 'var(--text-sm)', lineHeight: 1.6, margin: '0 0 1.25rem' }}>
                Your encryption keys will be kept on this device so you can still read your messages when you log back in.
              </p>
              <div style={{
                background: '#1a2a1a', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 'var(--radius-md)',
                padding: '0.75rem', marginBottom: '1.25rem', fontSize: 'var(--text-xs)', color: '#4ade80', lineHeight: 1.5,
              }}>
                ✓ Your message history will remain accessible on this device after re-login.
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  style={{
                    flex: 1, padding: '0.7rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-md)', fontWeight: 600,
                  }}
                  onClick={() => setShowLogoutConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  style={{
                    flex: 1, padding: '0.7rem', borderRadius: 'var(--radius-md)', border: 'none',
                    background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-md)', fontWeight: 600,
                  }}
                  onClick={() => { setShowLogoutConfirm(false); onLogout(); }}
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});

export default ConversationList;
