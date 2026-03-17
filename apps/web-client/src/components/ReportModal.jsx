import { useState, useEffect } from 'react';
import { submitReport } from '../services/api.js';

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400,
  },
  modal: {
    background: '#1a1a1a', borderRadius: '12px', padding: '1.5rem',
    width: '100%', maxWidth: '400px', margin: '0 1rem',
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
  },
  title: { color: '#fff', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.75rem' },
  subtitle: { color: '#888', fontSize: '0.8rem', marginBottom: '1rem' },
  label: { display: 'block', color: '#aaa', fontSize: '0.85rem', marginBottom: '0.25rem' },
  select: {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px',
    border: '1px solid #333', background: '#0f0f0f', color: '#fff',
    fontSize: '0.9rem', marginBottom: '1rem', outline: 'none',
  },
  textarea: {
    width: '100%', padding: '0.5rem 0.75rem', borderRadius: '8px',
    border: '1px solid #333', background: '#0f0f0f', color: '#fff',
    fontSize: '0.9rem', marginBottom: '1rem', outline: 'none',
    minHeight: '80px', resize: 'vertical', fontFamily: 'inherit',
  },
  actions: {
    display: 'flex', gap: '0.5rem', justifyContent: 'flex-end',
    paddingTop: '0.5rem',
  },
  cancelBtn: {
    padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #333',
    background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '0.85rem',
  },
  submitBtn: {
    padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
    background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '0.85rem',
    fontWeight: 600,
  },
  error: { color: '#f87171', fontSize: '0.8rem', marginBottom: '0.5rem' },
  success: { color: '#4ade80', fontSize: '0.85rem', textAlign: 'center', padding: '1rem 0' },
};

const REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'illegal_content', label: 'Illegal content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other' },
];

/**
 * Modal to report a user or message.
 *
 * Props:
 *  - reportedUserId: string — ID of the user being reported
 *  - reportedUsername: string — display name of the user being reported
 *  - conversationId: string (optional)
 *  - messageId: string (optional) — if reporting a specific message
 *  - onClose: () => void
 */
export default function ReportModal({ reportedUserId, reportedUsername, conversationId, messageId, onClose }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!reason) {
      setError('Please select a reason');
      return;
    }

    setLoading(true);
    try {
      await submitReport(reportedUserId, reason, {
        conversationId,
        messageId,
        details: details.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to submit report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal}>
        <div style={s.title}>🚩 Report User</div>
        <div style={s.subtitle}>
          Reporting <strong style={{ color: '#fff' }}>{reportedUsername}</strong>
          {messageId ? ' for a specific message' : ''}
        </div>

        {submitted ? (
          <>
            <div style={s.success}>
              ✅ Report submitted. Our team will review it.
            </div>
            <div style={s.actions}>
              <button style={s.cancelBtn} onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div style={s.error}>{error}</div>}

            <label style={s.label}>Reason</label>
            <select
              style={s.select}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Select a reason…</option>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            <label style={s.label}>Additional details (optional)</label>
            <textarea
              style={s.textarea}
              placeholder="Describe the issue…"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
            />

            <div style={s.actions}>
              <button type="button" style={s.cancelBtn} onClick={onClose}>Cancel</button>
              <button
                type="submit"
                style={{ ...s.submitBtn, opacity: loading ? 0.6 : 1 }}
                disabled={loading}
              >
                {loading ? 'Submitting…' : 'Submit Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
