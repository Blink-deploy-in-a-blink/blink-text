import { useEffect, useRef, useState, useCallback } from 'react';
import { downloadMedia } from '../services/api.js';
import { decryptMediaForConversation } from '../services/cryptoService.js';
import MediaPreviewModal from './MediaPreviewModal.jsx';

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
  mediaBubble: (mine) => ({
    borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: mine ? '#6366f1' : '#1e1e2e', color: '#fff',
    overflow: 'hidden', maxWidth: '300px',
  }),
  mediaImg: {
    display: 'block', maxWidth: '100%', maxHeight: '300px',
    borderRadius: '12px', cursor: 'pointer',
  },
  mediaVideo: {
    display: 'block', maxWidth: '100%', maxHeight: '300px',
    borderRadius: '12px',
  },
  downloadBtn: {
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
    padding: '0.3rem 0.6rem', fontSize: '0.75rem', color: '#aaa',
    background: 'transparent', border: 'none', cursor: 'pointer',
    textDecoration: 'underline',
  },
  voiceBubble: (mine) => ({
    padding: '0.5rem 0.8rem',
    borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: mine ? '#6366f1' : '#1e1e2e', color: '#fff',
    display: 'flex', flexDirection: 'column', gap: '0.3rem',
    minWidth: '200px',
  }),
};

/** Parse media metadata from decrypted plaintext */
function parseMediaMeta(plaintext) {
  try {
    const meta = JSON.parse(plaintext);
    if (meta && meta.fileName) return meta;
  } catch { /* not JSON — normal text message */ }
  return null;
}

