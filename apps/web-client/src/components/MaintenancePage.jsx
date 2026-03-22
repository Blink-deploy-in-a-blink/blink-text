const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    padding: '2rem',
    textAlign: 'center',
  },
  icon: {
    fontSize: '3rem',
    marginBottom: '1.5rem',
    opacity: 0.9,
  },
  wordmark: {
    fontSize: 'var(--text-2xl)',
    fontWeight: 700,
    color: 'var(--accent)',
    letterSpacing: '-0.02em',
    marginBottom: '2rem',
  },
  card: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-xl)',
    padding: '2rem 2.5rem',
    maxWidth: '420px',
    width: '100%',
    boxShadow: 'var(--shadow-md)',
  },
  title: {
    fontSize: 'var(--text-xl)',
    fontWeight: 600,
    color: 'var(--text-primary)',
    marginBottom: '0.75rem',
  },
  message: {
    fontSize: 'var(--text-base)',
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    marginBottom: '1.5rem',
  },
  divider: {
    height: '1px',
    background: 'var(--border)',
    margin: '1.5rem 0',
  },
  footer: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },
};

export default function MaintenancePage() {
  return (
    <div style={styles.container}>
      <div style={styles.wordmark}>Cypher</div>
      <div style={styles.card}>
        <div style={styles.icon}>🔧</div>
        <div style={styles.title}>Under Maintenance</div>
        <p style={styles.message}>
          We're performing scheduled maintenance to improve your experience.
          The service will be back shortly.
        </p>
        <div style={styles.divider} />
        <div style={styles.footer}>
          Thank you for your patience.
        </div>
      </div>
    </div>
  );
}
