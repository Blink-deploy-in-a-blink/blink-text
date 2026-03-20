import { useState, useEffect } from 'react';
import { getConversationBySlug } from '../services/api.js';
import { saveGuestSession, connectGuestSocket } from '../services/guestSession.js';
import { solvePoW } from '../services/powService.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

const s = {
  wrapper: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg-primary)', padding: '1rem',
  },
  card: {
    background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '2rem',
    width: '100%', maxWidth: '420px', boxShadow: 'var(--shadow-lg)', textAlign: 'center',
  },
  title: { color: 'var(--text-primary)', fontWeight: 700, fontSize: 'var(--text-xl)', marginBottom: '0.25rem' },
  subtitle: { color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: '1.5rem' },
  meta: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginBottom: '1rem' },
  label: { display: 'block', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', marginBottom: '0.25rem', fontWeight: 500, textAlign: 'left' },
  input: {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-light)', background: 'var(--bg-primary)', color: 'var(--text-primary)',
    fontSize: 'var(--text-md)', marginBottom: '0.75rem', boxSizing: 'border-box',
  },
  btn: {
    width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: 'none',
    background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontWeight: 600,
    fontSize: 'var(--text-md)', marginTop: '0.5rem',
  },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  error: { color: 'var(--danger-muted)', fontSize: 'var(--text-sm)', marginBottom: '0.5rem' },
  progress: { color: 'var(--text-muted)', fontSize: 'var(--text-xs)', marginTop: '0.5rem' },
  spinner: {
    display: 'inline-block', width: '16px', height: '16px',
    border: '2px solid #fff', borderTopColor: 'transparent',
    borderRadius: '50%', animation: 'spin 0.6s linear infinite', marginRight: '0.4rem', verticalAlign: 'middle',
  },
  expired: { color: 'var(--danger-muted)', fontWeight: 600, fontSize: 'var(--text-md)' },
  link: { color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 },
};

export default function JoinRoomPage({ slug, onJoined }) {
  const [room, setRoom] = useState(null);
  const [fetchError, setFetchError] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | solving | joining | done
  const [powProgress, setPowProgress] = useState(0);

  /* Fetch room info */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getConversationBySlug(slug);
        if (!cancelled) setRoom(data.room);
      } catch (err) {
        if (!cancelled) {
          const status = err.response?.status;
          if (status === 404) setFetchError('Room not found');
          else if (status === 410) setFetchError('This room has expired');
          else if (status === 403) setFetchError('This room is not accepting invites');
          else setFetchError(err.response?.data?.error || 'Failed to load room');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const handleJoin = async () => {
    setError('');
    if (!displayName.trim()) { setError('Please enter a display name'); return; }
    if (room?.hasPassword && !password) { setError('Room requires a password'); return; }

    try {
      // Step 1: Get PoW challenge
      setPhase('solving');
      setPowProgress(0);
      const challengeRes = await fetch(`${API_BASE}/api/conversations/join/${slug}/challenge`);
      if (!challengeRes.ok) {
        const body = await challengeRes.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to get challenge');
      }
      const { challenge, difficulty } = await challengeRes.json();

      // Step 2: Solve PoW
      const { nonce } = await solvePoW(challenge, difficulty, (iters) => {
        setPowProgress(iters);
      });

      // Step 3: Join
      setPhase('joining');
      const joinRes = await fetch(`${API_BASE}/api/conversations/join/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          powChallenge: challenge,
          powNonce: nonce,
          password: password || undefined,
        }),
      });
      if (!joinRes.ok) {
        const body = await joinRes.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to join room');
      }

      const data = await joinRes.json();
      // { token, guestSessionId, conversationId, conversationName, expiresAt }

      // Save guest session
      saveGuestSession({
        token: data.token,
        guestSessionId: data.guestSessionId,
        conversationId: data.conversationId,
        conversationName: data.conversationName,
        expiresAt: data.expiresAt,
      });

      // Connect guest socket
      connectGuestSocket();

      setPhase('done');
      onJoined(data);
    } catch (err) {
      setError(err.message || 'Join failed');
      setPhase('idle');
    }
  };

  /* --- loading state --- */
  if (fetchError) {
    return (
      <div style={s.wrapper}>
        <div style={s.card}>
          <p style={s.expired}>{fetchError}</p>
          <p style={{ marginTop: '1rem' }}>
            <a href="/#/" style={s.link}>Back to Blink</a>
          </p>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div style={s.wrapper}>
        <div style={s.card}>
          <p style={s.subtitle}>Loading room...</p>
        </div>
      </div>
    );
  }

  const isFull = room.participantCount >= room.maxParticipants;
  const isExpired = room.expiresAt && room.expiresAt <= Date.now();

  if (isExpired) {
    return (
      <div style={s.wrapper}>
        <div style={s.card}>
          <p style={s.expired}>This room has expired</p>
          <p style={{ marginTop: '1rem' }}>
            <a href="/#/" style={s.link}>Back to Blink</a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrapper}>
      <div style={s.card}>
        <h1 style={s.title}>{room.name}</h1>
        <p style={s.subtitle}>You have been invited to join this room</p>

        <p style={s.meta}>
          {room.participantCount}/{room.maxParticipants} participants
          {room.expiresAt && <> &middot; Expires {new Date(room.expiresAt).toLocaleString()}</>}
        </p>

        {isFull ? (
          <p style={s.expired}>Room is full</p>
        ) : (
          <>
            <label style={s.label}>Display Name</label>
            <input style={s.input} type="text" placeholder="Your name"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              disabled={phase !== 'idle'} maxLength={32} />

            {room.hasPassword && (
              <>
                <label style={s.label}>Room Password</label>
                <input style={s.input} type="password" placeholder="Enter password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  disabled={phase !== 'idle'} />
              </>
            )}

            {error && <p style={s.error}>{error}</p>}

            <button
              style={{ ...s.btn, ...(phase !== 'idle' ? s.btnDisabled : {}) }}
              onClick={handleJoin}
              disabled={phase !== 'idle'}
            >
              {phase === 'solving' && <><span style={s.spinner} /> Solving puzzle...</>}
              {phase === 'joining' && <><span style={s.spinner} /> Joining...</>}
              {phase === 'done' && 'Joined!'}
              {phase === 'idle' && 'Join Room'}
            </button>

            {phase === 'solving' && powProgress > 0 && (
              <p style={s.progress}>{powProgress.toLocaleString()} hashes computed...</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
