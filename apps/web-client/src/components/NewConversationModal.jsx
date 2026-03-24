import { useState, useCallback, useEffect, useRef } from 'react';
import { createConversation, searchUsers } from '../services/api.js';

/* ── Avatar helpers ───────────────────────────────────────────────── */
const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
];

function avatarColor(username) {
  let h = 0;
  for (let i = 0; i < (username || '').length; i++) h = (h * 31 + username.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function UserAvatar({ username, size = 32 }) {
  const initial = (username || '?')[0].toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: avatarColor(username),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.4,
      userSelect: 'none',
    }}>
      {initial}
    </div>
  );
}

/* ── Loading spinner ──────────────────────────────────────────────── */
function Spinner({ size = 14, color = '#fff' }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.5" strokeLinecap="round"
      style={{ animation: 'spin 0.7s linear infinite', flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

/* ── Tab icons ────────────────────────────────────────────────────── */
const DmIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);
const GroupIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const RoomIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

/* ── Styles ───────────────────────────────────────────────────────── */
const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    animation: 'fadeIn 0.15s ease',
  },
  modal: {
    background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '1.5rem',
    width: '100%', maxWidth: '440px', margin: '0 1rem',
    boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto',
    animation: 'fadeInScale 0.2s ease',
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
  createBtn: (disabled) => ({
    padding: '0.5rem 1.1rem', borderRadius: 'var(--radius-md)', border: 'none',
    background: 'var(--accent)', color: '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: disabled ? 0.75 : 1,
  }),
  error: { color: 'var(--danger-muted)', fontSize: 'var(--text-sm)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.35rem' },
  tabs: { display: 'flex', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-light)', gap: '0' },
  tab: (active) => ({
    flex: 1, padding: '0.55rem 0.5rem', textAlign: 'center', cursor: 'pointer',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    borderTop: 'none', borderLeft: 'none', borderRight: 'none',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    fontWeight: active ? 600 : 400, fontSize: 'var(--text-sm)',
    background: 'transparent', transition: 'color 0.15s',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
  }),
  /* ─── DM user-select card ─── */
  selectedUserCard: {
    display: 'flex', alignItems: 'center', gap: '0.75rem',
    padding: '0.65rem 0.75rem', borderRadius: 'var(--radius-md)',
    background: 'var(--bg-primary)', border: '1px solid var(--accent)',
    marginBottom: '0.75rem', animation: 'fadeInUp 0.15s ease',
  },
  selectedUserName: { color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--text-sm)', flex: 1 },
  selectedUserClear: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.1rem',
  },
  /* ─── Search dropdown ─── */
  searchDropdown: {
    background: 'var(--bg-primary)', border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius-md)', overflow: 'hidden',
    marginTop: '-0.5rem', marginBottom: '0.75rem',
    boxShadow: 'var(--shadow-sm)',
  },
  searchItem: (hovered) => ({
    display: 'flex', alignItems: 'center', gap: '0.65rem',
    padding: '0.6rem 0.75rem', cursor: 'pointer',
    background: hovered ? 'var(--bg-hover)' : 'transparent',
    transition: 'background 0.1s',
  }),
  searchItemName: { color: 'var(--text-primary)', fontWeight: 500, fontSize: 'var(--text-sm)' },
  /* ─── Chips ─── */
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.6rem' },
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
    padding: '0.2rem 0.5rem 0.2rem 0.25rem', borderRadius: '999px',
    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
    color: 'var(--accent-muted)', fontSize: 'var(--text-xs)', fontWeight: 500,
    animation: 'fadeInScale 0.15s ease',
  },
  chipX: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', fontSize: '0.8rem', padding: 0, lineHeight: 1,
    display: 'flex', alignItems: 'center',
  },
  /* ─── Room ─── */
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
  { key: 'dm',    label: 'Direct', Icon: DmIcon },
  { key: 'group', label: 'Group',  Icon: GroupIcon },
  { key: 'room',  label: 'Room',   Icon: RoomIcon },
];

