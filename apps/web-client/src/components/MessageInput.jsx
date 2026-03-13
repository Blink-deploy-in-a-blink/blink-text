import { useState, useRef } from 'react';

const s = {
  container: {
    borderTop: '1px solid #222', padding: '0.75rem 1rem',
    display: 'flex', gap: '0.5rem', background: '#111', alignItems: 'flex-end',
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

export default function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    setText('');
    textareaRef.current?.focus();
    await onSend(trimmed);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={s.container}>
      <textarea
        ref={textareaRef}
        style={s.textarea}
        rows={1}
        placeholder={disabled ? 'Select a conversation…' : 'Type a message… (Enter to send)'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button style={s.btn} onClick={handleSend} disabled={disabled || !text.trim()}>
        ➤
      </button>
    </div>
  );
}
