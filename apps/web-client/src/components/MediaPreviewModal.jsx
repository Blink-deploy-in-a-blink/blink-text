import { useEffect, useState, useCallback } from 'react';

const s = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 500,
    background: 'rgba(0,0,0,0.92)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
  },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0.75rem 1rem',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)',
    zIndex: 510,
  },
  fileName: {
    color: '#ccc', fontSize: '0.85rem', fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    flex: 1, marginRight: '0.5rem',
  },
  topActions: {
    display: 'flex', gap: '0.5rem', flexShrink: 0,
  },
  iconBtn: {
    background: 'rgba(255,255,255,0.1)', border: 'none',
    color: '#fff', fontSize: '1.2rem', cursor: 'pointer',
    borderRadius: '50%', width: '36px', height: '36px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.15s',
  },
  mediaContainer: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', height: '100%',
    overflow: 'hidden', position: 'relative',
    cursor: 'default',
  },
  image: {
    maxWidth: '90vw', maxHeight: '85vh',
    objectFit: 'contain',
    borderRadius: '4px',
    transition: 'transform 0.2s ease',
    userSelect: 'none',
    WebkitUserDrag: 'none',
  },
  video: {
    maxWidth: '90vw', maxHeight: '85vh',
    objectFit: 'contain',
    borderRadius: '4px',
    outline: 'none',
  },
  zoomHint: {
    position: 'absolute', bottom: '1rem',
    color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem',
    pointerEvents: 'none',
  },
};

/**
 * Full-screen media preview modal.
 * Supports images (with zoom in/out) and videos (with native controls).
 *
 * Props:
 *  - objectUrl: string — the blob URL of the decrypted media
 *  - mimeType: string — e.g. 'image/png', 'video/mp4'
 *  - fileName: string — original file name
 *  - messageType: 'image' | 'video'
 *  - onClose: () => void
 *  - onDownload: () => void — trigger save-to-device
 */
export default function MediaPreviewModal({ objectUrl, mimeType, fileName, messageType, onClose, onDownload }) {
  const [zoom, setZoom] = useState(1);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.5, 5)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.5, 0.5)), []);
  const handleResetZoom = useCallback(() => setZoom(1), []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') handleZoomIn();
      if (e.key === '-') handleZoomOut();
      if (e.key === '0') handleResetZoom();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, handleZoomIn, handleZoomOut, handleResetZoom]);

  // Mouse wheel zoom for images
  const handleWheel = useCallback((e) => {
    if (messageType !== 'image') return;
    e.preventDefault();
    setZoom((z) => {
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      return Math.max(0.5, Math.min(z + delta, 5));
    });
  }, [messageType]);

  // Click backdrop to close (but not when clicking media itself)
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!objectUrl) return null;

  return (
    <div style={s.overlay}>
      {/* Top bar */}
      <div style={s.topBar}>
        <span style={s.fileName}>{fileName || 'Media'}</span>
        <div style={s.topActions}>
          {messageType === 'image' && (
            <>
              <button
                style={s.iconBtn}
                onClick={handleZoomOut}
                title="Zoom out (−)"
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
              >−</button>
              <button
                style={s.iconBtn}
                onClick={handleZoomIn}
                title="Zoom in (+)"
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
              >+</button>
              <button
                style={s.iconBtn}
                onClick={handleResetZoom}
                title="Reset zoom (0)"
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
              >⊡</button>
            </>
          )}
          <button
            style={s.iconBtn}
            onClick={onDownload}
            title="Download"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          >⬇</button>
          <button
            style={s.iconBtn}
            onClick={onClose}
            title="Close (Esc)"
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          >✕</button>
        </div>
      </div>

      {/* Media content */}
      <div style={s.mediaContainer} onClick={handleBackdropClick} onWheel={handleWheel}>
        {messageType === 'image' ? (
          <img
            src={objectUrl}
            alt={fileName || 'Preview'}
            style={{ ...s.image, transform: `scale(${zoom})` }}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => setZoom((z) => z === 1 ? 2.5 : 1)}
          />
        ) : (
          <video
            controls
            autoPlay
            style={s.video}
            onClick={(e) => e.stopPropagation()}
          >
            <source src={objectUrl} type={mimeType || 'video/mp4'} />
          </video>
        )}
      </div>

      {/* Zoom hint for images */}
      {messageType === 'image' && (
        <div style={s.zoomHint}>
          {zoom !== 1 ? `${Math.round(zoom * 100)}%` : 'Scroll or double-click to zoom'}
        </div>
      )}
    </div>
  );
}
