import { useState, useCallback } from 'react';
import { createConversation, searchUsers, updateInviteSettings } from '../services/api.js';

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modal: {
    background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '1.5rem',
    width: '100%', maxWidth: '440px', margin: '0 1rem',
    boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto',
  },
  title: { color: 'var(--text-primary)', fontWeight: 700, fontSize: 'var(--text-lg)', marginBottom: '1rem' },
  label: { display: 'block', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: '0.25rem', fontWeight: 500 },
  input: {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
    fontSize: 'var(--text-md)', marginBottom: '0.75rem', boxSizing: 'border-box',
  },
  select: {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
    fontSize: 'var(--text-md)', marginBottom: '0.75rem', boxSizing: 'border-box',
  },
  actions: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' },
  cancelBtn: {
    padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-light)',
    background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 500,
  },
  createBtn: {
    padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: 'none',
    background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600,
  },
  error: { color: 'var(--danger-muted)', fontSize: 'var(--text-sm)', marginBottom: '0.5rem' },
  tabs: { display: 'flex', marginBottom: '1rem', borderBottom: '1px solid var(--border-light)' },
  tab: (active) => ({
    flex: 1, padding: '0.6rem 0', textAlign: 'center', cursor: 'pointer',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    fontWeight: active ? 600 : 400, fontSize: 'var(--text-sm)',
    background: 'transparent', border: 'none', transition: 'color 0.15s',
  }),
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
    padding: '0.2rem 0.6rem', borderRadius: '999px',
    background: 'var(--accent)', color: '#fff', fontSize: 'var(--text-xs)', fontWeight: 500,
  },
  chipX: { background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 'var(--text-xs)', padding: 0, opacity: 0.8 },
  inviteBox: {
    background: 'var(--bg-primary)', border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-md)', padding: '0.75rem', marginTop: '0.75rem',
  },
  inviteLink: { fontFamily: 'monospace', fontSize: 'var(--text-sm)', color: 'var(--accent)', wordBreak: 'break-all' },
  copyBtn: {
    marginTop: '0.5rem', padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)',
    cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 500,
  },
  toggleLabel: {
    display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)',
    fontSize: 'var(--text-sm)', cursor: 'pointer', marginBottom: '0.5rem',
  },
  slider: { width: '100%', accentColor: 'var(--accent)', marginBottom: '0.75rem' },
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

const EXPIRY_OPTIONS = [
  { value: '', label: 'Never' },
  { value: '3600000', label: '1 hour' },
  { value: '86400000', label: '24 hours' },
  { value: '604800000', label: '7 days' },
  { value: '2592000000', label: '30 days' },
];

const TABS = [
  { key: 'dm', label: 'Direct' },
  { key: 'group', label: 'Group' },
  { key: 'room', label: 'Room' },
];

