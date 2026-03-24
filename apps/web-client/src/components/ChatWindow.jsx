import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { downloadMedia, updateConversationTimer, kickMember, updateInviteSettings, getParticipants } from '../services/api.js';
import { decryptMediaForConversation } from '../services/cryptoService.js';
import { rotateMySenderKey, isGroupConversation } from '../services/groupCrypto.js';
import { emitSenderKeyDistributed } from '../services/socket.js';
import MediaPreviewModal from './MediaPreviewModal.jsx';

const TIMER_OPTIONS = [
  { value: null, label: 'Off' },
  { value: 300000, label: '5 minutes' },
  { value: 3600000, label: '1 hour' },
  { value: 86400000, label: '24 hours' },
  { value: 604800000, label: '7 days' },
  { value: 2592000000, label: '30 days' },
];

const TIMER_SHORT_LABELS = {
  300000: '5m',
  3600000: '1h',
  86400000: '24h',
  604800000: '7d',
  2592000000: '30d',
};

/** Format remaining time for an expiring message */
function formatTimeLeft(expiresAt) {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'expiring';
  if (diff < 60000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.ceil(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h`;
  return `${Math.round(diff / 86400000)}d`;
}

/** Get a human-readable date label for a message timestamp */
function getDateLabel(ts) {
  const d = new Date(typeof ts === 'number' ? ts : ts * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - msgDay) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

/** Get a date key (YYYY-MM-DD) for grouping messages */
function getDateKey(ts) {
  const d = new Date(typeof ts === 'number' ? ts : ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** URL regex for linkifying messages */
const URL_REGEX = /https?:\/\/[^\s<>"')\]},;]+/gi;

/** Render text with URLs as clickable links */
function linkifyText(text) {
  if (!text || typeof text !== 'string') return text;
  const parts = [];
  let lastIndex = 0;
  let match;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', opacity: 0.85, wordBreak: 'break-all' }}
        onClick={(e) => e.stopPropagation()}
      >
        {url}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '0.2rem', verticalAlign: 'middle', opacity: 0.5 }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
}

const s = {
  window: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  header: {
    padding: '0.85rem 1.25rem', borderBottom: '1px solid var(--border-default)',
    background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--text-md)',
    display: 'flex', alignItems: 'center', flexShrink: 0,
  },
  messages: { flex: 1, overflowY: 'auto', padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: 0, position: 'relative' },
  empty: { color: 'var(--text-faint)', textAlign: 'center', padding: '2rem', fontSize: 'var(--text-sm)' },
  dateSeparator: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    margin: '0.75rem 0 0.25rem', flexShrink: 0, userSelect: 'none',
  },
  dateLine: {
    flex: 1, height: '1px', background: 'var(--border-light)',
  },
  dateLabel: {
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontWeight: 500,
    whiteSpace: 'nowrap', letterSpacing: '0.02em',
  },
  loadMore: {
    alignSelf: 'center', padding: '0.4rem 1rem', borderRadius: '16px',
    border: '1px solid var(--border-light)', background: 'transparent', color: 'var(--text-muted)',
    cursor: 'pointer', fontSize: 'var(--text-xs)', marginBottom: '0.5rem', flexShrink: 0,
    transition: 'background 0.15s',
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
    padding: '0.3rem 0.6rem', borderRadius: 'var(--radius-md) var(--radius-md) 0 0',
    background: 'rgba(255,255,255,0.06)', borderLeft: '3px solid var(--accent)',
    fontSize: 'var(--text-xs)', color: 'var(--text-muted)', maxWidth: '100%', marginBottom: '-2px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  bubble: (mine) => ({
    padding: '0.6rem 1rem',
    borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: mine ? 'var(--accent)' : 'var(--bg-elevated)', color: 'var(--text-primary)',
    fontSize: 'var(--text-md)', lineHeight: 1.5, wordBreak: 'break-word',
  }),
  edited: { fontSize: 'var(--text-xs)', color: 'rgba(255,255,255,0.45)', marginLeft: '0.4rem', fontStyle: 'italic' },
  meta: (mine) => ({
    fontSize: 'var(--text-xs)', color: 'var(--text-faint)',
    alignSelf: mine ? 'flex-end' : 'flex-start',
    marginTop: '0.1rem',
  }),
  dotsBtn: {
    background: 'transparent', border: 'none', color: 'var(--text-faint)',
    cursor: 'pointer', fontSize: '1rem', padding: '0.15rem 0.3rem',
    borderRadius: 'var(--radius-sm)', lineHeight: 1, flexShrink: 0, alignSelf: 'center',
    transition: 'color 0.15s',
  },
  menu: {
    position: 'fixed', background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-md)', padding: '0.25rem 0', zIndex: 200,
    boxShadow: 'var(--shadow-lg)', minWidth: '180px',
    maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
  },
  menuItem: {
    padding: '0.5rem 1rem', color: 'var(--text-primary)', cursor: 'pointer',
    fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
    transition: 'background 0.1s',
  },
  menuItemDanger: {
    padding: '0.5rem 1rem', color: 'var(--danger-muted)', cursor: 'pointer',
    fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%',
    background: 'transparent', border: 'none', textAlign: 'left',
    transition: 'background 0.1s',
  },
  mediaBubble: (mine) => ({
    borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: mine ? 'var(--accent)' : 'var(--bg-elevated)', color: 'var(--text-primary)',
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
    padding: '0.3rem 0.6rem', fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
    background: 'transparent', border: 'none', cursor: 'pointer',
    textDecoration: 'underline',
  },
  voiceBubble: (mine) => ({
    padding: '0.5rem 0.8rem',
    borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    background: mine ? 'var(--accent)' : 'var(--bg-elevated)', color: 'var(--text-primary)',
    display: 'flex', flexDirection: 'column', gap: '0.3rem',
    minWidth: '200px',
  }),
  scrollFab: {
    position: 'sticky', bottom: '0.75rem', alignSelf: 'center',
    width: '36px', height: '36px', borderRadius: '50%',
    background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
    color: 'var(--text-muted)', cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    boxShadow: 'var(--shadow-md)', transition: 'opacity 0.2s, transform 0.2s',
    zIndex: 10,
  },
  timerBtn: {
    background: 'transparent', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', padding: '0.15rem 0.4rem', fontSize: 'var(--text-sm)',
    borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', gap: '0.25rem',
    marginLeft: 'auto', flexShrink: 0, transition: 'color 0.15s',
  },
  timerBadge: {
    fontSize: 'var(--text-xs)', color: 'var(--accent)', fontWeight: 600,
  },
  timerDropdown: {
    position: 'absolute', top: '100%', right: '1rem', zIndex: 300,
    background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
    padding: '0.25rem 0', minWidth: '200px', marginTop: '0.25rem',
  },
  timerOption: (active) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.5rem 1rem', width: '100%', background: 'transparent', border: 'none',
    color: active ? 'var(--accent)' : 'var(--text-primary)', cursor: 'pointer',
    fontSize: 'var(--text-sm)', textAlign: 'left', fontWeight: active ? 600 : 400,
    transition: 'background 0.1s',
  }),
  timerDropdownTitle: {
    padding: '0.5rem 1rem 0.25rem', fontSize: 'var(--text-xs)', color: 'var(--text-faint)',
    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  expiryBadge: {
    fontSize: '0.65rem', color: 'var(--text-faint)', display: 'inline-flex',
    alignItems: 'center', gap: '0.15rem', marginLeft: '0.4rem', opacity: 0.7,
  },
};

/* ── Small SVG icons for context menu ── */
const MReplyIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>;
const MForwardIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>;
const MEditIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const MDownloadIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const MFlagIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>;
const MTrashIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
const ChevronDownIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>;
const BackIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>;

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
  const loadingRef = useRef(false);
  const meta = parseMediaMeta(msg.plaintext);

  const loadMedia = useCallback(async () => {
    if (!msg.mediaId || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const { data: encryptedData, iv: ivBase64 } = await downloadMedia(msg.mediaId);
      // Decode IV from base64
      const ivBinary = atob(ivBase64);
      const iv = new Uint8Array(ivBinary.length);
      for (let i = 0; i < ivBinary.length; i++) iv[i] = ivBinary.charCodeAt(i);
      const decrypted = await decryptMediaForConversation(conversationId, encryptedData, iv, msg.senderId);
      const mimeType = meta?.mimeType || 'application/octet-stream';
      const blob = new Blob([decrypted], { type: mimeType });
      setObjectUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error('Failed to load media:', err);
      setError('Failed to load media');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [msg.mediaId, msg.senderId, conversationId, meta?.mimeType]);

  // Auto-load images and voice notes; videos load on click
  // Guard with objectUrl to avoid re-fetching once we already have the blob.
  useEffect(() => {
    if (!msg.mediaId || objectUrl) return;
    if (msg.messageType === 'image' || msg.messageType === 'voice') {
      loadMedia();
    }
  }, [msg.mediaId, msg.messageType, objectUrl, loadMedia]);

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: 'var(--text-sm)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          <span>Voice Note</span>
        </div>
        {loading && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Loading…</span>}
        {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--danger-muted)' }}>{error}</span>}
        {objectUrl && (
          <audio controls style={{ width: '100%', maxWidth: '250px', height: '36px' }} preload="auto">
            <source src={objectUrl} type={meta.mimeType || 'audio/webm'} />
          </audio>
        )}
        {objectUrl && (
          <button style={s.downloadBtn} onClick={handleDownload}><MDownloadIcon /> Save</button>
        )}
      </div>
    );
  }

  // Image
  if (msg.messageType === 'image') {
    return (
      <div style={s.mediaBubble(mine)}>
        {loading && (
          <div style={{ padding: '2rem', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Loading image…
          </div>
        )}
        {error && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--danger-muted)' }}>
            {error}
          </div>
        )}
        {objectUrl && (
          <img src={objectUrl} alt={meta.fileName} style={s.mediaImg}
            onClick={() => onPreview?.({ objectUrl, mimeType: meta.mimeType, fileName: meta.fileName, messageType: 'image' })}
            title="Click to preview" />
        )}
        <div style={{ padding: '0.3rem 0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta.fileName}
          </span>
          {objectUrl && <button style={s.downloadBtn} onClick={handleDownload}><MDownloadIcon /></button>}
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
            style={{ padding: '2rem', width: '100%', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}
            onClick={loadMedia}
          >
            ▶ Load video ({meta.fileName})
          </button>
        )}
        {loading && (
          <div style={{ padding: '2rem', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Loading video…
          </div>
        )}
        {error && (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--danger-muted)' }}>
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
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {meta.fileName}
          </span>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {objectUrl && <button style={s.downloadBtn}
              onClick={() => onPreview?.({ objectUrl, mimeType: meta.mimeType || 'video/mp4', fileName: meta.fileName, messageType: 'video' })}>
              ⛶
            </button>}
            {objectUrl && <button style={s.downloadBtn} onClick={handleDownload}><MDownloadIcon /></button>}
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function ChatWindow({ conversation, messages, myUserId, loading, loadingMore, hasMore, keyReady, onLoadMore, onDeleteMessage, onEditMessage, onReply, onForward, onReport, onNewConversation, onBack, onTimerChanged }) {
  const bottomRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const [menu, setMenu] = useState(null); // { x, y, msg }
  const menuRef = useRef(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [previewMedia, setPreviewMedia] = useState(null); // { objectUrl, mimeType, fileName, messageType }
  const [showScrollFab, setShowScrollFab] = useState(false);
  const longPressTimer = useRef(null);
  const [showNukeAnimation, setShowNukeAnimation] = useState(false);
  const isInitialLoad = useRef(true);
  const prevMessagesLen = useRef(0);
  const [showTimerDropdown, setShowTimerDropdown] = useState(false);
  const [timerUpdating, setTimerUpdating] = useState(false);
  const timerDropdownRef = useRef(null);
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [kickingUserId, setKickingUserId] = useState(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showSecuredBanner, setShowSecuredBanner] = useState(false);
  const prevKeyReady = useRef(keyReady);

  // Flash "Secured" banner when key exchange completes
  useEffect(() => {
    if (!prevKeyReady.current && keyReady) {
      setShowSecuredBanner(true);
      const t = setTimeout(() => setShowSecuredBanner(false), 2500);
      return () => clearTimeout(t);
    }
    prevKeyReady.current = keyReady;
  }, [keyReady]);

  // Close timer dropdown on outside click
  useEffect(() => {
    if (!showTimerDropdown) return;
    const close = (e) => {
      if (timerDropdownRef.current && !timerDropdownRef.current.contains(e.target)) {
        setShowTimerDropdown(false);
      }
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [showTimerDropdown]);

  // Handle timer change
  const handleTimerChange = async (value) => {
    if (!conversation) return;
    setTimerUpdating(true);
    try {
      await updateConversationTimer(conversation.id, value);
      // The socket event will update the conversation object in parent
      onTimerChanged?.();
    } catch (err) {
      console.error('Failed to update timer:', err);
    } finally {
      setTimerUpdating(false);
      setShowTimerDropdown(false);
    }
  };

  // Handle kick member (groups)
  const handleKick = async (userId) => {
    if (!conversation) return;
    setKickingUserId(userId);
    try {
      await kickMember(conversation.id, userId);
      // Rotate sender key so the kicked member can't decrypt future messages
      if (isGroupConversation(conversation.id)) {
        try {
          // Fetch fresh participant list from server (kick already processed)
          const participants = await getParticipants(conversation.id);
          const remainingIds = participants.map(p => p.id);
          await rotateMySenderKey(conversation.id, myUserId, remainingIds, { emitSenderKeyDistributed });
        } catch (rotateErr) {
          console.warn('Failed to rotate sender key after kick:', rotateErr);
        }
      }
    } catch (err) {
      console.error('Failed to kick member:', err);
    } finally {
      setKickingUserId(null);
    }
  };

  // Handle copy invite link
  const handleCopyInvite = async () => {
    if (!conversation?.slug) return;
    const link = `${window.location.origin}/#/r/${conversation.slug}`;
    await navigator.clipboard.writeText(link);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  // Listen for nuke animation event
  useEffect(() => {
    const handleNuke = (e) => {
      if (e.detail?.conversationId !== conversation?.id) return;
      setShowNukeAnimation(true);
      setTimeout(() => setShowNukeAnimation(false), 1200);
    };
    window.addEventListener('blink-nuke', handleNuke);
    return () => window.removeEventListener('blink-nuke', handleNuke);
  }, [conversation?.id]);

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
    setShowGroupPanel(false);
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

  // Show/hide scroll-to-bottom FAB
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setShowScrollFab(scrollHeight - scrollTop - clientHeight > 300);
    };
    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Close menu on click anywhere
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  // After the menu renders, measure its actual height and flip upward if it overflows the viewport.
  // useLayoutEffect fires before the browser paints, so there's no visible flash.
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const el = menuRef.current;
    const elRect = el.getBoundingClientRect();
    if (elRect.bottom > window.innerHeight - 8) {
      const correctedY = Math.max(8, window.innerHeight - 8 - elRect.height);
      setMenu(prev => prev ? { ...prev, y: correctedY } : null);
    }
  }, [menu?.msg?.id]); // only re-run when a new menu is opened, not on every y update

  const openMenu = (e, msg) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 180; // matches minWidth in s.menu
    // Clamp so the menu doesn't overflow the right edge of the viewport
    const x = Math.min(rect.left, window.innerWidth - menuWidth - 8);
    // Place below the button; useLayoutEffect will flip upward if needed
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
    if (action === 'report') onReport?.(msg);
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
          const decrypted = await decryptMediaForConversation(conversation.id, encryptedData, iv, msg.senderId);
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
      <div style={{ ...s.window, alignItems: 'center', justifyContent: 'center', gap: '1.25rem', padding: '2rem' }} className="fade-in">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <p style={{ color: 'var(--text-primary)', fontSize: 'var(--text-lg)', fontWeight: 600, marginBottom: 0 }}>Welcome to Blink Text</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center', maxWidth: '360px', lineHeight: 1.6, marginTop: 0 }}>
          Private messaging with end-to-end encryption.<br />No phone number. No email. No trace.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxWidth: '340px', width: '100%' }}>
          {[
            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
              text: 'Messages are encrypted before they leave your device' },
            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
              text: 'Start a conversation with the "+ New" button' },
            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
              text: 'Set messages to auto-delete with the timer ⏱ icon' },
            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>,
              text: 'Send encrypted voice notes, images, and videos' },
          ].map((tip, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '0.65rem',
              padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elevated)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
            }}>
              <span style={{ flexShrink: 0, display: 'flex' }}>{tip.icon}</span>
              {tip.text}
            </div>
          ))}
        </div>

        <button
          style={{
            padding: '0.6rem 1.5rem', borderRadius: 'var(--radius-md)', border: 'none',
            background: 'var(--accent)', color: '#fff', fontSize: 'var(--text-md)',
            cursor: 'pointer', fontWeight: 600, marginTop: '0.25rem',
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
      <div style={{ ...s.header, position: 'relative' }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: '0.2rem 0.6rem 0.2rem 0',
              lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center',
            }}
            title="Back to conversations"
          ><BackIcon /></button>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {conversation.displayName || 'Conversation'}
        </span>
        {conversation.type === 'group_chat' && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginLeft: '0.4rem', flexShrink: 0 }}>
            ({(conversation.participant_ids || '').split(',').filter(Boolean).length})
          </span>
        )}
        {/* Group info button */}
        {conversation.type === 'group_chat' && (
          <button
            style={{ ...s.timerBtn, marginLeft: '0.25rem' }}
            onClick={(e) => { e.stopPropagation(); setShowGroupPanel((v) => !v); }}
            title="Group info"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </button>
        )}
        {/* Timer button */}
        <button
          style={s.timerBtn}
          onClick={(e) => { e.stopPropagation(); setShowTimerDropdown((v) => !v); }}
          title="Auto-delete timer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {conversation.disappear_after && (
            <span style={s.timerBadge}>{TIMER_SHORT_LABELS[conversation.disappear_after] || 'On'}</span>
          )}
        </button>
        {/* Timer dropdown */}
        {showTimerDropdown && (
          <div ref={timerDropdownRef} style={s.timerDropdown} onClick={(e) => e.stopPropagation()}>
            <div style={s.timerDropdownTitle}>Auto-delete</div>
            {TIMER_OPTIONS.map((opt) => {
              const active = (conversation.disappear_after || null) === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  style={s.timerOption(active)}
                  disabled={timerUpdating}
                  onClick={() => handleTimerChange(opt.value)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {opt.label}
                  {active && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Group info panel */}
      {showGroupPanel && conversation.type === 'group_chat' && (() => {
        const participantIds = (conversation.participant_ids || '').split(',').filter(Boolean);
        const participantNames = (conversation.participant_usernames || '').split(',').filter(Boolean);
        const isCreator = conversation.created_by === myUserId;
        const expiresAt = conversation.expires_at;
        return (
          <div style={{
            borderBottom: '1px solid var(--border-light)', background: 'var(--bg-elevated)',
            padding: '0.75rem 1.25rem', flexShrink: 0, maxHeight: '40vh', overflowY: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                Members ({participantIds.length})
              </span>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'var(--text-xs)' }}
                onClick={() => setShowGroupPanel(false)}
              >Close</button>
            </div>
            {participantIds.map((id, i) => (
              <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.3rem 0' }}>
                <span style={{ fontSize: 'var(--text-sm)', color: id === myUserId ? 'var(--accent)' : 'var(--text-primary)' }}>
                  {participantNames[i] || id.slice(0, 8)}
                  {id === conversation.created_by && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>Admin</span>}
                  {id === myUserId && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>(you)</span>}
                </span>
                {isCreator && id !== myUserId && (
                  <button
                    style={{ background: 'none', border: '1px solid var(--danger-muted)', borderRadius: 'var(--radius-sm)', color: 'var(--danger-muted)', fontSize: 'var(--text-xs)', padding: '0.15rem 0.5rem', cursor: 'pointer' }}
                    disabled={kickingUserId === id}
                    onClick={() => handleKick(id)}
                  >{kickingUserId === id ? 'Kicking...' : 'Kick'}</button>
                )}
              </div>
            ))}

            {conversation.slug && (
              <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Invite Link</div>
                <div style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--accent)', wordBreak: 'break-all', marginBottom: '0.35rem' }}>
                  {window.location.origin}/#/r/{conversation.slug}
                </div>
                <button
                  style={{ background: 'none', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontSize: 'var(--text-xs)', padding: '0.2rem 0.6rem', cursor: 'pointer' }}
                  onClick={handleCopyInvite}
                >{inviteCopied ? 'Copied!' : 'Copy Link'}</button>
              </div>
            )}

            {expiresAt && (
              <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-xs)', color: expiresAt <= Date.now() ? 'var(--danger-muted)' : 'var(--text-muted)' }}>
                {expiresAt <= Date.now() ? 'Room expired' : `Expires ${new Date(expiresAt).toLocaleString()}`}
              </div>
            )}
          </div>
        );
      })()}

      {!!conversation.has_deleted_participant && (
        <div style={{
          padding: '0.5rem 1.25rem', background: 'rgba(248,113,113,0.08)', borderBottom: '1px solid var(--border-light)',
          color: 'var(--danger-muted)', fontSize: 'var(--text-xs)', textAlign: 'center', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          This user has deleted their account. You can no longer send messages.
        </div>
      )}
      {conversation && !keyReady && !conversation.has_deleted_participant && (
        <div className="animate-banner-slide-in" style={{
          padding: '0.55rem 1.25rem', background: 'rgba(99, 102, 241, 0.07)',
          borderBottom: '1px solid rgba(99,102,241,0.18)',
          color: 'var(--accent)', fontSize: 'var(--text-xs)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem',
        }}>
          {/* Animated spinner */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: 'spin 0.9s linear infinite', flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
          <span style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
            <span style={{ fontWeight: 600 }}>
              {conversation.type === 'group_chat'
                ? 'Setting up group encryption…'
                : <>Setting up end-to-end encryption with <strong>{conversation.displayName || 'the other person'}</strong>…</>
              }
            </span>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              {conversation.type === 'group_chat'
                ? 'Exchanging keys with group members. You can type now — messages send when ready.'
                : 'Waiting for the other person to come online. You can type now — messages send when ready.'
              }
            </span>
          </span>
        </div>
      )}
      {showSecuredBanner && (
        <div className="animate-secure-flash" style={{
          padding: '0.45rem 1.25rem', background: 'rgba(74,222,128,0.1)',
          borderBottom: '1px solid rgba(74,222,128,0.2)',
          color: 'var(--success)', fontSize: 'var(--text-xs)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
          pointerEvents: 'none',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
          <span style={{ fontWeight: 600 }}>End-to-end encrypted</span>
          <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— your messages are secure</span>
        </div>
      )}
      <div style={s.messages} ref={messagesContainerRef}>
        {showNukeAnimation && (
          <div className="nuke-overlay">
            <div className="nuke-flash" />
            <div className="nuke-ring" />
            <div className="nuke-ring-2" />
          </div>
        )}
        {loadingMore && <p style={{ ...s.empty, padding: '0.5rem', fontSize: '0.8rem' }}>Loading older messages…</p>}
        {!loadingMore && hasMore && (
          <button style={s.loadMore} onClick={handleLoadMore}>
            ↑ Load older messages
          </button>
        )}
        {loading && <p style={s.empty}>Loading messages…</p>}
        {!loading && messages.length === 0 && (
          <div style={{ ...s.empty, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '3rem 1.5rem' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Say hello! Your message will be<br />encrypted before it leaves your device.</span>
          </div>
        )}
        {messages.map((msg, idx) => {
          const mine = msg.senderId === myUserId;
          const replyText = getReplyText(msg.replyToId);
          // Show date separator when the day changes between consecutive messages
          const prevMsg = idx > 0 ? messages[idx - 1] : null;
          const showDateSep = !prevMsg || getDateKey(msg.timestamp) !== getDateKey(prevMsg.timestamp);
          return (
            <div key={msg.id} style={{ display: 'contents' }}>
            {showDateSep && (
              <div style={s.dateSeparator}>
                <div style={s.dateLine} />
                <span style={s.dateLabel}>{getDateLabel(msg.timestamp)}</span>
                <div style={s.dateLine} />
              </div>
            )}
            <div
              style={s.row(mine)}
              onMouseEnter={() => setHoveredId(msg.id)}
              onMouseLeave={() => setHoveredId(null)}
              onTouchStart={(e) => {
                const touch = e.touches[0];
                longPressTimer.current = setTimeout(() => {
                  const menuWidth = 180;
                  const x = Math.min(touch.clientX, window.innerWidth - menuWidth - 8);
                  const y = touch.clientY;
                  setMenu({ x, y, msg });
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
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
                  title="Options"
                >⋮</button>
              )}

              <div style={s.bubbleCol(mine)}>
                {/* Show sender name in group conversations for other people's messages */}
                {conversation.type === 'group_chat' && !mine && (() => {
                  const ids = (conversation.participant_ids || '').split(',').filter(Boolean);
                  const names = (conversation.participant_usernames || '').split(',').filter(Boolean);
                  const idx = ids.indexOf(msg.senderId);
                  const senderName = idx >= 0 ? names[idx] : msg.senderId?.slice(0, 8);
                  return (
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.1rem' }}>
                      {senderName}
                    </span>
                  );
                })()}
                {replyText && (
                  <div style={s.replyQuote}><span style={{display:'inline-flex',alignItems:'center',gap:'0.25rem'}}><MReplyIcon /> {replyText}</span></div>
                )}
                {(msg.messageType === 'image' || msg.messageType === 'video' || msg.messageType === 'voice') && msg.mediaId ? (
                  <MediaBubble msg={msg} mine={mine} conversationId={conversation.id} onPreview={setPreviewMedia} />
                ) : (
                  <div style={msg.plaintext === '[unable to decrypt]'
                    ? { ...s.bubble(mine), background: 'var(--bg-elevated)', border: '1px dashed var(--border-light)', fontStyle: 'italic', color: 'var(--text-faint)', fontSize: 'var(--text-sm)' }
                    : msg._queued
                    ? { ...s.bubble(mine), opacity: 0.6 }
                    : s.bubble(mine)
                  }>
                    {msg.plaintext === '[unable to decrypt]'
                      ? '🔒 This message can\'t be decrypted — encryption keys have changed'
                      : linkifyText(msg.plaintext)}
                    {msg.edited && <span style={s.edited}>(edited)</span>}
                    {msg._failed && <span style={{ ...s.edited, color: 'var(--danger-muted)' }}> (failed)</span>}
                  </div>
                )}
                <div style={s.meta(mine)}>
                  {msg._queued && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '0.25rem', opacity: 0.6 }}>
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                  )}
                  {formatTime(msg.timestamp)}
                  {msg.expiresAt && (
                    <span style={s.expiryBadge} title={`Expires ${new Date(msg.expiresAt).toLocaleString()}`}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {formatTimeLeft(msg.expiresAt)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
        {showScrollFab && (
          <button style={s.scrollFab} onClick={scrollToBottom} title="Scroll to bottom">
            <ChevronDownIcon />
          </button>
        )}
      </div>

      {menu && (
        <div ref={menuRef} style={{ ...s.menu, left: menu.x, top: menu.y }}>
          <button style={s.menuItem}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => handleAction('reply')}>
            <MReplyIcon /> Reply
          </button>
          <button style={s.menuItem}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => handleAction('forward')}>
            <MForwardIcon /> Forward
          </button>
          {menu.msg.senderId === myUserId && menu.msg.messageType !== 'image' && menu.msg.messageType !== 'video' && menu.msg.messageType !== 'voice' && (
            <button style={s.menuItem}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleAction('edit')}>
              <MEditIcon /> Edit
            </button>
          )}
          {(menu.msg.messageType === 'image' || menu.msg.messageType === 'video' || menu.msg.messageType === 'voice') && menu.msg.mediaId && (
            <button style={s.menuItem}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleAction('download')}>
              <MDownloadIcon /> Download
            </button>
          )}
          {menu.msg.senderId !== myUserId && (
            <button style={s.menuItem}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleAction('report')}>
              <MFlagIcon /> Report
            </button>
          )}
          <button style={s.menuItem}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            onClick={() => handleAction('delete_me')}>
            <MTrashIcon /> Delete for me
          </button>
          {menu.msg.senderId === myUserId && (
            <button style={s.menuItemDanger}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              onClick={() => handleAction('delete_all')}>
              <MTrashIcon /> Delete for everyone
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
