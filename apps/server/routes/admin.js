'use strict';

const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../auth');

const router = express.Router();

/**
 * Middleware: verify the authenticated user has is_admin = 1
 */
function requireAdmin(req, res, next) {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// GET /api/admin/verify — check if the current user is an admin.
// This is the ONLY way the client discovers admin status.
// The check hits the DB directly on every call — never trusts client-side data.
// Returns 200 { admin: true } for admins, 403 for everyone else.
router.get('/verify', authenticateToken, requireAdmin, (_req, res) => {
  return res.json({ admin: true });
});

// GET /api/admin/stats — dashboard statistics
router.get('/stats', authenticateToken, requireAdmin, (_req, res) => {
  try {
    const pendingReports = db.prepare('SELECT COUNT(*) as count FROM reports WHERE status = ?').get('pending').count;
    const reviewedReports = db.prepare('SELECT COUNT(*) as count FROM reports WHERE status = ?').get('reviewed').count;
    const dismissedReports = db.prepare('SELECT COUNT(*) as count FROM reports WHERE status = ?').get('dismissed').count;
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL').get().count;
    const bannedUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_banned = 1 AND deleted_at IS NULL').get().count;

    return res.json({
      reports: { pending: pendingReports, reviewed: reviewedReports, dismissed: dismissedReports },
      users: { total: totalUsers, banned: bannedUsers },
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/users — list users (paginated, searchable)
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search?.trim();
    const filter = req.query.filter; // 'banned', 'active', 'all'

    let query = `
      SELECT u.id, u.username, u.is_admin, u.is_banned, u.registration_ip, u.created_at, u.deleted_at,
        COALESCE(rc.report_count, 0) AS report_count
      FROM users u
      LEFT JOIN (
        SELECT reported_user_id, COUNT(*) AS report_count FROM reports GROUP BY reported_user_id
      ) rc ON rc.reported_user_id = u.id
    `;
    let countQuery = 'SELECT COUNT(*) as total FROM users';
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('u.username LIKE ?');
      params.push(`%${search}%`);
    }

    if (filter === 'banned') {
      conditions.push('u.is_banned = 1');
    } else if (filter === 'active') {
      conditions.push('u.is_banned = 0 AND u.deleted_at IS NULL');
    }

    if (conditions.length > 0) {
      const whereClause = ' WHERE ' + conditions.join(' AND ');
      query += whereClause;
      // Count query uses users table directly (no alias needed)
      countQuery += ' WHERE ' + conditions.join(' AND ').replace(/u\./g, '');
    }

    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';

    const countParams = [...params];
    params.push(limit, offset);

    const users = db.prepare(query).all(...params);
    const { total } = db.prepare(countQuery).get(...countParams);

    const usersWithReports = users.map(u => ({
      ...u,
      is_admin: !!u.is_admin,
      is_banned: !!u.is_banned,
      report_count: u.report_count,
    }));

    return res.json({ users: usersWithReports, total, page, limit });
  } catch (err) {
    console.error('List users error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/reports — list reports (optionally filter by status)
router.get('/reports', authenticateToken, requireAdmin, (req, res) => {
  try {
    const status = req.query.status; // 'pending', 'reviewed', 'dismissed'
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    let query = `
      SELECT r.*, 
        reporter.username AS reporter_username,
        reported.username AS reported_username
      FROM reports r
      LEFT JOIN users reporter ON reporter.id = r.reporter_id
      LEFT JOIN users reported ON reported.id = r.reported_user_id
    `;
    const params = [];

    if (status && ['pending', 'reviewed', 'dismissed'].includes(status)) {
      query += ' WHERE r.status = ?';
      params.push(status);
    }

    query += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const reports = db.prepare(query).all(...params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM reports';
    const countParams = [];
    if (status && ['pending', 'reviewed', 'dismissed'].includes(status)) {
      countQuery += ' WHERE status = ?';
      countParams.push(status);
    }
    const { total } = db.prepare(countQuery).get(...countParams);

    return res.json({ reports, total, page, limit });
  } catch (err) {
    console.error('List reports error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/reports/:reportId — update report status (review/dismiss)
router.put('/reports/:reportId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { reportId } = req.params;
    const { status } = req.body;

    if (!status || !['reviewed', 'dismissed'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "reviewed" or "dismissed"' });
    }

    const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    db.prepare(
      'UPDATE reports SET status = ?, reviewed_at = unixepoch(), reviewed_by = ? WHERE id = ?'
    ).run(status, req.user.id, reportId);

    return res.json({ message: 'Report updated' });
  } catch (err) {
    console.error('Update report error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/ban/:userId — ban a user
router.post('/ban/:userId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { userId } = req.params;

    // Cannot ban yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot ban yourself' });
    }

    const user = db.prepare('SELECT id, username, is_admin FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Cannot ban another admin
    if (user.is_admin) {
      return res.status(403).json({ error: 'Cannot ban an admin' });
    }

    db.prepare('UPDATE users SET is_banned = 1 WHERE id = ?').run(userId);

    // Disconnect the banned user's active sockets
    const io = req.app.get('io');
    if (io) {
      // Collect matching socket IDs first, then disconnect in a second pass
      const toDisconnect = [];
      for (const [socketId, s] of io.sockets.sockets) {
        if (s.user && s.user.id === userId) {
          toDisconnect.push(socketId);
        }
      }
      for (const socketId of toDisconnect) {
        const s = io.sockets.sockets.get(socketId);
        if (s) {
          s.emit('banned', { message: 'Your account has been suspended' });
          s.disconnect(true);
        }
      }
    }

    return res.json({ message: `User ${user.username} has been banned` });
  } catch (err) {
    console.error('Ban user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/unban/:userId — unban a user
router.post('/unban/:userId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { userId } = req.params;

    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.prepare('UPDATE users SET is_banned = 0 WHERE id = ?').run(userId);
    return res.json({ message: `User ${user.username} has been unbanned` });
  } catch (err) {
    console.error('Unban user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
