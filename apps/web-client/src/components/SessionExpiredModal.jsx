import { useEffect, useRef } from 'react';

/* ── SVG Icons ── */
const ShieldAlertIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #6366f1)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const DeviceIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 99999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    animation: 'fadeIn 0.2s ease',
  },
  card: {
    background: 'var(--bg-secondary, #141414)',
    border: '1px solid var(--border, #232323)',
    borderRadius: 'var(--radius-xl, 16px)',
    padding: '40px 32px 32px',
    maxWidth: '400px',
    width: '90%',
    textAlign: 'center',
    animation: 'fadeInScale 0.3s ease',
    boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4)',
  },
  iconWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: 'rgba(99, 102, 241, 0.1)',
    marginBottom: '20px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    color: 'var(--text-primary, #fff)',
    margin: '0 0 8px 0',
    letterSpacing: '-0.02em',
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-secondary, #aaa)',
    lineHeight: 1.6,
    margin: '0 0 24px 0',
  },
  infoBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: 'rgba(99, 102, 241, 0.06)',
    border: '1px solid rgba(99, 102, 241, 0.15)',
    borderRadius: 'var(--radius-md, 10px)',
    padding: '12px 16px',
    marginBottom: '24px',
    textAlign: 'left',
  },
  infoText: {
    fontSize: '13px',
    color: 'var(--text-secondary, #aaa)',
    lineHeight: 1.5,
    margin: 0,
  },
  button: {
    width: '100%',
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#fff',
    background: 'var(--accent, #6366f1)',
    border: 'none',
    borderRadius: 'var(--radius-md, 10px)',
    cursor: 'pointer',
    transition: 'background 0.15s ease, transform 0.1s ease',
    letterSpacing: '-0.01em',
  },
  buttonHover: {
    background: 'var(--accent-hover, #5558e6)',
  },
  footer: {
    fontSize: '12px',
    color: 'var(--text-muted, #555)',
    marginTop: '16px',
    lineHeight: 1.5,
  },
};

/**
 * Modal shown when the user's session is invalidated because they signed in
 * on another device. Only action is "Sign In Again" which reloads the page.
 */
export default function SessionExpiredModal() {
  const buttonRef = useRef(null);
  const hoverRef = useRef(false);

  // Auto-focus the button for keyboard accessibility
  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  const handleSignIn = () => {
    window.location.reload();
  };

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Session expired">
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <ShieldAlertIcon />
        </div>

        <h2 style={styles.title}>Signed out</h2>
        <p style={styles.subtitle}>
          Your account was signed in on another device or browser.
          For security, only one active session is allowed at a time.
        </p>

        <div style={styles.infoBox}>
          <DeviceIcon />
          <p style={styles.infoText}>
            Your messages and encryption keys are safe. Sign in again to continue where you left off.
          </p>
        </div>

        <button
          ref={buttonRef}
          style={{
            ...styles.button,
            ...(hoverRef.current ? styles.buttonHover : {}),
          }}
          onClick={handleSignIn}
          onMouseEnter={() => { hoverRef.current = true; buttonRef.current.style.background = 'var(--accent-hover, #5558e6)'; }}
          onMouseLeave={() => { hoverRef.current = false; buttonRef.current.style.background = 'var(--accent, #6366f1)'; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.98)'; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          Sign In Again
        </button>

        <p style={styles.footer}>
          This happens when you log in from a new device.
          Multi-device support is coming soon.
        </p>
      </div>
    </div>
  );
}
