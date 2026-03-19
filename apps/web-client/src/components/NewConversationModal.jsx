import { useState } from 'react';
import { createConversation, searchUsers } from '../services/api.js';

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '1.5rem',
    width: '100%', maxWidth: '400px', margin: '0 1rem',
    boxShadow: 'var(--shadow-lg)',
  },
  title: { color: 'var(--text-primary)', fontWeight: 700, fontSize: 'var(--text-lg)', marginBottom: '1rem' },
  label: { display: 'block', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: '0.25rem', fontWeight: 500 },
  input: {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
    fontSize: 'var(--text-md)', marginBottom: '0.75rem',
  },
  select: {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
    fontSize: 'var(--text-md)', marginBottom: '0.75rem',
  },
  actions: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' },
  cancelBtn: {
    padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 500,
  },
  createBtn: {
    padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: 'none',
    background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600,
  },
  error: { color: 'var(--danger-muted)', fontSize: 'var(--text-sm)', marginBottom: '0.5rem' },
  userItem: {
    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0',
    cursor: 'pointer', color: 'var(--text-muted)',
  },
};

const TIMER_OPTIONS = [
  { value: '', label: 'Off' },
  { value: '300000', label: '5 minutes' },
  { value: '3600000', label: '1 hour' },
  { value: '86400000', label: '24 hours' },
  { value: '604800000', label: '7 days' },
  { value: '2592000000', label: '30 days' },
];

export default function NewConversationModal({ currentUser, onClose, onCreated }) {
  const [type, setType] = useState('direct_message');
  const [recipientUsername, setRecipientUsername] = useState('');
  const [groupName, setGroupName] = useState('');
  const [disappearAfter, setDisappearAfter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // For group: we'd need a user search endpoint; for now we support entering a user ID directly.
  const handleCreate = async () => {
    setError('');
    setLoading(true);
    const timerValue = disappearAfter ? parseInt(disappearAfter, 10) : null;
    try {
      if (!recipientUsername.trim()) {
        setError('Please enter a username');
        setLoading(false);
        return;
      }

      if (type === 'group_chat') {
        // Group chats: split comma-separated usernames, resolve each (Issue 4.1)
        const usernames = recipientUsername.split(',').map((u) => u.trim()).filter(Boolean);
        if (usernames.length < 1) {
          setError('Enter at least one username');
          setLoading(false);
          return;
        }
        const participantIds = new Set();
        for (const uname of usernames) {
          const users = await searchUsers(uname);
          const matched = users.find(
            (u) => u.username.toLowerCase() === uname.toLowerCase()
          );
          if (!matched) {
            setError(`Username not found: ${uname}`);
            setLoading(false);
            return;
          }
          participantIds.add(matched.id);
        }
        const participants = Array.from(participantIds);
        const conv = await createConversation(type, participants, groupName || undefined, timerValue);
        onCreated(conv);
        onClose();
      } else {
        // Direct message: single recipient
        const users = await searchUsers(recipientUsername.trim());
        const matchedUser = users.find(
          (u) => u.username.toLowerCase() === recipientUsername.trim().toLowerCase()
        );
        if (!matchedUser) {
          setError('Username not found');
          setLoading(false);
          return;
        }
        const participants = [matchedUser.id];
        const conv = await createConversation(type, participants, groupName || undefined, timerValue);
        onCreated(conv);
        onClose();
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create conversation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <h2 style={s.title}>New Conversation</h2>

        <label style={s.label}>Type</label>
        <select style={s.select} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="direct_message">Direct</option>
          <option value="group_chat" disabled>Group (coming soon)</option>
        </select>

        {type === 'group_chat' && (
          <>
            <label style={s.label}>Group Name</label>
            <input
              style={s.input}
              type="text"
              placeholder="My Group"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </>
        )}

        <label style={s.label}>
        {type === 'direct_message' ? 'Recipient Username' : 'Participant Usernames (comma-separated)'}
        </label>
        <input
          style={s.input}
          type="text"
          placeholder={type === 'direct_message' ? 'username…' : 'alice, bob, charlie'}
          value={recipientUsername}
          onChange={(e) => setRecipientUsername(e.target.value)}
        />

        <label style={s.label}>Auto-delete Timer</label>
        <select
          style={s.select}
          value={disappearAfter}
          onChange={(e) => setDisappearAfter(e.target.value)}
        >
          {TIMER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {error && <p style={s.error}>{error}</p>}

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.createBtn} onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
