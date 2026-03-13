import { useEffect, useRef, useState } from 'react';

const s = {
  window: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    padding: '1rem 1.5rem', borderBottom: '1px solid #222',
    background: '#111', color: '#fff', fontWeight: 600, fontSize: '1rem',
  },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty: { color: '#555', textAlign: 'center', padding: '2rem', fontSize: '0.9rem' },
  bubbleWrap: { position: 'relative' },
  bubble: (mine) => ({
    maxWidth: '70%', padding: '0.6rem 1rem', borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: mine ? '#6366f1' : '#1e1e2e', color: '#fff', alignSelf: mine ? 'flex-end' : 'flex-start',
    fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word', cursor: 'context-menu',
  }),
  meta: (mine) => ({
    fontSize: '0.7rem', color: '#888',
    alignSelf: mine ? 'flex-end' : 'flex-start',
    marginTop: '-0.25rem',
  }),
  contextMenu: {
    position: 'fixed', background: '#1e1e2e', border: '1px solid #333',
    borderRadius: '8px', padding: '0.25rem 0', zIndex: 200,
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)', minWidth: '160px',
  },
  contextItem: {
    padding: '0.5rem 1rem', color: '#e0e0e0', cursor: 'pointer',
    fontSize: '0.85rem', display: 'block', width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
  },
  contextItemDanger: {
    padding: '0.5rem 1rem', color: '#f87171', cursor: 'pointer',
    fontSize: '0.85rem', display: 'block', width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
  },
};

export default function ChatWindow({ conversation, messages, myUserId, loading, onDeleteMessage }) {
  const bottomRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null); // { x, y, msg }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close context menu on any click
  useEffect(() => {
    const close = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', close);
      return () => window.removeEventListener('click', close);
    }
  }, [contextMenu]);

  const handleContextMenu = (e, msg) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, msg });
  };

  const handleDelete = (mode) => {
    if (contextMenu?.msg && onDeleteMessage) {
      onDeleteMessage(contextMenu.msg.id, mode);
    }
    setContextMenu(null);
  };

  if (!conversation) {
    return (
      <div style={{ ...s.window, alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#555' }}>Select a conversation to start chatting</p>
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
      <div style={s.messages}>
        {loading && <p style={s.empty}>Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <p style={s.empty}>No messages yet. Send the first one!</p>
        )}
        {messages.map((msg) => {
          const mine = msg.senderId === myUserId;
          return (
            <div key={msg.id} style={s.bubbleWrap}>
              <div
                style={s.bubble(mine)}
                onContextMenu={(e) => handleContextMenu(e, msg)}
              >
                {msg.plaintext}
              </div>
              <div style={s.meta(mine)}>{formatTime(msg.timestamp)}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {contextMenu && (
        <div style={{ ...s.contextMenu, left: contextMenu.x, top: contextMenu.y }}>
          <button
            style={s.contextItem}
            onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
            onMouseLeave={(e) => (e.target.style.background = 'transparent')}
            onClick={() => handleDelete('for_me')}
          >
            🗑 Delete for me
          </button>
          {contextMenu.msg.senderId === myUserId && (
            <button
              style={s.contextItemDanger}
              onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
              onMouseLeave={(e) => (e.target.style.background = 'transparent')}
              onClick={() => handleDelete('for_everyone')}
            >
              🗑 Delete for everyone
            </button>
          )}
        </div>
      )}
    </div>
  );
}
