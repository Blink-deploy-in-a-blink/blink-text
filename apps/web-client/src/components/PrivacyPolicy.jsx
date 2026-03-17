const styles = {
  container: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    minHeight: '100%', background: '#0f0f0f', padding: '2rem 1rem',
    overflowY: 'auto',
  },
  card: {
    background: '#1a1a1a', padding: '2rem', borderRadius: '12px',
    width: '100%', maxWidth: '640px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    color: '#ccc', fontSize: '0.9rem', lineHeight: '1.7',
  },
  title: { fontSize: '1.5rem', fontWeight: 700, color: '#fff', marginBottom: '1.5rem' },
  section: { marginBottom: '1.25rem' },
  sectionTitle: { fontSize: '1.05rem', fontWeight: 600, color: '#e5e5e5', marginBottom: '0.5rem' },
  back: {
    display: 'inline-block', color: '#818cf8', cursor: 'pointer',
    textDecoration: 'underline', marginBottom: '1rem', fontSize: '0.9rem',
  },
};

export default function PrivacyPolicy({ onBack }) {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <span style={styles.back} onClick={onBack}>← Back to registration</span>
        <h1 style={styles.title}>Privacy Policy</h1>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>1. Overview</h2>
          <p>
            Blink-Text is designed with privacy as a core principle. We use end-to-end encryption so that
            only you and the people you communicate with can read your messages. This policy explains what
            data we collect, how we use it, and your rights.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>2. Data We Collect</h2>
          <p><strong>Account Data:</strong> Username and hashed password (bcrypt). We never store your password in plaintext.</p>
          <p><strong>Device Data:</strong> Public encryption keys for your devices (used to establish encrypted sessions).</p>
          <p><strong>Message Metadata:</strong> Sender ID, conversation ID, timestamps, and encrypted message payloads. We cannot decrypt message content.</p>
          <p><strong>Technical Data:</strong> IP address at registration (for abuse prevention only), basic server logs.</p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>3. Data We Do NOT Collect</h2>
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
            <li>Plaintext message content (impossible due to end-to-end encryption)</li>
            <li>Private encryption keys</li>
            <li>Contact lists or phone numbers</li>
            <li>Location data</li>
            <li>Analytics or tracking data</li>
            <li>Advertising identifiers</li>
          </ul>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>4. How We Use Your Data</h2>
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
            <li>Authenticate you and manage your account</li>
            <li>Deliver encrypted messages to the intended recipients</li>
            <li>Prevent abuse and enforce our Terms of Service</li>
            <li>Respond to valid legal requests as required by law</li>
          </ul>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>5. Encryption</h2>
          <p>
            All messages are encrypted using ECDH P-256 key exchange with HKDF-SHA-256 key derivation
            and AES-GCM symmetric encryption. Encryption and decryption happen exclusively on your device.
            The server never has access to your private keys or decrypted messages.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>6. Data Sharing</h2>
          <p>
            We do not sell, rent, or share your data with third parties. We may disclose account metadata
            (not message content, which we cannot access) only in response to valid legal process, such as
            a court order.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>7. Data Retention</h2>
          <p>
            Encrypted messages are stored on the server until they are delivered or until you delete them.
            Account data is retained until you delete your account. When you delete your account, your
            data is permanently removed from our servers.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>8. Your Rights</h2>
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
            <li>Delete your account and all associated data at any time</li>
            <li>Delete individual messages</li>
            <li>Export is not applicable — all encrypted data is only readable on your devices</li>
          </ul>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>9. Security</h2>
          <p>
            We implement industry-standard security measures including encrypted connections (TLS),
            rate limiting, proof-of-work anti-spam protections, and secure password hashing. However,
            no system is completely secure, and we cannot guarantee absolute security.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify users of material changes.
            Continued use of the Service after changes constitutes acceptance.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>11. Contact</h2>
          <p>
            If you have questions about this Privacy Policy, please contact the project maintainers
            through the official repository.
          </p>
        </div>

        <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '1.5rem' }}>
          Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>
    </div>
  );
}
