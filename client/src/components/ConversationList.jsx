import { useState, useEffect } from 'react';
import { getConversations } from '../services/api.js';

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
  logoutBtn: {
    margin: '0.75rem', padding: '0.5rem', border: '1px solid #333', borderRadius: '6px',
    background: 'transparent', color: '#888', cursor: 'pointer', fontSize: '0.85rem',
    width: 'calc(100% - 1.5rem)',
  },
};

export default function ConversationList({ activeConversationId, onSelect, onNewConversation, onLogout }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

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

  // Expose refresh for parent
  ConversationList.refresh = load;

  const getDisplayName = (conv) => {
    if (conv.name) return conv.name;
    if (conv.type === 'direct') {
      const names = (conv.participant_usernames || '').split(',').filter(Boolean);
      return names.length > 0 ? names.join(', ') : 'Direct';
    }
    return `Group (${(conv.participant_usernames || '').split(',').length})`;
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
            <div style={s.sub}>{conv.type === 'direct' ? 'Direct' : 'Group'}</div>
          </div>
        ))}
      </div>
      <button style={s.logoutBtn} onClick={onLogout}>Sign Out</button>
    </aside>
  );
}