/** Decrypts and loads media for display */
function MediaBubble({ msg, mine, conversationId, onPreview }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const meta = parseMediaMeta(msg.plaintext);

  const loadMedia = useCallback(async () => {
    if (!msg.mediaId || objectUrl || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { data: encryptedData, iv: ivBase64 } = await downloadMedia(msg.mediaId);
      // Decode IV from base64
      const ivBinary = atob(ivBase64);
      const iv = new Uint8Array(ivBinary.length);
      for (let i = 0; i < ivBinary.length; i++) iv[i] = ivBinary.charCodeAt(i);
      const decrypted = await decryptMediaForConversation(conversationId, encryptedData, iv);
      const mimeType = meta?.mimeType || 'application/octet-stream';
      const blob = new Blob([decrypted], { type: mimeType });
      setObjectUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error('Failed to load media:', err);
      setError('Failed to load media');
    } finally {
      setLoading(false);
    }
  }, [msg.mediaId, objectUrl, loading, conversationId, meta?.mimeType]);

  // Auto-load images and voice notes; videos load on click
  useEffect(() => {
    if (!msg.mediaId) return;
    if (msg.messageType === 'image' || msg.messageType === 'voice') {
      loadMedia();
    }
  }, [msg.mediaId, msg.messageType, loadMedia]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [objectUrl]);

  const handleDownload = () => {
    if (!objectUrl) return;
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = meta?.fileName || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!meta || !msg.mediaId) return null;

  // Voice note
  if (msg.messageType === 'voice') {
    return (
      <div style={s.voiceBubble(mine)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
          🎤 <span>Voice Note</span>
        </div>
        {loading && <span style={{ fontSize: '0.75rem', color: '#aaa' }}>Loading…</span>}
        {error && <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{error}</span>}
        {objectUrl && (
          <audio controls style={{ width: '100%', maxWidth: '250px', height: '36px' }} preload="auto">
            <source src={objectUrl} type={meta.mimeType || 'audio/webm'} />
          </audio>
        )}
        {objectUrl && (
          <button style={s.downloadBtn} onClick={handleDownload}>⬇ Save</button>
        )}
      </div>
    );
  }

  // Image
  if (msg.messageType === 'image') {
    return (
      <div style={s.mediaBubble(mine)}>
        {loading && (
          <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.8rem', color: '#aaa' }}>
            Loading image…
          </div>
        )}
        {error && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.8rem', color: '#f87171' }}>
            {error}
          </div>
        )}
        {objectUrl && (
          <img src={objectUrl} alt={meta.fileName} style={s.mediaImg}
            onClick={() => onPreview?.({ objectUrl, mimeType: meta.mimeType, fileName: meta.fileName, messageType: 'image' })}
            title="Click to preview" />
        )}
        <div style={{ padding: '0.3rem 0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta.fileName}
          </span>
          {objectUrl && <button style={s.downloadBtn} onClick={handleDownload}>⬇</button>}
        </div>
      </div>
    );
  }

  // Video
  if (msg.messageType === 'video') {
    return (
      <div style={s.mediaBubble(mine)}>
        {!objectUrl && !loading && !error && (
          <button
            style={{ padding: '2rem', width: '100%', background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '0.85rem' }}
            onClick={loadMedia}
          >
            ▶ Load video ({meta.fileName})
          </button>
        )}
        {loading && (
          <div style={{ padding: '2rem', textAlign: 'center', fontSize: '0.8rem', color: '#aaa' }}>
            Loading video…
          </div>
        )}
        {error && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.8rem', color: '#f87171' }}>
            {error}
          </div>
        )}
        {objectUrl && (
          <video controls style={s.mediaVideo} preload="metadata"
            onDoubleClick={() => onPreview?.({ objectUrl, mimeType: meta.mimeType || 'video/mp4', fileName: meta.fileName, messageType: 'video' })}>
            <source src={objectUrl} type={meta.mimeType || 'video/mp4'} />
          </video>
        )}
        <div style={{ padding: '0.3rem 0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.7rem', color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta.fileName}
          </span>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {objectUrl && <button style={s.downloadBtn}
              onClick={() => onPreview?.({ objectUrl, mimeType: meta.mimeType || 'video/mp4', fileName: meta.fileName, messageType: 'video' })}>
              ⛶
            </button>}
            {objectUrl && <button style={s.downloadBtn} onClick={handleDownload}>⬇</button>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function ChatWindow({ conversation, messages, myUserId, loading, loadingMore, hasMore, onLoadMore, onDeleteMessage, onEditMessage, onReply, onForward, onNewConversation, onBack }) {
  const bottomRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const [menu, setMenu] = useState(null); // { x, y, msg }
  const [hoveredId, setHoveredId] = useState(null);
  const [previewMedia, setPreviewMedia] = useState(null); // { objectUrl, mimeType, fileName, messageType }
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
    if (action === 'forward') onForward?.(msg);
    if (action === 'download') {
      // For media messages, trigger a download of the media content
      const meta = parseMediaMeta(msg.plaintext);
      const fileName = meta?.fileName || 'download';
      // The MediaBubble may have already loaded the blob — we need to re-download & decrypt
      (async () => {
        try {
          if (!msg.mediaId) return;
          const { data: encryptedData, iv: ivBase64 } = await downloadMedia(msg.mediaId);
          const ivBinary = atob(ivBase64);
          const iv = new Uint8Array(ivBinary.length);
          for (let i = 0; i < ivBinary.length; i++) iv[i] = ivBinary.charCodeAt(i);
          const decrypted = await decryptMediaForConversation(conversation.id, encryptedData, iv);
          const mimeType = meta?.mimeType || 'application/octet-stream';
          const blob = new Blob([decrypted], { type: mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error('Download failed:', err);
        }
      })();
    }
  };

  // Find the replied-to message text
  const getReplyText = (replyToId) => {
    if (!replyToId) return null;
    const orig = messages.find((m) => m.id === replyToId);
    if (!orig) return '[deleted message]';
    if (orig.messageType === 'image') return '📷 Image';
    if (orig.messageType === 'video') return '🎬 Video';
    if (orig.messageType === 'voice') return '🎤 Voice note';
    return orig.plaintext;
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
                {(msg.messageType === 'image' || msg.messageType === 'video' || msg.messageType === 'voice') && msg.mediaId ? (
                  <MediaBubble msg={msg} mine={mine} conversationId={conversation.id} onPreview={setPreviewMedia} />
                ) : (
                  <div style={msg.plaintext === '[unable to decrypt]'
                    ? { ...s.bubble(mine), background: '#1a1a2e', border: '1px dashed #333', fontStyle: 'italic', color: '#666', fontSize: '0.82rem' }
                    : s.bubble(mine)
                  }>
                    {msg.plaintext === '[unable to decrypt]'
                      ? '🔒 This message can\'t be decrypted — encryption keys have changed'
                      : msg.plaintext}
                    {msg.edited && <span style={s.edited}>(edited)</span>}
                  </div>
                )}
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
          <button style={s.menuItem}
            onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
            onMouseLeave={(e) => (e.target.style.background = 'transparent')}
            onClick={() => handleAction('forward')}>
            ➡ Forward
          </button>
          {menu.msg.senderId === myUserId && menu.msg.messageType !== 'image' && menu.msg.messageType !== 'video' && menu.msg.messageType !== 'voice' && (
            <button style={s.menuItem}
              onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
              onMouseLeave={(e) => (e.target.style.background = 'transparent')}
              onClick={() => handleAction('edit')}>
              ✏️ Edit
            </button>
          )}
          {(menu.msg.messageType === 'image' || menu.msg.messageType === 'video' || menu.msg.messageType === 'voice') && menu.msg.mediaId && (
            <button style={s.menuItem}
              onMouseEnter={(e) => (e.target.style.background = '#2a2a3e')}
              onMouseLeave={(e) => (e.target.style.background = 'transparent')}
              onClick={() => handleAction('download')}>
              ⬇ Download
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

      {/* Media preview modal */}
      {previewMedia && (
        <MediaPreviewModal
          objectUrl={previewMedia.objectUrl}
          mimeType={previewMedia.mimeType}
          fileName={previewMedia.fileName}
          messageType={previewMedia.messageType}
          onClose={() => setPreviewMedia(null)}
          onDownload={() => {
            if (!previewMedia.objectUrl) return;
            const a = document.createElement('a');
            a.href = previewMedia.objectUrl;
            a.download = previewMedia.fileName || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }}
        />
      )}
    </div>
  );
}
