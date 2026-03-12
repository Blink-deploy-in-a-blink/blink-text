import { useEffect, useRef } from 'react';

const s = {
  window: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    padding: '1rem 1.5rem', borderBottom: '1px solid #222',
    background: '#111', color: '#fff', fontWeight: 600, fontSize: '1rem',
  },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  empty: { color: '#555', textAlign: 'center', padding: '2rem', fontSize: '0.9rem' },
  bubble: (mine) => ({
    maxWidth: '70%', padding: '0.6rem 1rem', borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: mine ? '#6366f1' : '#1e1e2e', color: '#fff', alignSelf: mine ? 'flex-end' : 'flex-start',
    fontSize: '0.9rem', lineHeight: 1.5, wordBreak: 'break-word',
  }),
  meta: (mine) => ({
    fontSize: '0.7rem', color: '#888',
    alignSelf: mine ? 'flex-end' : 'flex-start',
    marginTop: '-0.25rem',
  }),
};

export default function ChatWindow({ conversation, messages, myUserId, loading }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
          const mine = msg.sender_id === myUserId;
          return (
            <div key={msg.id}>
              <div style={s.bubble(mine)}>{msg.plaintext}</div>
              <div style={s.meta(mine)}>{formatTime(msg.timestamp)}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
