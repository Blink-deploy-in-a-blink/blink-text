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

export default function TermsOfService({ onBack }) {
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <span style={styles.back} onClick={onBack}>← Back to registration</span>
        <h1 style={styles.title}>Terms of Service</h1>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>1. Acceptance of Terms</h2>
          <p>
            By creating an account or using Blink-Text ("the Service"), you agree to be bound by these
            Terms of Service. If you do not agree, do not use the Service.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>2. Description of Service</h2>
          <p>
            Blink-Text is an end-to-end encrypted messaging platform. Messages are encrypted on your device
            and the server acts only as a relay. We cannot read your messages and do not store plaintext content.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>3. Account Responsibilities</h2>
          <p>
            You are responsible for maintaining the security of your account credentials. You must not share
            your password or allow others to access your account. You must provide accurate information during
            registration.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>4. Acceptable Use</h2>
          <p>You agree not to use the Service to:</p>
          <ul style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
            <li>Transmit any content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable</li>
            <li>Distribute child sexual abuse material (CSAM) or any content exploiting minors</li>
            <li>Engage in spam, phishing, or automated abuse of the Service</li>
            <li>Attempt to circumvent security measures or interfere with the Service's operation</li>
            <li>Impersonate any person or entity</li>
            <li>Violate any applicable local, state, national, or international law</li>
          </ul>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>5. Content & Encryption</h2>
          <p>
            All message content is end-to-end encrypted. We cannot access, moderate, or recover your messages.
            You are solely responsible for the content you transmit. If reported by other users, metadata
            (such as user IDs and timestamps) may be reviewed by administrators.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>6. Termination</h2>
          <p>
            We reserve the right to suspend or terminate accounts that violate these Terms, including but not
            limited to accounts reported for illegal activity. You may delete your account at any time through
            the application settings.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>7. Disclaimer of Warranties</h2>
          <p>
            The Service is provided "as is" without warranties of any kind, express or implied. We do not
            guarantee uninterrupted or error-free operation. Use of the Service is at your own risk.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>8. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, Blink-Text shall not be liable for any indirect, incidental,
            special, or consequential damages arising from your use of the Service.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>9. Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. Continued use of the Service after changes constitutes
            acceptance of the updated Terms. We will notify users of material changes.
          </p>
        </div>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>10. Contact</h2>
          <p>
            If you have questions about these Terms, please contact the project maintainers through the
            official repository.
          </p>
        </div>

        <p style={{ color: '#666', fontSize: '0.8rem', marginTop: '1.5rem' }}>
          Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>
    </div>
  );
}
