import { useEffect, useRef, useState, useCallback } from 'react';

const s = {
  window: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    padding: '1rem 1.5rem', borderBottom: '1px solid #222',
    background: '#111', color: '#fff', fontWeight: 600, fontSize: '1rem',
    display: 'flex', alignItems: 'center', flexShrink: 0,
  },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: 0 },
  empty: { color: '#555', textAlign: 'center', padding: '2rem', fontSize: '0.9rem' },
  loadMore: {
    alignSelf: 'center', padding: '0.4rem 1rem', borderRadius: '16px',
    border: '1px solid #333', background: 'transparent', color: '#888',
    cursor: 'pointer', fontSize: '0.8rem', marginBottom: '0.5rem', flexShrink: 0,
  },
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

export default function ChatWindow({ conversation, messages, myUserId, loading, loadingMore, hasMore, onLoadMore, onDeleteMessage, onEditMessage, onReply, onNewConversation, onBack }) {
  const bottomRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const [menu, setMenu] = useState(null); // { x, y, msg }
  const [hoveredId, setHoveredId] = useState(null);
  const longPressTimer = useRef(null);
  const isInitialLoad = useRef(true);
  const prevMessagesLen = useRef(0);

  // Auto-scroll to bottom on initial load or new messages appended at bottom
  useEffect(() => {
    if (!messages.length) { isInitialLoad.current = true; return; }
    const container = messagesContainerRef.current;
    if (!container) return;

    // If this is the initial load or messages were appended (not prepended), scroll to bottom
    if (isInitialLoad.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      isInitialLoad.current = false;
      prevMessagesLen.current = messages.length;
      return;
    }

    // If count grew and the oldest message didn't change → new message at bottom
    const grew = messages.length > prevMessagesLen.current;
    prevMessagesLen.current = messages.length;
    if (grew) {
      // Check if user was near bottom (within 150px) → auto-scroll
      const { scrollTop, scrollHeight, clientHeight } = container;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 150;
      if (nearBottom) {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [messages]);

  // Reset initial load flag when conversation changes
  useEffect(() => {
    isInitialLoad.current = true;
    prevMessagesLen.current = 0;
  }, [conversation?.id]);

  // Preserve scroll position when older messages are prepended
  const handleLoadMore = useCallback(async () => {
    const container = messagesContainerRef.current;
    if (!container || !onLoadMore) return;

    const prevScrollHeight = container.scrollHeight;
    await onLoadMore();

    // After React re-renders with prepended messages, restore scroll position
    requestAnimationFrame(() => {
      const newScrollHeight = container.scrollHeight;
      container.scrollTop = newScrollHeight - prevScrollHeight;
    });
  }, [onLoadMore]);

  // Scroll-to-top detection for auto-loading more
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !hasMore) return;

    const onScroll = () => {
      if (container.scrollTop < 80 && hasMore && !loadingMore) {
        handleLoadMore();
      }
    };

    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, [hasMore, loadingMore, handleLoadMore]);

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
      <div style={s.header}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'transparent', border: 'none', color: '#ccc',
              fontSize: '1.4rem', cursor: 'pointer', padding: '0.2rem 0.6rem 0.2rem 0',
              lineHeight: 1, flexShrink: 0,
            }}
            title="Back to conversations"
          >☰</button>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conversation.displayName || 'Conversation'}
        </span>
      </div>
      {!!conversation.has_deleted_participant && (
        <div style={{
          padding: '0.5rem 1.5rem', background: '#2a1a1a', borderBottom: '1px solid #333',
          color: '#f87171', fontSize: '0.8rem', textAlign: 'center', flexShrink: 0,
        }}>
          ⚠️ This user has deleted their account. You can no longer send messages.
        </div>
      )}
      <div style={s.messages} ref={messagesContainerRef}>
        {loadingMore && <p style={{ ...s.empty, padding: '0.5rem', fontSize: '0.8rem' }}>Loading older messages…</p>}
        {!loadingMore && hasMore && (
          <button style={s.loadMore} onClick={handleLoadMore}>
            ↑ Load older messages
          </button>
        )}
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
              onTouchStart={(e) => {
                const touch = e.touches[0];
                longPressTimer.current = setTimeout(() => {
                  const menuWidth = 180;
                  const x = Math.min(touch.clientX, window.innerWidth - menuWidth - 8);
                  setMenu({ x, y: touch.clientY, msg });
                }, 500);
              }}
              onTouchEnd={() => clearTimeout(longPressTimer.current)}
              onTouchMove={() => clearTimeout(longPressTimer.current)}
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
                <div style={msg.plaintext === '[unable to decrypt]'
                  ? { ...s.bubble(mine), background: '#1a1a2e', border: '1px dashed #333', fontStyle: 'italic', color: '#666', fontSize: '0.82rem' }
                  : s.bubble(mine)
                }>
                  {msg.plaintext === '[unable to decrypt]'
                    ? '🔒 This message can\'t be decrypted — encryption keys have changed'
                    : msg.plaintext}
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
