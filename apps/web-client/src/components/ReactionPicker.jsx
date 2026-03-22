const EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

export default function ReactionPicker({ onSelect, onClose }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-light)',
        borderRadius: 24,
        padding: '4px 8px',
        boxShadow: 'var(--shadow-lg)',
        userSelect: 'none',
      }}
    >
      {EMOJI.map((e) => (
        <button
          key={e}
          onClick={() => { onSelect(e); onClose(); }}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 20,
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: 8,
            lineHeight: 1,
            transition: 'transform 0.1s',
          }}
          onMouseEnter={(ev) => (ev.currentTarget.style.transform = 'scale(1.35)')}
          onMouseLeave={(ev) => (ev.currentTarget.style.transform = 'scale(1)')}
          title={e}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