/* ── UserSearchList — shared dropdown for both DM and Group/Room ──── */
function UserSearchList({ results, hoveredId, setHoveredId, onSelect }) {
  if (!results.length) return null;
  return (
    <div style={s.searchDropdown}>
      {results.map((u) => (
        <div
          key={u.id}
          style={s.searchItem(hoveredId === u.id)}
          onMouseEnter={() => setHoveredId(u.id)}
          onMouseLeave={() => setHoveredId(null)}
          onClick={() => onSelect(u)}
        >
          <UserAvatar username={u.username} size={28} />
          <span style={s.searchItemName}>{u.username}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────── */
export default function NewConversationModal({ currentUser, onClose, onCreated }) {
  const [tab, setTab] = useState('dm');
  const [disappearAfter, setDisappearAfter] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /* DM state */
  const [dmQuery, setDmQuery] = useState('');
  const [dmResults, setDmResults] = useState([]);
  const [dmSelected, setDmSelected] = useState(null);   // { id, username }
  const [dmHovered, setDmHovered] = useState(null);
  const dmSearchRef = useRef(null);

  /* Group / Room shared state */
  const [groupName, setGroupName] = useState('');
  const [members, setMembers] = useState([]);
  const [memberInput, setMemberInput] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [memberHovered, setMemberHovered] = useState(null);

  /* Room-only state */
  const [roomPassword, setRoomPassword] = useState('');
  const [allowGuests, setAllowGuests] = useState(true);
  const [maxParticipants, setMaxParticipants] = useState(50);
  const [expiresIn, setExpiresIn] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  /* ── DM live search ────────────────────────────────────────────── */
  useEffect(() => {
    if (dmSelected) { setDmResults([]); return; }
    const q = dmQuery.trim();
    if (!q) { setDmResults([]); return; }
    clearTimeout(dmSearchRef.current);
    dmSearchRef.current = setTimeout(async () => {
      try {
        const res = await searchUsers(q);
        setDmResults(res.filter((u) => u.id !== currentUser.id));
      } catch { setDmResults([]); }
    }, 200);
    return () => clearTimeout(dmSearchRef.current);
  }, [dmQuery, dmSelected, currentUser]);

  const selectDmUser = (u) => {
    setDmSelected(u);
    setDmQuery(u.username);
    setDmResults([]);
  };

  /* ── Group/Room member search ──────────────────────────────────── */
  const searchMember = useCallback(async (q) => {
    if (!q.trim()) { setMemberResults([]); return; }
    try {
      const res = await searchUsers(q.trim());
      setMemberResults(res.filter(
        (u) => u.id !== currentUser.id && !members.some((m) => m.id === u.id)
      ));
    } catch { setMemberResults([]); }
  }, [currentUser, members]);

  const addMember = (u) => {
    setMembers((prev) => [...prev, { id: u.id, username: u.username }]);
    setMemberInput('');
    setMemberResults([]);
  };
  const removeMember = (id) => setMembers((prev) => prev.filter((m) => m.id !== id));

  /* ── Reset on tab change ───────────────────────────────────────── */
  const switchTab = (key) => {
    setTab(key);
    setError('');
    setDmQuery(''); setDmSelected(null); setDmResults([]);
    setGroupName(''); setMembers([]); setMemberInput(''); setMemberResults([]);
    setInviteLink('');
  };

  /* ── Create ────────────────────────────────────────────────────── */
  const handleCreate = async () => {
    setError('');
    setLoading(true);
    try {
      const timerValue = disappearAfter ? parseInt(disappearAfter, 10) : null;

      if (tab === 'dm') {
        let target = dmSelected;
        if (!target) {
          if (!dmQuery.trim()) { setError('Search for a user first'); setLoading(false); return; }
          const users = await searchUsers(dmQuery.trim());
          target = users.find((u) => u.username.toLowerCase() === dmQuery.trim().toLowerCase());
          if (!target) { setError('Username not found'); setLoading(false); return; }
        }
        const conv = await createConversation('direct_message', [target.id], undefined, timerValue);
        onCreated(conv);
        onClose();
      } else if (tab === 'group') {
        if (!groupName.trim()) { setError('Enter a group name'); setLoading(false); return; }
        if (members.length < 1) { setError('Add at least one member'); setLoading(false); return; }
        const conv = await createConversation(
          'group_chat', members.map((m) => m.id), groupName.trim(), timerValue,
        );
        onCreated(conv);
        onClose();
      } else {
        // Room
        if (!groupName.trim()) { setError('Enter a room name'); setLoading(false); return; }
        const expiresMs = expiresIn ? parseInt(expiresIn, 10) : null;
        const conv = await createConversation(
          'group_chat', members.map((m) => m.id), groupName.trim(), timerValue,
          { inviteEnabled: true, allowGuests, password: roomPassword || undefined, maxParticipants, expiresIn: expiresMs },
        );
        if (conv.slug) setInviteLink(`${window.location.origin}/#/r/${conv.slug}`);
        onCreated(conv);
        if (!conv.slug) onClose();
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to create conversation');
    } finally {
      setLoading(false);
    }
  };

  /* ── Create-button label ───────────────────────────────────────── */
  const btnLabel = tab === 'room' ? 'Create Room' : tab === 'group' ? 'Create Group' : 'Open Chat';

  /* ── Render ────────────────────────────────────────────────────── */
  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.modal}>
        <h2 style={s.title}>New Conversation</h2>

        {/* Tab bar */}
        <div style={s.tabs}>
          {TABS.map(({ key, label, Icon }) => (
            <button key={key} style={s.tab(tab === key)} onClick={() => switchTab(key)}>
              <Icon />{label}
            </button>
          ))}
        </div>

        {/* ── DM tab ── */}
        {tab === 'dm' && (
          <>
            {dmSelected ? (
              <div style={s.selectedUserCard}>
                <UserAvatar username={dmSelected.username} size={36} />
                <span style={s.selectedUserName}>{dmSelected.username}</span>
                <button style={s.selectedUserClear} onClick={() => { setDmSelected(null); setDmQuery(''); }} title="Remove">×</button>
              </div>
            ) : (
              <>
                <label style={s.label}>Search for someone</label>
                <input
                  style={s.input}
                  type="text"
                  placeholder="Type a username…"
                  value={dmQuery}
                  autoFocus
                  onChange={(e) => setDmQuery(e.target.value)}
                />
                <UserSearchList
                  results={dmResults}
                  hoveredId={dmHovered}
                  setHoveredId={setDmHovered}
                  onSelect={selectDmUser}
                />
              </>
            )}
          </>
        )}

        {/* ── Group tab ── */}
        {tab === 'group' && (
          <>
            <label style={s.label}>Group Name</label>
            <input style={s.input} type="text" placeholder="My Group" autoFocus
              value={groupName} onChange={(e) => setGroupName(e.target.value)} />

            <label style={s.label}>
              Add Members
              {members.length > 0 && (
                <span style={{ color: 'var(--accent-muted)', marginLeft: '0.4rem', fontWeight: 400 }}>
                  ({members.length} added)
                </span>
              )}
            </label>
            {members.length > 0 && (
              <div style={s.chipRow}>
                {members.map((m) => (
                  <span key={m.id} style={s.chip}>
                    <UserAvatar username={m.username} size={16} />
                    {m.username}
                    <button style={s.chipX} onClick={() => removeMember(m.id)} title="Remove">×</button>
                  </span>
                ))}
              </div>
            )}
            <input style={s.input} type="text" placeholder="Search username…"
              value={memberInput}
              onChange={(e) => { setMemberInput(e.target.value); searchMember(e.target.value); }} />
            <UserSearchList
              results={memberResults}
              hoveredId={memberHovered}
              setHoveredId={setMemberHovered}
              onSelect={addMember}
            />
          </>
        )}

        {/* ── Room tab ── */}
        {tab === 'room' && (
          <>
            <label style={s.label}>Room Name</label>
            <input style={s.input} type="text" placeholder="Friday Hangout" autoFocus
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

            <label style={s.label}>
              Invite Members (optional)
              {members.length > 0 && (
                <span style={{ color: 'var(--accent-muted)', marginLeft: '0.4rem', fontWeight: 400 }}>
                  ({members.length} added)
                </span>
              )}
            </label>
            {members.length > 0 && (
              <div style={s.chipRow}>
                {members.map((m) => (
                  <span key={m.id} style={s.chip}>
                    <UserAvatar username={m.username} size={16} />
                    {m.username}
                    <button style={s.chipX} onClick={() => removeMember(m.id)} title="Remove">×</button>
                  </span>
                ))}
              </div>
            )}
            <input style={s.input} type="text" placeholder="Search username…"
              value={memberInput}
              onChange={(e) => { setMemberInput(e.target.value); searchMember(e.target.value); }} />
            <UserSearchList
              results={memberResults}
              hoveredId={memberHovered}
              setHoveredId={setMemberHovered}
              onSelect={addMember}
            />

            {inviteLink && (
              <div style={s.inviteBox}>
                <label style={s.label}>Invite Link</label>
                <div style={s.inviteLink}>{inviteLink}</div>
                <button style={s.copyBtn} onClick={() => navigator.clipboard.writeText(inviteLink)}>Copy Link</button>
              </div>
            )}
          </>
        )}

        {/* Common: auto-delete timer */}
        <label style={s.label}>Auto-delete Timer</label>
        <select style={s.select} value={disappearAfter} onChange={(e) => setDisappearAfter(e.target.value)}>
          {TIMER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {error && (
          <p style={s.error}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
          </p>
        )}

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose} disabled={loading}>Cancel</button>
          <button style={s.createBtn(loading)} onClick={handleCreate} disabled={loading}>
            {loading && <Spinner size={13} />}
            {loading ? 'Creating…' : btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
