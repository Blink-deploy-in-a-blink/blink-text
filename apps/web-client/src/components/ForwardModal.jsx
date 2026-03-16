import { useState, useEffect } from 'react';
import { getConversations } from '../services/api.js';

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400,
  },
  modal: {
    background: '#1a1a1a', borderRadius: '12px', padding: '1.5rem',
    width: '100%', maxWidth: '400px', margin: '0 1rem',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    maxHeight: '70vh', display: 'flex', flexDirection: 'column',
  },
  title: { color: '#fff', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.75rem' },
  subtitle: { color: '#888', fontSize: '0.8rem', marginBottom: '0.75rem' },
  searchInput: {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px',
    border: '1px solid #333', background: '#0f0f0f', color: '#fff',
    fontSize: '0.9rem', marginBottom: '0.75rem', outline: 'none',
  },
  list: {
    flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column',
    gap: '0.25rem', minHeight: 0,
  },
  convItem: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.6rem 0.75rem', borderRadius: '8px',
    cursor: 'pointer', border: 'none', background: 'transparent',
    color: '#e0e0e0', fontSize: '0.9rem', textAlign: 'left',
    width: '100%', transition: 'background 0.1s',
  },
  convAvatar: {
    width: '36px', height: '36px', borderRadius: '50%',
    background: '#6366f1', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0, color: '#fff',
  },
  convInfo: {
    flex: 1, overflow: 'hidden',
  },
  convName: {
    fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  convType: {
    fontSize: '0.7rem', color: '#666', marginTop: '0.1rem',
  },
  actions: {
    display: 'flex', gap: '0.5rem', justifyContent: 'flex-end',
    marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #222',
  },
  cancelBtn: {
    padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #333',
    background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '0.85rem',
  },
  previewBox: {
    padding: '0.5rem 0.75rem', borderRadius: '8px', background: '#0f0f0f',
    border: '1px solid #222', marginBottom: '0.75rem',
    fontSize: '0.8rem', color: '#aaa',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  sending: {
    padding: '1rem', textAlign: 'center', color: '#aaa', fontSize: '0.9rem',
  },
};

/**
 * Modal to pick a conversation to forward a message to.
 *
 * Props:
 *  - message: the message object being forwarded
 *  - currentUserId: string
 *  - currentConversationId: string — to exclude from list
 *  - onForward: (message, targetConversationId) => Promise<void>
 *  - onClose: () => void
 */
export default function ForwardModal({ message, currentUserId, currentConversationId, onForward, onClose }) {
  const [conversations, setConversations] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const convos = await getConversations();
        setConversations(convos || []);
      } catch (err) {
        console.error('Failed to load conversations:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const getDisplayName = (conv) => {
    if (conv.name) return conv.name;
    const names = (conv.participant_usernames || '').split(',').filter(Boolean);
    return names.join(', ') || 'Conversation';
  };

  const filteredConvos = conversations.filter((c) => {
    // Exclude the current conversation
    if (c.id === currentConversationId) return false;
    if (!filter.trim()) return true;
    const name = getDisplayName(c).toLowerCase();
    return name.includes(filter.toLowerCase());
  });

  const getMessagePreview = () => {
    if (!message) return '';
    if (message.messageType === 'image') return '📷 Image';
    if (message.messageType === 'video') return '🎬 Video';
    if (message.messageType === 'voice') return '🎤 Voice note';
    const text = message.plaintext || '';
    return text.length > 80 ? text.slice(0, 80) + '…' : text;
  };

  const handleSelect = async (targetConv) => {
    if (sending) return;
    setSending(true);
    try {
      await onForward(message, targetConv.id);
      onClose();
    } catch (err) {
      console.error('Forward failed:', err);
      setSending(false);
    }
  };

  return (
    <div style={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.title}>➡ Forward Message</div>

        <div style={s.previewBox}>
          {getMessagePreview()}
        </div>

        {sending ? (
          <div style={s.sending}>Forwarding…</div>
        ) : (
          <>
            <input
              style={s.searchInput}
              placeholder="Search conversations…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              autoFocus
            />

            <div style={s.list}>
              {loading && <div style={{ color: '#666', padding: '1rem', textAlign: 'center' }}>Loading…</div>}
              {!loading && filteredConvos.length === 0 && (
                <div style={{ color: '#666', padding: '1rem', textAlign: 'center' }}>
                  {filter ? 'No matching conversations' : 'No other conversations'}
                </div>
              )}
              {filteredConvos.map((conv) => {
                const displayName = getDisplayName(conv);
                const initial = displayName.charAt(0).toUpperCase();
                return (
                  <button
                    key={conv.id}
                    style={s.convItem}
                    onClick={() => handleSelect(conv)}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a3e')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={s.convAvatar}>{initial}</div>
                    <div style={s.convInfo}>
                      <div style={s.convName}>{displayName}</div>
                      <div style={s.convType}>
                        {conv.type === 'group_chat' ? '👥 Group' : '💬 Direct'}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
