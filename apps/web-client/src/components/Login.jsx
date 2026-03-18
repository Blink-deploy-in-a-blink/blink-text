import { useState } from 'react';

const styles = {
  container: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', background: 'var(--bg-primary)',
  },
  card: {
    background: 'var(--bg-elevated)', padding: '2rem', borderRadius: 'var(--radius-lg)',
    width: '100%', maxWidth: '380px', margin: '0 1rem',
    boxShadow: 'var(--shadow-md)',
  },
  title: { fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: '1.5rem', color: 'var(--text-primary)', textAlign: 'center', letterSpacing: '-0.02em' },
  label: { display: 'block', marginBottom: '0.3rem', color: 'var(--text-muted)', fontSize: 'var(--text-sm)', fontWeight: 500 },
  input: {
    width: '100%', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-light)', background: 'var(--bg-secondary)', color: 'var(--text-primary)',
    fontSize: '16px', marginBottom: '1rem',
  },
  btn: {
    width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)', border: 'none',
    background: 'var(--accent)', color: '#fff', fontSize: 'var(--text-md)', cursor: 'pointer',
    fontWeight: 600, marginTop: '0.5rem',
  },
  error: { color: 'var(--danger-muted)', marginBottom: '0.75rem', fontSize: 'var(--text-sm)', textAlign: 'center' },
  link: { color: 'var(--accent-muted)', cursor: 'pointer', textDecoration: 'underline' },
  footer: { marginTop: '1rem', textAlign: 'center', color: 'var(--text-faint)', fontSize: 'var(--text-sm)' },
};

export default function Login({ onLogin, onSwitchToRegister }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Sign In</h1>
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
          />
          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button style={styles.btn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <p style={styles.footer}>
          No account?{' '}
          <span style={styles.link} onClick={onSwitchToRegister}>
            Register
          </span>
        </p>
      </div>
    </div>
  );
}
