import { useState, useEffect } from 'react';

/* ─── SVG Icons ───────────────────────────────────────────────────── */
const ArrowLeft = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
  </svg>
);

const s = {
  page: {
    display: 'flex', flexDirection: 'column', height: '100%',
    background: 'var(--bg-primary)', color: 'var(--text-secondary)',
  },
  header: {
    padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border)',
    background: 'var(--bg-surface)', display: 'flex', alignItems: 'center',
    gap: '0.75rem', flexShrink: 0,
  },
  backBtn: {
    background: 'transparent', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0.3rem',
    borderRadius: 'var(--radius-sm)',
  },
  title: {
    fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text-primary)',
  },
  content: {
    flex: 1, overflowY: 'auto', padding: '1.5rem',
    maxWidth: '700px', margin: '0 auto', width: '100%',
  },
  section: {
    marginBottom: '2rem',
  },
  h2: {
    fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)',
    marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
  },
  h3: {
    fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text-primary)',
    marginBottom: '0.4rem', marginTop: '1rem',
  },
  p: {
    fontSize: 'var(--text-base)', lineHeight: 1.7, color: 'var(--text-muted)',
    marginBottom: '0.5rem',
  },
  ul: {
    paddingLeft: '1.25rem', marginBottom: '0.75rem',
  },
  li: {
    fontSize: 'var(--text-base)', lineHeight: 1.7, color: 'var(--text-muted)',
    marginBottom: '0.25rem',
  },
  kbd: {
    display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '4px',
    background: 'var(--bg-surface)', border: '1px solid var(--border-light)',
    fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)',
    color: 'var(--text-secondary)',
  },
  card: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '0.75rem',
  },
  faqQ: {
    fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)',
    cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between',
  },
  faqA: {
    fontSize: 'var(--text-base)', lineHeight: 1.7, color: 'var(--text-muted)',
    marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)',
  },
};

function FAQItem({ question, answer }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={s.card}>
      <div style={s.faqQ} onClick={() => setOpen(!open)}>
        <span>{question}</span>
        <span style={{ color: 'var(--text-faint)', fontSize: 'var(--text-sm)', flexShrink: 0 }}>
          {open ? '▲' : '▼'}
        </span>
      </div>
      {open && <div style={s.faqA}>{answer}</div>}
    </div>
  );
}

