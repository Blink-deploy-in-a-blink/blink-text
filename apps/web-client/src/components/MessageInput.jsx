import { useState, useRef, useEffect, useCallback } from 'react';

const s = {
  wrapper: { borderTop: '1px solid #222', background: '#111', flexShrink: 0 },
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
    fontSize: '16px', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
    maxHeight: '120px', overflowY: 'auto',
  },
  btn: {
    padding: '0.6rem 1.1rem', borderRadius: '10px', border: 'none',
    background: '#6366f1', color: '#fff', fontSize: '1rem',
    cursor: 'pointer', fontWeight: 600, flexShrink: 0,
  },
  iconBtn: {
    padding: '0.6rem', borderRadius: '10px', border: 'none',
    background: 'transparent', color: '#888', fontSize: '1.2rem',
    cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center',
  },
  recordingBar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.4rem 1rem', background: '#2a1a1a', borderBottom: '1px solid #333',
    fontSize: '0.8rem', color: '#f87171',
  },
  recordDot: {
    width: '8px', height: '8px', borderRadius: '50%', background: '#f87171',
    animation: 'blink-dot 1s infinite',
  },
  previewBar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.5rem 1rem', background: '#1a1a2e', borderBottom: '1px solid #222',
    fontSize: '0.8rem', color: '#aaa',
  },
  previewThumb: {
    width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px',
  },
  previewName: {
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
};

// Inject keyframe animation for recording indicator
if (typeof document !== 'undefined' && !document.getElementById('blink-dot-keyframes')) {
  const style = document.createElement('style');
  style.id = 'blink-dot-keyframes';
  style.textContent = '@keyframes blink-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }';
  document.head.appendChild(style);
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function MessageInput({ onSend, onSendMedia, onSaveEdit, disabled, replyTo, editingMsg, onCancelReply, onCancelEdit, peerDeleted }) {
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

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

  // Clean up file preview URL on unmount
  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
  }, [filePreviewUrl]);

  const clearFileSelection = useCallback(() => {
    setSelectedFile(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
  }, [filePreviewUrl]);

  const handleSend = async () => {
    if (sending) return;

    // Handle file attachment send
    if (selectedFile && !editingMsg) {
      setSending(true);
      try {
        const isVideo = selectedFile.type.startsWith('video/');
        const messageType = isVideo ? 'video' : 'image';
        await onSendMedia(selectedFile, messageType, replyTo?.id || null);
        clearFileSelection();
        setReplyAfterSend();
      } catch (err) {
        console.error('Failed to send media:', err);
      } finally {
        setSending(false);
      }
      return;
    }

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

  const setReplyAfterSend = () => {
    // Reply is cleared by the parent after send via onCancelReply
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      if (editingMsg) onCancelEdit?.();
      else if (selectedFile) clearFileSelection();
      else if (replyTo) onCancelReply?.();
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;
    setSelectedFile(file);
    if (file.type.startsWith('image/')) {
      setFilePreviewUrl(URL.createObjectURL(file));
    } else {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    e.target.value = '';
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (blob.size === 0) return;
        const file = new File([blob], 'voice-note.webm', { type: mimeType });
        setSending(true);
        try {
          await onSendMedia(file, 'voice', replyTo?.id || null);
        } catch (err) {
          console.error('Failed to send voice note:', err);
        } finally {
          setSending(false);
        }
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      console.error('Microphone access denied:', err);
    }
  }, [onSendMedia, replyTo]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    clearInterval(recordingTimerRef.current);
    setRecordingDuration(0);
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = () => {
        // Stop tracks without sending
        const tracks = mediaRecorderRef.current?.stream?.getTracks();
        if (tracks) tracks.forEach((t) => t.stop());
      };
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }
    setIsRecording(false);
    clearInterval(recordingTimerRef.current);
    setRecordingDuration(0);
    recordedChunksRef.current = [];
  }, []);

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
      {isRecording && (
        <div style={s.recordingBar}>
          <div style={s.recordDot} />
          <span>Recording… {formatDuration(recordingDuration)}</span>
          <div style={{ flex: 1 }} />
          <button style={{ ...s.replyClose, color: '#f87171' }} onClick={cancelRecording} title="Cancel">✕</button>
        </div>
      )}
      {selectedFile && !isRecording && (
        <div style={s.previewBar}>
          {filePreviewUrl && <img src={filePreviewUrl} alt="preview" style={s.previewThumb} />}
          {!filePreviewUrl && selectedFile.type.startsWith('video/') && <span>🎬</span>}
          <span style={s.previewName}>{selectedFile.name} ({formatFileSize(selectedFile.size)})</span>
          <button style={s.replyClose} onClick={clearFileSelection} title="Remove">✕</button>
        </div>
      )}
      <div style={s.container}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        {!editingMsg && !isRecording && (
          <button
            style={s.iconBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || sending}
            title="Attach image or video"
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
          >📎</button>
        )}
        {!isRecording && (
          <textarea
            ref={textareaRef}
            style={s.textarea}
            rows={1}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || sending}
          />
        )}
        {isRecording && <div style={{ flex: 1 }} />}
        {!editingMsg && !selectedFile && !text.trim() && !isRecording && (
          <button
            style={{ ...s.iconBtn, fontSize: '1.3rem' }}
            onClick={startRecording}
            disabled={disabled || sending}
            title="Record voice note"
            onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#888')}
          >🎤</button>
        )}
        {isRecording && (
          <button style={{ ...s.btn, background: '#f87171' }} onClick={stopRecording} title="Stop and send">
            ⏹ Send
          </button>
        )}
        {!isRecording && (text.trim() || selectedFile || editingMsg) && (
          <button style={s.btn} onClick={handleSend} disabled={disabled || sending || (!text.trim() && !selectedFile)}>
            {sending ? '…' : editingMsg ? '✓' : '➤'}
          </button>
        )}
      </div>
    </div>
  );
}
