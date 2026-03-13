import { useState, useRef, useEffect } from 'react';

const s = {
  wrapper: { borderTop: '1px solid #222', background: '#111' },
  replyBar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.4rem 1rem', background: '#1a1a2e', borderBottom: '1px solid #222',
    fontSize: '0.8rem', color: '#aaa',
  },
  replyText: {
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  replyClose: {
    background: 'transparent', border: 'none', color: '#888',
    cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem',
  },
  editBar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.4rem 1rem', background: '#1e1a2e', borderBottom: '1px solid #222',
    fontSize: '0.8rem', color: '#c4b5fd',
  },
  container: {
    padding: '0.75rem 1rem',
    display: 'flex', gap: '0.5rem', alignItems: 'flex-end',
  },
  textarea: {
    flex: 1, resize: 'none', background: '#1a1a1a', color: '#fff',
    border: '1px solid #333', borderRadius: '10px', padding: '0.6rem 0.85rem',
    fontSize: '0.95rem', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
    maxHeight: '120px', overflowY: 'auto',
  },
  btn: {
    padding: '0.6rem 1.1rem', borderRadius: '10px', border: 'none',
    background: '#6366f1', color: '#fff', fontSize: '1rem',
    cursor: 'pointer', fontWeight: 600, flexShrink: 0,
  },
};

export default function MessageInput({ onSend, onSaveEdit, disabled, replyTo, editingMsg, onCancelReply, onCancelEdit, peerDeleted }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  // When entering edit mode, populate textarea with the existing message
  useEffect(() => {
    if (editingMsg) {
      setText(editingMsg.plaintext || '');
      textareaRef.current?.focus();
    }
  }, [editingMsg]);

  // Focus when reply is set
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText('');

    if (editingMsg) {
      await onSaveEdit(editingMsg.id, trimmed);
    } else {
      await onSend(trimmed, replyTo?.id || null);
    }
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      if (editingMsg) onCancelEdit?.();
      else if (replyTo) onCancelReply?.();
    }
  };

  const placeholder = peerDeleted
    ? 'This user has deleted their account'
    : disabled
      ? 'Select a conversation…'
      : editingMsg
        ? 'Edit your message… (Esc to cancel)'
        : 'Type a message… (Enter to send)';

  return (
    <div style={s.wrapper}>
      {replyTo && !editingMsg && (
        <div style={s.replyBar}>
          <span>↩</span>
          <span style={s.replyText}>{replyTo.plaintext}</span>
          <button style={s.replyClose} onClick={onCancelReply} title="Cancel reply">✕</button>
        </div>
      )}
      {editingMsg && (
        <div style={s.editBar}>
          <span>✏️ Editing</span>
          <button style={s.replyClose} onClick={() => { onCancelEdit?.(); setText(''); }} title="Cancel edit">✕</button>
        </div>
      )}
      <div style={s.container}>
        <textarea
          ref={textareaRef}
          style={s.textarea}
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button style={s.btn} onClick={handleSend} disabled={disabled || !text.trim()}>
          {editingMsg ? '✓' : '➤'}
        </button>
      </div>
    </div>
  );
}