export default function NewConversationModal({ currentUser, onClose, onCreated }) {
  const [tab, setTab] = useState('dm');
  const [recipientUsername, setRecipientUsername] = useState('');
  const [groupName, setGroupName] = useState('');
  const [disappearAfter, setDisappearAfter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Group member chips
  const [members, setMembers] = useState([]);          // [{id, username}]
  const [memberInput, setMemberInput] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Room options
  const [roomPassword, setRoomPassword] = useState('');
  const [allowGuests, setAllowGuests] = useState(true);
  const [maxParticipants, setMaxParticipants] = useState(50);
  const [expiresIn, setExpiresIn] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  /* --- helpers --- */
  const searchMember = useCallback(async (q) => {
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const res = await searchUsers(q.trim());
      setSearchResults(res.filter(
        (u) => u.id !== currentUser.id && !members.some((m) => m.id === u.id)
      ));
    } catch { setSearchResults([]); }
  }, [currentUser, members]);

  const addMember = (u) => {
    setMembers((prev) => [...prev, { id: u.id, username: u.username }]);
    setMemberInput('');
    setSearchResults([]);
  };
  const removeMember = (id) => setMembers((prev) => prev.filter((m) => m.id !== id));

  /* --- create --- */
  const handleCreate = async () => {
    setError('');
    setLoading(true);
    try {
      const timerValue = disappearAfter ? parseInt(disappearAfter, 10) : null;

      if (tab === 'dm') {
        if (!recipientUsername.trim()) { setError('Enter a username'); setLoading(false); return; }
        const users = await searchUsers(recipientUsername.trim());
        const matched = users.find((u) => u.username.toLowerCase() === recipientUsername.trim().toLowerCase());
        if (!matched) { setError('Username not found'); setLoading(false); return; }
        const conv = await createConversation('direct_message', [matched.id], undefined, timerValue);
        onCreated(conv);
        onClose();
      } else if (tab === 'group') {
        if (!groupName.trim()) { setError('Enter a group name'); setLoading(false); return; }
        if (members.length < 1) { setError('Add at least one member'); setLoading(false); return; }
        const conv = await createConversation(
          'group_chat',
          members.map((m) => m.id),
          groupName.trim(),
          timerValue,
        );
        onCreated(conv);
        onClose();
      } else {
        // Room
        if (!groupName.trim()) { setError('Enter a room name'); setLoading(false); return; }
        const expiresMs = expiresIn ? parseInt(expiresIn, 10) : null;
        const conv = await createConversation(
          'group_chat',
          members.map((m) => m.id),
          groupName.trim(),
          timerValue,
          { allowGuests, password: roomPassword || undefined, maxParticipants, expiresIn: expiresMs },
        );
        // Enable invite link
        try {
          const updated = await updateInviteSettings(conv.id, true);
          if (updated.slug) {
            setInviteLink(`${window.location.origin}/#/r/${updated.slug}`);
          }
        } catch { /* non-critical */ }
        onCreated(conv);
        if (!inviteLink) onClose();
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create conversation');
    } finally {
      setLoading(false);
    }
  };

  /* --- render --- */
  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <h2 style={s.title}>New Conversation</h2>

        {/* Tab bar */}
        <div style={s.tabs}>
          {TABS.map((t) => (
            <button key={t.key} style={s.tab(tab === t.key)} onClick={() => { setTab(t.key); setError(''); }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ---------- DM tab ---------- */}
        {tab === 'dm' && (
          <>
            <label style={s.label}>Recipient Username</label>
            <input style={s.input} type="text" placeholder="username"
              value={recipientUsername} onChange={(e) => setRecipientUsername(e.target.value)} />
          </>
        )}

        {/* ---------- Group tab ---------- */}
        {tab === 'group' && (
          <>
            <label style={s.label}>Group Name</label>
            <input style={s.input} type="text" placeholder="My Group"
              value={groupName} onChange={(e) => setGroupName(e.target.value)} />

            <label style={s.label}>Add Members</label>
            {members.length > 0 && (
              <div style={s.chipRow}>
                {members.map((m) => (
                  <span key={m.id} style={s.chip}>
                    {m.username}
                    <button style={s.chipX} onClick={() => removeMember(m.id)}>&times;</button>
                  </span>
                ))}
              </div>
            )}
            <input style={s.input} type="text" placeholder="Search username..."
              value={memberInput} onChange={(e) => { setMemberInput(e.target.value); searchMember(e.target.value); }} />
            {searchResults.length > 0 && (
              <div style={{ maxHeight: '120px', overflowY: 'auto', marginBottom: '0.5rem' }}>
                {searchResults.map((u) => (
                  <div key={u.id} style={s.userItem} onClick={() => addMember(u)}>+ {u.username}</div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ---------- Room tab ---------- */}
        {tab === 'room' && (
          <>
            <label style={s.label}>Room Name</label>
            <input style={s.input} type="text" placeholder="Friday Hangout"
              value={groupName} onChange={(e) => setGroupName(e.target.value)} />

            <label style={s.toggleLabel}>
              <input type="checkbox" checked={allowGuests} onChange={(e) => setAllowGuests(e.target.checked)} />
              Allow guests (no account needed)
            </label>

            <label style={s.label}>Room Password (optional)</label>
            <input style={s.input} type="password" placeholder="Leave blank for open room"
              value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} />

            <label style={s.label}>Max Participants: {maxParticipants}</label>
            <input type="range" min="2" max="200" style={s.slider}
              value={maxParticipants} onChange={(e) => setMaxParticipants(Number(e.target.value))} />

            <label style={s.label}>Room Expires</label>
            <select style={s.select} value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Pre-add registered members */}
            <label style={s.label}>Invite Members (optional)</label>
            {members.length > 0 && (
              <div style={s.chipRow}>
                {members.map((m) => (
                  <span key={m.id} style={s.chip}>
                    {m.username}
                    <button style={s.chipX} onClick={() => removeMember(m.id)}>&times;</button>
                  </span>
                ))}
              </div>
            )}
            <input style={s.input} type="text" placeholder="Search username..."
              value={memberInput} onChange={(e) => { setMemberInput(e.target.value); searchMember(e.target.value); }} />
            {searchResults.length > 0 && (
              <div style={{ maxHeight: '120px', overflowY: 'auto', marginBottom: '0.5rem' }}>
                {searchResults.map((u) => (
                  <div key={u.id} style={s.userItem} onClick={() => addMember(u)}>+ {u.username}</div>
                ))}
              </div>
            )}

            {inviteLink && (
              <div style={s.inviteBox}>
                <label style={s.label}>Invite Link</label>
                <div style={s.inviteLink}>{inviteLink}</div>
                <button style={s.copyBtn} onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy Link</button>
              </div>
            )}
          </>
        )}

        {/* Common: timer */}
        <label style={s.label}>Auto-delete Timer</label>
        <select style={s.select} value={disappearAfter} onChange={(e) => setDisappearAfter(e.target.value)}>
          {TIMER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {error && <p style={s.error}>{error}</p>}

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={s.createBtn} onClick={handleCreate} disabled={loading}>
            {loading ? 'Creating...' : (tab === 'room' ? 'Create Room' : 'Create')}
          </button>
        </div>
      </div>
    </div>
  );
}