export default function HelpPage({ onBack }) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onBack?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div style={s.page}>
      <div style={s.header}>
        <button style={s.backBtn} onClick={onBack} title="Back">
          <ArrowLeft />
        </button>
        <span style={s.title}>Help & How to Use</span>
      </div>

      <div style={s.content}>
        {/* Getting started */}
        <div style={s.section}>
          <h2 style={s.h2}>Getting Started</h2>
          <p style={s.p}>
            Blink Text is an end-to-end encrypted messenger. Everything you send is encrypted on your device
            before it reaches the server — not even the server operator can read your messages.
          </p>

          <h3 style={s.h3}>1. Create an account</h3>
          <p style={s.p}>
            Click <strong>Get Started</strong> and pick a username (3–32 characters) and password (minimum 8 characters).
            No email or phone number is required. You'll need to solve a quick security puzzle (takes a few seconds)
            and accept the Terms of Service.
          </p>

          <h3 style={s.h3}>2. Start a conversation</h3>
          <p style={s.p}>
            Click the <strong>+ New</strong> button in the sidebar. Type the exact username of the person you want to
            message and click <strong>Create</strong>. Encryption keys are exchanged automatically — you can start
            messaging immediately.
          </p>

          <h3 style={s.h3}>3. Send messages</h3>
          <p style={s.p}>
            Type in the message box and press <span style={s.kbd}>Enter</span> to send. Use <span style={s.kbd}>Shift+Enter</span> for
            a new line. Messages are encrypted on your device and decrypted on the recipient's device.
          </p>
        </div>

        {/* Features */}
        <div style={s.section}>
          <h2 style={s.h2}>Features</h2>

          <h3 style={s.h3}>Media sharing</h3>
          <p style={s.p}>
            Click the 📎 button to attach an image or video. Files are encrypted before upload.
            Click an image in chat to open the full-screen preview with zoom.
          </p>

          <h3 style={s.h3}>Voice notes</h3>
          <p style={s.p}>
            Click the microphone button (appears when the message box is empty) to record a voice note.
            Click the stop button to send it.
          </p>

          <h3 style={s.h3}>Reply & Forward</h3>
          <p style={s.p}>
            Hover over a message and click the <strong>⋮</strong> menu to reply, forward, edit, or delete.
            On mobile, long-press a message to open the menu.
          </p>
          <ul style={s.ul}>
            <li style={s.li}><strong>Reply</strong> — quotes the original message in your reply</li>
            <li style={s.li}><strong>Forward</strong> — send a message to another conversation</li>
            <li style={s.li}><strong>Edit</strong> — edit your own text messages (re-encrypted)</li>
            <li style={s.li}><strong>Delete for me</strong> — hides the message on your device only</li>
            <li style={s.li}><strong>Delete for everyone</strong> — removes for all participants (your messages only)</li>
          </ul>

          <h3 style={s.h3}>Account management</h3>
          <p style={s.p}>
            Click your username at the bottom of the sidebar to change your password or delete your account.
          </p>
        </div>

        {/* How encryption works */}
        <div style={s.section}>
          <h2 style={s.h2}>How Encryption Works</h2>
          <p style={s.p}>
            When you start a conversation, your device generates a unique encryption key pair using
            <strong> ECDH P-256</strong>. The public half is shared via the server; the private half never leaves
            your browser. Both devices derive a shared secret using <strong>HKDF-SHA-256</strong>, which becomes
            the <strong>AES-256-GCM</strong> key for that conversation.
          </p>
          <p style={s.p}>
            Every message gets a fresh random IV (initialization vector). The server only sees ciphertext — it
            cannot decrypt anything. Your encryption keys are stored in your browser's localStorage.
          </p>
          <div style={{ ...s.card, background: 'var(--accent-bg)', borderColor: 'rgba(99,102,241,0.2)' }}>
            <p style={{ ...s.p, color: 'var(--accent-muted)', marginBottom: 0 }}>
              ⚠️ If you clear your browser data or switch devices, you'll need to re-establish encryption keys
              with your contacts. Your old messages from the new device won't be decryptable.
            </p>
          </div>
        </div>

        {/* Reporting */}
        <div style={s.section}>
          <h2 style={s.h2}>Reporting Users</h2>
          <p style={s.p}>
            If someone is sending spam, harassment, or illegal content, hover over their message, click <strong>⋮</strong>,
            and select <strong>Report</strong>. Choose a reason and optionally add details. Reports are reviewed by
            the platform administrator.
          </p>
        </div>

        {/* FAQ */}
        <div style={s.section}>
          <h2 style={s.h2}>FAQ</h2>
          <FAQItem
            question="Can the server read my messages?"
            answer="No. All encryption and decryption happens in your browser. The server only relays encrypted data (ciphertext + IV). It never sees your private keys or plaintext."
          />
          <FAQItem
            question="What happens if I forget my password?"
            answer="There is no password recovery mechanism — we don't store email or phone. If you forget your password, you'll need to create a new account."
          />
          <FAQItem
            question="Can I use Blink Text on multiple devices?"
            answer="You can log in from multiple browsers. Each device generates its own encryption keys. You'll need to re-establish key exchange with your contacts from each new device."
          />
          <FAQItem
            question="Are group chats supported?"
            answer="Not yet. The current encryption (ECDH P-256) supports two-party key exchange only. Group E2E encryption is on the roadmap."
          />
          <FAQItem
            question="Is this open source?"
            answer="Yes — fully open source under the MIT license. You can audit the code, self-host, or contribute on GitHub."
          />
          <FAQItem
            question="What data does the server store?"
            answer="Encrypted message payloads (ciphertext + IV), public keys, bcrypt password hashes, and basic account metadata (username, registration timestamp, IP for abuse prevention). Never plaintext messages or private keys."
          />
        </div>
      </div>
    </div>
  );
}
