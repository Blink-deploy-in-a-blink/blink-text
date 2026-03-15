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
  error: { color: '#f87171', marginBottom: '0.75rem', fontSize: '0.875rem', textAlign: 'center' },
  link: { color: '#818cf8', cursor: 'pointer', textDecoration: 'underline' },
  footer: { marginTop: '1rem', textAlign: 'center', color: '#666', fontSize: '0.85rem' },
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
        <h1 style={styles.title}>🔐 Blink Text</h1>
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
