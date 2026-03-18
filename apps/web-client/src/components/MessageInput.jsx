import { useState, useRef, useEffect, useCallback } from 'react';

/* ── Small SVG icons ── */
const PaperclipIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>;
const MicIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>;
const SendIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>;
const CheckIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const StopIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>;
const VideoIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>;
const ReplyIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>;
const EditPenIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;

const s = {
  wrapper: { borderTop: '1px solid var(--border-default)', background: 'var(--bg-secondary)', flexShrink: 0 },
  replyBar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.4rem 1rem', background: 'var(--bg-active)', borderBottom: '1px solid var(--border-default)',
    fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
  },
  replyText: {
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  replyClose: {
    background: 'transparent', border: 'none', color: 'var(--text-faint)',
    cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem', transition: 'color 0.15s',
  },
  editBar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.4rem 1rem', background: 'rgba(99,102,241,0.08)', borderBottom: '1px solid var(--border-default)',
    fontSize: 'var(--text-sm)', color: 'var(--accent-muted)',
  },
  container: {
    padding: '0.75rem 1rem',
    display: 'flex', gap: '0.5rem', alignItems: 'flex-end',
  },
  textarea: {
    flex: 1, resize: 'none', background: 'var(--bg-elevated)', color: 'var(--text-primary)',
    border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.85rem',
    fontSize: '16px', fontFamily: 'inherit', lineHeight: 1.5,
    maxHeight: '120px', overflowY: 'auto',
  },
  btn: {
    padding: '0.6rem 1.1rem', borderRadius: 'var(--radius-md)', border: 'none',
    background: 'var(--accent)', color: '#fff', fontSize: '1rem',
    cursor: 'pointer', fontWeight: 600, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
  },
  iconBtn: {
    padding: '0.6rem', borderRadius: 'var(--radius-md)', border: 'none',
    background: 'transparent', color: 'var(--text-faint)', fontSize: '1.2rem',
    cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', transition: 'color 0.15s',
  },
  recordingBar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.4rem 1rem', background: 'rgba(248,113,113,0.08)', borderBottom: '1px solid var(--border-light)',
    fontSize: 'var(--text-sm)', color: 'var(--danger-muted)',
  },
  recordDot: {
    width: '8px', height: '8px', borderRadius: '50%', background: 'var(--danger-muted)',
    animation: 'blink-dot 1s infinite',
  },
  previewBar: {
    display: 'flex', alignItems: 'center', gap: '0.5rem',
    padding: '0.5rem 1rem', background: 'var(--bg-active)', borderBottom: '1px solid var(--border-default)',
    fontSize: 'var(--text-sm)', color: 'var(--text-muted)',
  },
  previewThumb: {
    width: '40px', height: '40px', objectFit: 'cover', borderRadius: 'var(--radius-sm)',
  },
  previewName: {
    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
};

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
          <ReplyIcon />
          <span style={s.replyText}>{replyTo.plaintext}</span>
          <button style={s.replyClose} onClick={onCancelReply} title="Cancel reply">✕</button>
        </div>
      )}
      {editingMsg && (
        <div style={s.editBar}>
          <span style={{display:'flex',alignItems:'center',gap:'0.35rem'}}><EditPenIcon /> Editing</span>
          <button style={s.replyClose} onClick={() => { onCancelEdit?.(); setText(''); }} title="Cancel edit">✕</button>
        </div>
      )}
      {isRecording && (
        <div style={s.recordingBar}>
          <div style={s.recordDot} />
          <span>Recording… {formatDuration(recordingDuration)}</span>
          <div style={{ flex: 1 }} />
          <button style={{ ...s.replyClose, color: 'var(--danger-muted)' }} onClick={cancelRecording} title="Cancel">✕</button>
        </div>
      )}
      {selectedFile && !isRecording && (
        <div style={s.previewBar}>
          {filePreviewUrl && <img src={filePreviewUrl} alt="preview" style={s.previewThumb} />}
          {!filePreviewUrl && selectedFile.type.startsWith('video/') && <VideoIcon />}
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
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
          ><PaperclipIcon /></button>
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
            style={{ ...s.iconBtn }}
            onClick={startRecording}
            disabled={disabled || sending}
            title="Record voice note"
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
          ><MicIcon /></button>
        )}
        {isRecording && (
          <button style={{ ...s.btn, background: 'var(--danger-muted)' }} onClick={stopRecording} title="Stop and send">
            <StopIcon /> Send
          </button>
        )}
        {!isRecording && (text.trim() || selectedFile || editingMsg) && (
          <button style={s.btn} onClick={handleSend} disabled={disabled || sending || (!text.trim() && !selectedFile)}>
            {sending ? '…' : editingMsg ? <CheckIcon /> : <SendIcon />}
          </button>
        )}
      </div>
    </div>
  );
}
