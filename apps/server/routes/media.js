'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();
router.use(authenticateToken);

// Per-user storage limit (default 500 MB)
const DEFAULT_MAX_STORAGE = 500 * 1024 * 1024;
const parsedMaxStorage = parseInt(process.env.MAX_STORAGE_PER_USER, 10);
const MAX_STORAGE_PER_USER = Number.isFinite(parsedMaxStorage) && parsedMaxStorage > 0
  ? parsedMaxStorage
  : DEFAULT_MAX_STORAGE;

/** Best-effort file cleanup — never throws, so error responses aren't masked. */
function safeUnlink(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (_err) { /* ignore */ }
}

// Uploads directory — encrypted files only
const UPLOADS_DIR = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '..', 'uploads');

// Ensure the uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer config — store encrypted blobs directly to disk
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, _file, cb) => cb(null, `${uuidv4()}.enc`),
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
});

// POST /api/media/upload — upload encrypted media
router.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { conversationId, iv } = req.body;
    if (!conversationId || !iv) {
      // Clean up the uploaded file
      safeUnlink(req.file.path);
      return res.status(400).json({ error: 'conversationId and iv are required' });
    }

    // Verify user is a participant in the conversation
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(conversationId, req.user.id);

    if (!participant) {
      safeUnlink(req.file.path);
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }

    // Enforce per-user storage quota
    const totalStorage = db.prepare(
      'SELECT COALESCE(SUM(file_size), 0) as total FROM media WHERE sender_id = ?'
    ).get(req.user.id).total;
    if (totalStorage + req.file.size > MAX_STORAGE_PER_USER) {
      safeUnlink(req.file.path);
      return res.status(413).json({
        error: 'Storage quota exceeded',
        used: totalStorage,
        limit: MAX_STORAGE_PER_USER,
      });
    }

    const mediaId = uuidv4();
    const relativePath = path.basename(req.file.path);

    db.prepare(
      'INSERT INTO media (id, conversation_id, sender_id, file_path, iv, file_size) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(mediaId, conversationId, req.user.id, relativePath, iv, req.file.size);

    return res.status(201).json({ mediaId, fileSize: req.file.size });
  } catch (err) {
    // Clean up on error
    safeUnlink(req.file && req.file.path);
    console.error('Media upload error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/media/:id — download encrypted media
router.get('/:id', (req, res) => {
  try {
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    // Verify user is a participant in the conversation
    const participant = db.prepare(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
    ).get(media.conversation_id, req.user.id);

    if (!participant) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }

    const filePath = path.join(UPLOADS_DIR, media.file_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Media file not found on disk' });
    }

    // Return the encrypted file bytes with IV in a custom header
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': media.file_size,
      'X-Media-IV': media.iv,
      'X-Media-Version': media.version,
      'Access-Control-Expose-Headers': 'X-Media-IV, X-Media-Version',
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('Media download error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
