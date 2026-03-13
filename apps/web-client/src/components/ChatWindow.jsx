import { useEffect, useRef, useState } from 'react';

const s = {
  window: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    padding: '1rem 1.5rem', borderBottom: '1px solid #222',
    background: '#111', color: '#fff', fontWeight: 600, fontSize: '1rem',
  },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty: { color: '#555', textAlign: 'center', padding: '2rem', fontSize: '0.9rem' },
  row: (mine) => ({
    display: 'flex', flexDirection: mine ? 'row-reverse' : 'row',
    alignItems: 'flex-start', gap: '0.25rem', position: 'relative',
    marginBottom: '0.15rem',
  }),
  bubbleCol: (mine) => ({
    maxWidth: '70%', display: 'flex', flexDirection: 'column',
    alignItems: mine ? 'flex-end' : 'flex-start',
  }),
  replyQuote: {
    padding: '0.3rem 0.6rem', borderRadius: '8px 8px 0 0',
    background: 'rgba(255,255,255,0.06)', borderLeft: '3px solid #6366f1',
    fontSize: '0.75rem', color: '#aaa', maxWidth: '100%', marginBottom: '-2px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  bubble: (mine) => ({
    padding: '0.6rem 1rem',
    borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: mine ? '#6366f1' : '#1e1e2e', color: '#fff',
    fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word',
  }),
  edited: { fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)', marginLeft: '0.4rem', fontStyle: 'italic' },
  meta: (mine) => ({
    fontSize: '0.7rem', color: '#888',
    alignSelf: mine ? 'flex-end' : 'flex-start',
    marginTop: '0.1rem',
  }),
  dotsBtn: {
    background: 'transparent', border: 'none', color: '#666',
    cursor: 'pointer', fontSize: '1rem', padding: '0.15rem 0.3rem',
    borderRadius: '4px', lineHeight: 1, flexShrink: 0, alignSelf: 'center',
  },
  menu: {
    position: 'fixed', background: '#1e1e2e', border: '1px solid #333',
    borderRadius: '8px', padding: '0.25rem 0', zIndex: 200,
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)', minWidth: '180px',
  },
  menuItem: {
    padding: '0.5rem 1rem', color: '#e0e0e0', cursor: 'pointer',
    fontSize: '0.85rem', display: 'block', width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
  },
  menuItemDanger: {
    padding: '0.5rem 1rem', color: '#f87171', cursor: 'pointer',
    fontSize: '0.85rem', display: 'block', width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
  },
};

export default function ChatWindow({ conversation, messages, myUserId, loading, onDeleteMessage, onEditMessage, onReply, onNewConversation }) {
  const bottomRef = useRef(null);
  const [menu, setMenu] = useState(null); // { x, y, msg }
  const [hoveredId, setHoveredId] = useState(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close menu on click anywhere
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const openMenu = (e, msg) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 180; // matches minWidth in s.menu
    // Clamp so the menu doesn't overflow the right edge of the viewport
    const x = Math.min(rect.left, window.innerWidth - menuWidth - 8);
    const y = rect.bottom + 4;
    setMenu({ x, y, msg });
  };

  const handleAction = (action) => {
    if (!menu?.msg) return;
    const { msg } = menu;
    setMenu(null);
    if (action === 'delete_me') onDeleteMessage?.(msg.id, 'for_me');
    if (action === 'delete_all') onDeleteMessage?.(msg.id, 'for_everyone');
    if (action === 'edit') onEditMessage?.(msg);
    if (action === 'reply') onReply?.(msg);
  };

  // Find the replied-to message text
  const getReplyText = (replyToId) => {
    if (!replyToId) return null;
    const orig = messages.find((m) => m.id === replyToId);
    return orig ? orig.plaintext : '[deleted message]';
  };

  if (!conversation) {
    return (
      <div style={{ ...s.window, alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
        <p style={{ color: '#888', fontSize: '1.1rem', fontWeight: 600 }}>💬 Welcome to Blink Text</p>
        <p style={{ color: '#555', fontSize: '0.9rem' }}>Select a conversation or start a new one</p>
        <button
          style={{
            padding: '0.6rem 1.5rem', borderRadius: '8px', border: 'none',
            background: '#6366f1', color: '#fff', fontSize: '0.95rem',
            cursor: 'pointer', fontWeight: 600,
          }}
          onClick={onNewConversation}
        >
          + Start a conversation
        </button>
      </div>
    );
  }

  const formatTime = (ts) => {
    const d = new Date(typeof ts === 'number' ? ts : ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={s.window}>
      <div style={s.header}>{conversation.displayName || 'Conversation'}</div>
      {conversation.has_deleted_participant && (
        <div style={{
          padding: '0.5rem 1.5rem', background: '#2a1a1a', borderBottom: '1px solid #333',
          color: '#f87171', fontSize: '0.8rem', textAlign: 'center',
        }}>
          ⚠️ This user has deleted their account. You can no longer send messages.
        </div>
      )}
      <div style={s.messages}>
        {loading && <p style={s.empty}>Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <p style={s.empty}>No messages yet. Send the first one!</p>
        )}
        {messages.map((msg) => {
          const mine = msg.senderId === myUserId;
          const replyText = getReplyText(msg.replyToId);
          return (
            <div
              key={msg.id}
              style={s.row(mine)}
              onMouseEnter={() => setHoveredId(msg.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* 3-dot button — appears on hover, on the outer side of the bubble */}
              {hoveredId === msg.id && (
                <button
                  style={s.dotsBtn}
                  onClick={(e) => openMenu(e, msg)}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#666')}
                  title="Options"
                >⋮</button>
              )}

              <div style={s.bubbleCol(mine)}>
                {replyText && (
                  <div style={s.replyQuote}>↩ {replyText}</div>
                )}
                <div style={s.bubble(mine)}>
                  {msg.plaintext}
                  {msg.edited && <span style={s.edited}>(edited)</span>}
                </div>
                <div style={s.meta(mine)}>{formatTime(msg.timestamp)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {menu && (
        <div style={{ ...s.menu, left: menu.x, top: menu.y }}>
          <button style={s.menuItem}
            onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
            onMouseLeave={(e) => (e.target.style.background = 'transparent')}
            onClick={() => handleAction('reply')}>
            ↩ Reply
          </button>
          {menu.msg.senderId === myUserId && (
            <button style={s.menuItem}
              onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
              onMouseLeave={(e) => (e.target.style.background = 'transparent')}
              onClick={() => handleAction('edit')}>
              ✏️ Edit
            </button>
          )}
          <button style={s.menuItem}
            onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
            onMouseLeave={(e) => (e.target.style.background = 'transparent')}
            onClick={() => handleAction('delete_me')}>
            🗑 Delete for me
          </button>
          {menu.msg.senderId === myUserId && (
            <button style={s.menuItemDanger}
              onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
              onMouseLeave={(e) => (e.target.style.background = 'transparent')}
              onClick={() => handleAction('delete_all')}>
              🗑 Delete for everyone
            </button>
          )}
        </div>
      )}
    </div>
  );
}
