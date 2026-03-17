import { useState } from 'react';

const styles = {
  container: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', background: '#0f0f0f',
  },
  card: {
    background: '#1a1a1a', padding: '2rem', borderRadius: '12px',
    width: '100%', maxWidth: '360px', margin: '0 1rem',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  title: { fontSize: '1.5rem', fontWeight: 700, marginBottom: '1.5rem', color: '#fff', textAlign: 'center' },
  label: { display: 'block', marginBottom: '0.25rem', color: '#aaa', fontSize: '0.875rem' },
  input: {
    width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px',
    border: '1px solid #333', background: '#0f0f0f', color: '#fff',
    fontSize: '16px', marginBottom: '1rem', outline: 'none',
  },
  btn: {
    width: '100%', padding: '0.7rem', borderRadius: '8px', border: 'none',
    background: '#6366f1', color: '#fff', fontSize: '1rem', cursor: 'pointer',
    fontWeight: 600, marginTop: '0.5rem',
  },
  btnDisabled: {
    width: '100%', padding: '0.7rem', borderRadius: '8px', border: 'none',
    background: '#4b4b6b', color: '#888', fontSize: '1rem', cursor: 'not-allowed',
    fontWeight: 600, marginTop: '0.5rem',
  },
  error: { color: '#f87171', marginBottom: '0.75rem', fontSize: '0.875rem', textAlign: 'center' },
  link: { color: '#818cf8', cursor: 'pointer', textDecoration: 'underline' },
  footer: { marginTop: '1rem', textAlign: 'center', color: '#666', fontSize: '0.85rem' },
  hint: { color: '#555', fontSize: '0.75rem', marginTop: '-0.75rem', marginBottom: '1rem' },
  tosRow: {
    display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
    marginBottom: '1rem', marginTop: '0.25rem',
  },
  tosCheckbox: {
    marginTop: '3px', accentColor: '#6366f1', width: '16px', height: '16px', flexShrink: 0,
  },
  tosLabel: { color: '#aaa', fontSize: '0.8rem', lineHeight: '1.4' },
  tosLink: { color: '#818cf8', textDecoration: 'underline', cursor: 'pointer' },
  powStatus: {
    textAlign: 'center', color: '#a5b4fc', fontSize: '0.8rem',
    marginTop: '0.5rem', minHeight: '1.2em',
  },
};

export default function Register({ onRegister, onSwitchToLogin, onShowTerms, onShowPrivacy }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [powStatus, setPowStatus] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!acceptedTerms) {
      setError('You must accept the Terms of Service and Privacy Policy');
      return;
    }

    setLoading(true);
    setPowStatus('');
    try {
      await onRegister(username, password, {
        acceptedTerms: true,
        onPoWStatus: setPowStatus,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setPowStatus('');
    }
  };

  const canSubmit = username.length >= 3 && password.length >= 8 && confirm === password && acceptedTerms && !loading;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>🔐 Create Account</h1>
        <form onSubmit={handleSubmit}>
          {error && <p style={styles.error}>{error}</p>}
          <label style={styles.label}>Username</label>
          <input
            style={styles.input}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9_]+"
            disabled={loading}
          />
          <p style={styles.hint}>3–32 characters, letters / numbers / underscores</p>
          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            disabled={loading}
          />
          <label style={styles.label}>Confirm Password</label>
          <input
            style={styles.input}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            disabled={loading}
          />
          <div style={styles.tosRow}>
            <input
              type="checkbox"
              id="tos-checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              style={styles.tosCheckbox}
              disabled={loading}
            />
            <label htmlFor="tos-checkbox" style={styles.tosLabel}>
              I agree to the{' '}
              <span style={styles.tosLink} onClick={(e) => { e.preventDefault(); onShowTerms?.(); }}>
                Terms of Service
              </span>{' '}
              and{' '}
              <span style={styles.tosLink} onClick={(e) => { e.preventDefault(); onShowPrivacy?.(); }}>
                Privacy Policy
              </span>
            </label>
          </div>
          <button
            style={canSubmit ? styles.btn : styles.btnDisabled}
            type="submit"
            disabled={!canSubmit}
          >
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
          {powStatus && <p style={styles.powStatus}>{powStatus}</p>}
        </form>
        <p style={styles.footer}>
          Already registered?{' '}
          <span style={styles.link} onClick={onSwitchToLogin}>
            Sign In
          </span>
        </p>
      </div>
    </div>
  );
}
