import { useState, useEffect, useImperativeHandle, forwardRef } from 'react';
import { getConversations, changePassword } from '../services/api.js';

const s = {
  sidebar: {
    width: '280px', borderRight: '1px solid #222', display: 'flex',
    flexDirection: 'column', background: '#111', flexShrink: 0,
  },
  header: {
    padding: '1rem', borderBottom: '1px solid #222', display: 'flex',
    alignItems: 'center', justifyContent: 'space-between',
  },
  title: { color: '#fff', fontWeight: 700, fontSize: '1.1rem' },
  newBtn: {
    background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px',
    padding: '0.4rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem',
  },
  list: { flex: 1, overflowY: 'auto', padding: '0.5rem 0' },
  item: (active) => ({
    padding: '0.75rem 1rem', cursor: 'pointer',
    background: active ? '#1e1e3f' : 'transparent',
    borderLeft: active ? '3px solid #6366f1' : '3px solid transparent',
    transition: 'background 0.15s',
  }),
  name: { color: '#e0e0e0', fontWeight: 500, fontSize: '0.95rem' },
  sub: { color: '#666', fontSize: '0.75rem', marginTop: '0.2rem' },
  empty: { color: '#555', textAlign: 'center', padding: '2rem 1rem', fontSize: '0.875rem' },
  footer: {
    borderTop: '1px solid #222', padding: '0.5rem 0.75rem',
  },
  profileBtn: {
    width: '100%', padding: '0.6rem 0.75rem', border: 'none', borderRadius: '6px',
    background: 'transparent', color: '#e0e0e0', cursor: 'pointer',
    fontSize: '0.9rem', fontWeight: 600, textAlign: 'left',
    display: 'flex', alignItems: 'center', gap: '0.5rem',
  },
  profilePanel: {
    padding: '0.5rem 0.75rem', background: '#1a1a1a', borderRadius: '8px',
    margin: '0.25rem 0',
  },
  profileLabel: { color: '#888', fontSize: '0.75rem', marginBottom: '0.25rem' },
  profileInput: {
    width: '100%', padding: '0.45rem 0.6rem', borderRadius: '6px',
    border: '1px solid #333', background: '#0f0f0f', color: '#fff',
    fontSize: '0.85rem', marginBottom: '0.5rem', outline: 'none',
  },
  profileSaveBtn: {
    width: '100%', padding: '0.45rem', borderRadius: '6px', border: 'none',
    background: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: '0.8rem',
    fontWeight: 600, marginBottom: '0.25rem',
  },
  profileMsg: { fontSize: '0.75rem', textAlign: 'center', marginBottom: '0.25rem' },
  logoutBtn: {
    width: '100%', padding: '0.5rem', border: '1px solid #333', borderRadius: '6px',
    background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '0.85rem',
    marginTop: '0.25rem',
  },
};

const ConversationList = forwardRef(function ConversationList({ activeConversationId, onSelect, onNewConversation, onLogout, currentUser }, ref) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);

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

  return (
    <aside style={s.sidebar}>
      <div style={s.header}>
        <span style={s.title}>💬 Conversations</span>
        <button style={s.newBtn} onClick={onNewConversation}>+ New</button>
      </div>
      <div style={s.list}>
        {loading && <p style={s.empty}>Loading…</p>}
        {!loading && conversations.length === 0 && (
          <p style={s.empty}>No conversations yet.<br />Start one with "+ New".</p>
        )}
        {conversations.map((conv) => (
          <div
            key={conv.id}
            style={s.item(conv.id === activeConversationId)}
            onClick={() => onSelect(conv)}
          >
            <div style={s.name}>{getDisplayName(conv)}</div>
            <div style={s.sub}>{conv.type === 'direct_message' ? 'Direct' : 'Group'}</div>
          </div>
        ))}
      </div>
      <div style={s.footer}>
        <button
          style={s.profileBtn}
          onClick={() => setShowProfile(!showProfile)}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#1a1a1a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ fontSize: '1.1rem' }}>👤</span>
          <span>{username}</span>
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#666' }}>{showProfile ? '▲' : '▼'}</span>
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
              <p style={{ ...s.profileMsg, color: pwMsg.type === 'error' ? '#f87171' : '#4ade80' }}>
                {pwMsg.text}
              </p>
            )}
            <button style={s.profileSaveBtn} onClick={handleChangePassword} disabled={pwLoading}>
              {pwLoading ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        )}

        <button style={s.logoutBtn} onClick={onLogout}>Sign Out</button>
      </div>
    </aside>
  );
});

export default ConversationList;
