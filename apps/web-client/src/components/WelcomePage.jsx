import { useState, useEffect } from 'react';

/* ─── Inline SVG Icons ────────────────────────────────────────────── */
const ShieldCheck = ({ size = 20, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11.5 14.5 16 10" />
  </svg>
);

const Lock = ({ size = 20, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const Zap = ({ size = 20, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const HelpCircle = ({ size = 20, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const MessageCircle = ({ size = 20, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

/* ─── Component ───────────────────────────────────────────────────── */
export default function WelcomePage({ onLogin, onRegister, onShowTerms, onShowPrivacy, onShowHelp }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)',
      opacity: visible ? 1 : 0, transition: 'opacity 0.35s ease',
    }}>
      {/* ─── Top bar ─── */}
      <div style={{
        background: 'var(--accent)', padding: '0.6rem 1.5rem',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        flexShrink: 0,
      }}>
        <MessageCircle size={22} style={{ color: '#fff' }} />
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 'var(--text-lg)', letterSpacing: '-0.01em' }}>
          Blink Text
        </span>
      </div>

      {/* ─── Main content ─── */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem 1rem', overflowY: 'auto',
      }}>
        <div style={{
          width: '100%', maxWidth: '900px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem',
        }}>
          {/* ─── Hero card ─── */}
          <div className="animate-fadeInUp" style={{
            background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)',
            padding: '2.5rem 2rem', width: '100%', maxWidth: '460px',
            boxShadow: 'var(--shadow-md)', textAlign: 'center',
          }}>
            {/* Lock icon */}
            <div style={{
              width: '64px', height: '64px', borderRadius: '50%',
              background: 'var(--accent-bg)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.25rem', color: 'var(--accent)',
            }}>
              <Lock size={28} />
            </div>

            <h1 style={{
              fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text-primary)',
              marginBottom: '0.5rem', letterSpacing: '-0.02em',
            }}>
              Private messaging
            </h1>
            <p style={{
              color: 'var(--text-muted)', fontSize: 'var(--text-base)',
              lineHeight: 1.6, marginBottom: '1.75rem', maxWidth: '340px', margin: '0 auto 1.75rem',
            }}>
              End-to-end encrypted. The server never sees your messages, keys, or plaintext.
            </p>

            {/* CTA buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <button
                onClick={onRegister}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)',
                  border: 'none', background: 'var(--accent)', color: '#fff',
                  fontSize: 'var(--text-md)', fontWeight: 600, cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--accent)'}
              >
                Get Started
              </button>
              <button
                onClick={onLogin}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-light)', background: 'transparent',
                  color: 'var(--text-secondary)', fontSize: 'var(--text-md)',
                  fontWeight: 500, cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                Sign In
              </button>
            </div>
          </div>

          {/* ─── Feature pills ─── */}
          <div className="animate-fadeInUp" style={{
            display: 'flex', gap: '0.75rem', flexWrap: 'wrap',
            justifyContent: 'center', maxWidth: '500px',
            animationDelay: '0.1s', animationFillMode: 'both',
          }}>
            {[
              { icon: <ShieldCheck size={16} />, text: 'AES-256-GCM encryption' },
              { icon: <Zap size={16} />, text: 'Real-time delivery' },
              { icon: <Lock size={16} />, text: 'Zero-knowledge server' },
            ].map((f, i) => (
              <div key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-full)',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                color: 'var(--text-muted)', fontSize: 'var(--text-sm)',
              }}>
                <span style={{ color: 'var(--accent-muted)', display: 'flex' }}>{f.icon}</span>
                {f.text}
              </div>
            ))}
          </div>

          {/* ─── Info row ─── */}
          <div className="animate-fadeInUp" style={{
            display: 'flex', gap: '1.25rem', flexWrap: 'wrap',
            justifyContent: 'center', maxWidth: '600px',
            animationDelay: '0.2s', animationFillMode: 'both',
          }}>
            {[
              { title: 'No email required', desc: 'Just pick a username and password.' },
              { title: 'Open source', desc: 'Audit the code on GitHub anytime.' },
              { title: 'Self-hostable', desc: 'Run your own instance. Own your data.' },
            ].map((item, i) => (
              <div key={i} style={{
                flex: '1 1 160px', textAlign: 'center', padding: '0.5rem',
              }}>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-faint)', lineHeight: 1.5 }}>
                  {item.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Footer ─── */}
      <div style={{
        padding: '0.75rem 1.5rem', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '1.25rem', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {onShowHelp && (
          <span
            onClick={onShowHelp}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
              color: 'var(--text-faint)', fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-muted)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
          >
            <HelpCircle size={14} /> How to use
          </span>
        )}
        <span
          onClick={onShowTerms}
          style={{ color: 'var(--text-faint)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-muted)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
        >
          Terms
        </span>
        <span
          onClick={onShowPrivacy}
          style={{ color: 'var(--text-faint)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-muted)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
        >
          Privacy
        </span>
        <a
          href="https://github.com/Blink-deploy-in-a-blink/blink-text"
          target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--text-faint)', fontSize: 'var(--text-sm)', textDecoration: 'none' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--text-muted)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-faint)'}
        >
          GitHub
        </a>
      </div>
    </div>
  );
}
