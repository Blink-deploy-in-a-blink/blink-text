import { useState } from 'react';
import { createConversation, searchUsers } from '../services/api.js';

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: '#1a1a1a', borderRadius: '12px', padding: '1.5rem',
    width: '100%', maxWidth: '400px', margin: '0 1rem',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
  },
  title: { color: '#fff', fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem' },
  label: { display: 'block', color: '#aaa', fontSize: '0.85rem', marginBottom: '0.25rem' },
  input: {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px',
    border: '1px solid #333', background: '#0f0f0f', color: '#fff',
    fontSize: '0.95rem', marginBottom: '0.75rem', outline: 'none',
  },
  select: {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px',
    border: '1px solid #333', background: '#0f0f0f', color: '#fff',
    fontSize: '0.95rem', marginBottom: '0.75rem', outline: 'none',
  },
  actions: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' },
  cancelBtn: {
    padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #333',
    background: 'transparent', color: '#aaa', cursor: 'pointer',
  },
  createBtn: {
    padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
    background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 600,
  },
  error: { color: '#f87171', fontSize: '0.85rem', marginBottom: '0.5rem' },
  userItem: {
    display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0',
    cursor: 'pointer', color: '#ccc',
  },
};

export default function NewConversationModal({ currentUser, onClose, onCreated }) {
  const [type, setType] = useState('direct_message');
  const [recipientUsername, setRecipientUsername] = useState('');
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // For group: we'd need a user search endpoint; for now we support entering a user ID directly.
  const handleCreate = async () => {
    setError('');
    setLoading(true);
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
        const conv = await createConversation(type, participants, groupName || undefined);
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
        const conv = await createConversation(type, participants, groupName || undefined);
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
          <option value="group_chat">Group</option>
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
