import { useState, useEffect, useImperativeHandle, forwardRef, useRef, useCallback } from 'react';
import { getConversations, changePassword, deleteAccount, blockUser, unblockUser, getBlocks, checkBlocked, clearChat, nukeChat, submitReport } from '../services/api.js';
import { getSocket, connectSocket } from '../services/socket.js';

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
const BlockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
);
const FlagIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
);
const EraserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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
  ctxMenu: {
    position: 'fixed', background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-md)', padding: '0.25rem 0', zIndex: 300,
    boxShadow: 'var(--shadow-lg)', minWidth: '180px',
  },
  ctxItem: {
    padding: '0.5rem 1rem', color: 'var(--text-primary)', cursor: 'pointer',
    fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
    transition: 'background 0.1s',
  },
  ctxItemDanger: {
    padding: '0.5rem 1rem', color: 'var(--danger-muted)', cursor: 'pointer',
    fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
    transition: 'background 0.1s',
  },
  confirmOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
  },
  confirmCard: {
    background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '1.75rem',
    maxWidth: '380px', width: '90%', color: 'var(--text-primary)',
    boxShadow: 'var(--shadow-lg)',
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

  // Conversation context menu state
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, conv }
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'block'|'clear'|'report', conv, peerName, peerId }
  const [reportReason, setReportReason] = useState('spam');
  const [reportDetails, setReportDetails] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState(null);
  const longPressTimerRef = useRef(null);

  // Blocked users state
  const [blockedUsers, setBlockedUsers] = useState([]); // [{ blocked_id, username, created_at }]
  const [blockedIds, setBlockedIds] = useState(new Set()); // quick lookup
  const [showBlockedList, setShowBlockedList] = useState(false);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [unblockingId, setUnblockingId] = useState(null);

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

  // Load blocked users list on mount
  const fetchBlocks = useCallback(async () => {
    try {
      const blocks = await getBlocks();
      setBlockedUsers(blocks || []);
      setBlockedIds(new Set((blocks || []).map((b) => b.blocked_id)));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

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
      const result = await changePassword(currentPw, newPw);
      // Server regenerates session nonce on password change — save the fresh token
      if (result?.token) {
        localStorage.setItem('blink-token', result.token);
        // Reconnect Socket.io with the new token so the WS session uses the fresh nonce
        connectSocket(result.token);
      }
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

  // ── Conversation context menu helpers ──

  // Close context menu on click anywhere
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [ctxMenu]);

  const getPeerInfo = useCallback((conv) => {
    if (conv.type !== 'direct_message') return null;
    const userIds = (conv.participant_ids || '').split(',').filter(Boolean);
    const usernames = (conv.participant_usernames || '').split(',').filter(Boolean);
    const myId = currentUser?.id;
    const peerIdx = userIds.findIndex((id) => id !== myId);
    if (peerIdx < 0) return null;
    return { id: userIds[peerIdx], name: usernames[peerIdx] || 'User' };
  }, [currentUser?.id]);

  const openCtxMenu = useCallback((e, conv) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 180;
    const x = Math.min(e.clientX || e.pageX || 0, window.innerWidth - menuWidth - 8);
    const y = Math.min(e.clientY || e.pageY || 0, window.innerHeight - 200);
    setCtxMenu({ x, y, conv });
  }, []);

  const handleCtxAction = useCallback((type) => {
    if (!ctxMenu?.conv) return;
    const conv = ctxMenu.conv;
    setCtxMenu(null);
    const peer = getPeerInfo(conv);
    setConfirmAction({
      type,
      conv,
      peerName: peer?.name || getDisplayName(conv),
      peerId: peer?.id || null,
    });
    setActionMsg(null);
    setReportReason('spam');
    setReportDetails('');
  }, [ctxMenu, getPeerInfo]);

  const executeAction = useCallback(async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      if (confirmAction.type === 'block') {
        await blockUser(confirmAction.peerId);
        setActionMsg({ type: 'success', text: `${confirmAction.peerName} has been blocked.` });
        fetchBlocks(); // refresh blocked list
        setTimeout(() => { setConfirmAction(null); }, 1200);
      } else if (confirmAction.type === 'unblock') {
        await unblockUser(confirmAction.peerId);
        setActionMsg({ type: 'success', text: `${confirmAction.peerName} has been unblocked.` });
        fetchBlocks(); // refresh blocked list
        setTimeout(() => { setConfirmAction(null); }, 1200);
      } else if (confirmAction.type === 'clear') {
        await clearChat(confirmAction.conv.id);
        setActionMsg({ type: 'success', text: 'Chat cleared.' });
        // Refresh messages by re-selecting the conversation
        if (confirmAction.conv.id === activeConversationId) {
          onSelect(confirmAction.conv); // triggers message reload
        }
        setTimeout(() => { setConfirmAction(null); }, 1200);
      } else if (confirmAction.type === 'nuke') {
        // Close modal immediately so the nuke animation is visible on the chat area
        const convToNuke = confirmAction.conv;
        setConfirmAction(null);
        setActionLoading(false);
        try {
          await nukeChat(convToNuke.id);
        } catch (nukeErr) {
          console.error('Nuke chat failed:', nukeErr);
        }
        // The conversation_nuked socket event handles animation + clearing messages
        return;
      } else if (confirmAction.type === 'report') {
        if (!confirmAction.peerId) throw new Error('Cannot determine user to report');
        await submitReport(confirmAction.peerId, reportReason, {
          conversationId: confirmAction.conv.id,
          details: reportDetails || undefined,
        });
        setActionMsg({ type: 'success', text: 'Report submitted. Thank you.' });
        setTimeout(() => { setConfirmAction(null); }, 1500);
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: err.response?.data?.error || err.message || 'Action failed' });
    } finally {
      setActionLoading(false);
    }
  }, [confirmAction, reportReason, reportDetails, activeConversationId, onSelect]);

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
            onContextMenu={(e) => openCtxMenu(e, conv)}
            onTouchStart={(e) => {
              const touch = e.touches[0];
              longPressTimerRef.current = setTimeout(() => {
                const menuWidth = 180;
                const x = Math.min(touch.clientX, window.innerWidth - menuWidth - 8);
                const y = Math.min(touch.clientY, window.innerHeight - 200);
                setCtxMenu({ x, y, conv });
              }, 600);
            }}
            onTouchEnd={() => clearTimeout(longPressTimerRef.current)}
            onTouchMove={() => clearTimeout(longPressTimerRef.current)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ ...s.name, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                {getDisplayName(conv)}
                {conv.disappear_after && (
                  <span title="Auto-delete enabled" style={{ display: 'inline-flex', color: 'var(--accent)', flexShrink: 0, opacity: 0.7 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </span>
                )}
                {conv.type === 'direct_message' && (() => {
                  const peer = getPeerInfo(conv);
                  return peer && blockedIds.has(peer.id) ? (
                    <span title="Blocked" style={{ display: 'inline-flex', color: 'var(--danger-muted)', flexShrink: 0 }}>
                      <BlockIcon />
                    </span>
                  ) : null;
                })()}
              </div>
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

        <button style={{ ...s.logoutBtn, marginBottom: '0.25rem' }} onClick={() => { setShowBlockedList(true); fetchBlocks(); }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <BlockIcon /> Blocked Users {blockedUsers.length > 0 && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger-muted)' }}>({blockedUsers.length})</span>}
          </span>
        </button>

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

      {/* ── Blocked Users panel ── */}
      {showBlockedList && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowBlockedList(false)}>
          <div style={{
            background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '1.5rem',
            maxWidth: '440px', width: '90%', color: 'var(--text-primary)',
            boxShadow: 'var(--shadow-lg)', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <BlockIcon /> Blocked Users
              </div>
              <button
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', padding: '0.25rem' }}
                onClick={() => setShowBlockedList(false)}
                aria-label="Close"
              >✕</button>
            </div>

            {blockedLoading ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center', padding: '2rem 0' }}>Loading…</p>
            ) : blockedUsers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: '0.25rem' }}>No blocked users</p>
                <p style={{ color: 'var(--text-faint)', fontSize: 'var(--text-xs)' }}>Users you block will appear here.</p>
              </div>
            ) : (
              <div style={{ overflowY: 'auto', flex: 1, margin: '0 -0.5rem', padding: '0 0.5rem' }}>
                {blockedUsers.map((bu) => (
                  <div key={bu.blocked_id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.65rem 0.75rem', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-active)', marginBottom: '0.5rem',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {bu.username}
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: '0.15rem' }}>
                        Blocked {new Date(bu.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      style={{
                        padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
                        background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer',
                        fontSize: 'var(--text-xs)', fontWeight: 600, flexShrink: 0, marginLeft: '0.75rem',
                        opacity: unblockingId === bu.blocked_id ? 0.5 : 1,
                      }}
                      disabled={unblockingId === bu.blocked_id}
                      onClick={async () => {
                        setUnblockingId(bu.blocked_id);
                        try {
                          await unblockUser(bu.blocked_id);
                          fetchBlocks();
                        } catch {
                          // silently fail — user can retry
                        } finally {
                          setUnblockingId(null);
                        }
                      }}
                    >
                      {unblockingId === bu.blocked_id ? 'Unblocking…' : 'Unblock'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Conversation context menu ── */}
      {ctxMenu && (
        <div style={{ ...s.ctxMenu, left: ctxMenu.x, top: ctxMenu.y }}>
          {ctxMenu.conv.type === 'direct_message' && (() => {
            const peer = getPeerInfo(ctxMenu.conv);
            const isBlocked = peer && blockedIds.has(peer.id);
            return isBlocked ? (
              <button style={s.ctxItem}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                onClick={() => handleCtxAction('unblock')}>
                <BlockIcon /> Unblock User
              </button>
            ) : (
              <button style={s.ctxItemDanger}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                onClick={() => handleCtxAction('block')}>
                <BlockIcon /> Block User
              </button>
            );
          })()}
          <button style={s.ctxItem}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => handleCtxAction('clear')}>
            <EraserIcon /> Clear Chat
          </button>
          <button style={s.ctxItemDanger}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => handleCtxAction('nuke')}>
            <TrashIcon /> Nuke Chat
          </button>
          {ctxMenu.conv.type === 'direct_message' && (
            <button style={s.ctxItem}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleCtxAction('report')}>
              <FlagIcon /> Report User
            </button>
          )}
        </div>
      )}

      {/* ── Confirmation / action modal ── */}
      {confirmAction && (
        <div style={s.confirmOverlay} onClick={() => !actionLoading && setConfirmAction(null)}>
          <div style={s.confirmCard} onClick={(e) => e.stopPropagation()}>

            {/* Block confirmation */}
            {confirmAction.type === 'block' && (
              <>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <BlockIcon /> Block {confirmAction.peerName}?
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.6, margin: '0 0 1rem' }}>
                  They won't be able to send you messages, and you won't be able to message them. You can unblock them later.
                </p>
                {actionMsg && <p style={{ fontSize: 'var(--text-sm)', color: actionMsg.type === 'error' ? 'var(--danger-muted)' : '#4ade80', textAlign: 'center', marginBottom: '0.75rem' }}>{actionMsg.text}</p>}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={() => setConfirmAction(null)} disabled={actionLoading}>Cancel</button>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={executeAction} disabled={actionLoading}>{actionLoading ? 'Blocking…' : 'Block'}</button>
                </div>
              </>
            )}

            {/* Unblock confirmation */}
            {confirmAction.type === 'unblock' && (
              <>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <BlockIcon /> Unblock {confirmAction.peerName}?
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.6, margin: '0 0 1rem' }}>
                  They will be able to send you messages again, and you'll be able to message them. Your existing conversation will be preserved.
                </p>
                {actionMsg && <p style={{ fontSize: 'var(--text-sm)', color: actionMsg.type === 'error' ? 'var(--danger-muted)' : '#4ade80', textAlign: 'center', marginBottom: '0.75rem' }}>{actionMsg.text}</p>}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={() => setConfirmAction(null)} disabled={actionLoading}>Cancel</button>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={executeAction} disabled={actionLoading}>{actionLoading ? 'Unblocking…' : 'Unblock'}</button>
                </div>
              </>
            )}

            {/* Clear chat confirmation */}
            {confirmAction.type === 'clear' && (
              <>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <EraserIcon /> Clear chat with {confirmAction.peerName}?
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.6, margin: '0 0 0.5rem' }}>
                  All messages will be removed from <strong>your view</strong>. The other person will still see them.
                </p>
                <p style={{ color: 'var(--text-faint)', fontSize: 'var(--text-xs)', lineHeight: 1.5, margin: '0 0 1rem' }}>
                  This does not delete the conversation — only clears the message history for you.
                </p>
                {actionMsg && <p style={{ fontSize: 'var(--text-sm)', color: actionMsg.type === 'error' ? 'var(--danger-muted)' : '#4ade80', textAlign: 'center', marginBottom: '0.75rem' }}>{actionMsg.text}</p>}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={() => setConfirmAction(null)} disabled={actionLoading}>Cancel</button>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={executeAction} disabled={actionLoading}>{actionLoading ? 'Clearing…' : 'Clear Chat'}</button>
                </div>
              </>
            )}

            {/* Nuke chat confirmation */}
            {confirmAction.type === 'nuke' && (
              <>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--danger-muted)' }}>
                  <TrashIcon /> Nuke chat with {confirmAction.peerName}?
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', lineHeight: 1.6, margin: '0 0 0.5rem' }}>
                  This will <strong>permanently delete all messages and media</strong> from the server for <strong>both participants</strong>.
                </p>
                <p style={{ color: 'var(--danger-muted)', fontSize: 'var(--text-xs)', lineHeight: 1.5, margin: '0 0 1rem', fontWeight: 600 }}>
                  This action is irreversible. Neither you nor {confirmAction.peerName} will be able to recover these messages.
                </p>
                {actionMsg && <p style={{ fontSize: 'var(--text-sm)', color: actionMsg.type === 'error' ? 'var(--danger-muted)' : '#4ade80', textAlign: 'center', marginBottom: '0.75rem' }}>{actionMsg.text}</p>}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={() => setConfirmAction(null)} disabled={actionLoading}>Cancel</button>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={executeAction} disabled={actionLoading}>{actionLoading ? 'Nuking…' : 'Nuke Chat'}</button>
                </div>
              </>
            )}

            {/* Report user */}
            {confirmAction.type === 'report' && (
              <>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FlagIcon /> Report {confirmAction.peerName}
                </div>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '0.35rem', fontWeight: 500 }}>Reason</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', marginBottom: '0.75rem' }}
                >
                  <option value="spam">Spam</option>
                  <option value="harassment">Harassment</option>
                  <option value="illegal_content">Illegal content</option>
                  <option value="impersonation">Impersonation</option>
                  <option value="other">Other</option>
                </select>
                <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '0.35rem', fontWeight: 500 }}>Details (optional)</label>
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Tell us more about this issue…"
                  rows={3}
                  style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', marginBottom: '0.75rem', resize: 'vertical', fontFamily: 'inherit' }}
                />
                {actionMsg && <p style={{ fontSize: 'var(--text-sm)', color: actionMsg.type === 'error' ? 'var(--danger-muted)' : '#4ade80', textAlign: 'center', marginBottom: '0.75rem' }}>{actionMsg.text}</p>}
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={() => setConfirmAction(null)} disabled={actionLoading}>Cancel</button>
                  <button style={{ flex: 1, padding: '0.65rem', borderRadius: 'var(--radius-md)', border: 'none', background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}
                    onClick={executeAction} disabled={actionLoading}>{actionLoading ? 'Submitting…' : 'Submit Report'}</button>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </aside>
  );
});

export default ConversationList;
