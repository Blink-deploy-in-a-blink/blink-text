import { useState, useEffect, useCallback } from 'react';
import { getAdminStats, getAdminReports, updateReport, getAdminUsers, banUser, unbanUser } from '../services/api.js';

const s = {
  container: {
    display: 'flex', flexDirection: 'column', height: '100%', background: '#0f0f0f',
    color: '#e0e0e0', overflow: 'hidden',
  },
  header: {
    padding: '1rem 1.5rem', borderBottom: '1px solid #222', background: '#111',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
  },
  title: { color: '#fff', fontWeight: 700, fontSize: '1.15rem' },
  backBtn: {
    background: 'transparent', border: '1px solid #333', borderRadius: '8px',
    color: '#aaa', padding: '0.4rem 0.8rem', cursor: 'pointer', fontSize: '0.85rem',
  },
  content: { flex: 1, overflowY: 'auto', padding: '1.5rem' },
  statsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '1rem', marginBottom: '1.5rem',
  },
  statCard: (color) => ({
    background: '#1a1a1a', borderRadius: '12px', padding: '1rem',
    borderLeft: `4px solid ${color}`,
  }),
  statValue: { fontSize: '1.5rem', fontWeight: 700, color: '#fff' },
  statLabel: { fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' },
  tabs: {
    display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap',
  },
  tab: (active) => ({
    padding: '0.5rem 1rem', borderRadius: '8px', border: 'none',
    background: active ? '#6366f1' : '#1a1a1a', color: active ? '#fff' : '#aaa',
    cursor: 'pointer', fontSize: '0.85rem', fontWeight: active ? 600 : 400,
  }),
  filterRow: {
    display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center',
    flexWrap: 'wrap',
  },
  searchInput: {
    padding: '0.45rem 0.75rem', borderRadius: '8px', border: '1px solid #333',
    background: '#111', color: '#fff', fontSize: '0.85rem', outline: 'none',
    minWidth: '200px',
  },
  filterBtn: (active) => ({
    padding: '0.35rem 0.7rem', borderRadius: '6px', border: '1px solid #333',
    background: active ? '#2a2a3e' : 'transparent', color: active ? '#818cf8' : '#888',
    cursor: 'pointer', fontSize: '0.8rem',
  }),
  table: {
    width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem',
  },
  th: {
    textAlign: 'left', padding: '0.6rem 0.75rem', borderBottom: '1px solid #333',
    color: '#888', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  td: {
    padding: '0.6rem 0.75rem', borderBottom: '1px solid #1a1a1a',
    verticalAlign: 'middle',
  },
  badge: (color, bg) => ({
    display: 'inline-block', padding: '0.15rem 0.5rem', borderRadius: '10px',
    fontSize: '0.7rem', fontWeight: 600, color, background: bg,
  }),
  actionBtn: (color, bg) => ({
    padding: '0.3rem 0.6rem', borderRadius: '6px', border: 'none',
    background: bg, color, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
    marginRight: '0.25rem',
  }),
  pagination: {
    display: 'flex', justifyContent: 'center', gap: '0.5rem',
    marginTop: '1rem', alignItems: 'center',
  },
  pageBtn: (disabled) => ({
    padding: '0.35rem 0.7rem', borderRadius: '6px', border: '1px solid #333',
    background: 'transparent', color: disabled ? '#444' : '#aaa',
    cursor: disabled ? 'default' : 'pointer', fontSize: '0.8rem',
  }),
  emptyState: {
    textAlign: 'center', padding: '2rem', color: '#555', fontSize: '0.9rem',
  },
  reportCard: {
    background: '#1a1a1a', borderRadius: '10px', padding: '1rem', marginBottom: '0.75rem',
    border: '1px solid #222',
  },
  reportHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem',
  },
  reportReason: {
    fontWeight: 600, color: '#fff', fontSize: '0.9rem',
    textTransform: 'capitalize',
  },
  reportMeta: { color: '#666', fontSize: '0.75rem' },
  reportDetails: {
    color: '#aaa', fontSize: '0.85rem', lineHeight: 1.5,
    padding: '0.5rem 0.75rem', background: '#111', borderRadius: '8px',
    marginTop: '0.5rem', marginBottom: '0.5rem',
  },
  reportActions: { display: 'flex', gap: '0.5rem', marginTop: '0.5rem' },
  infoBox: {
    background: '#1a1a2e', border: '1px solid #6366f133', borderRadius: '8px',
    padding: '0.75rem 1rem', marginBottom: '1.5rem', fontSize: '0.8rem',
    color: '#a5b4fc', lineHeight: 1.5,
  },
};

const REASON_LABELS = {
  spam: '🚫 Spam',
  harassment: '😤 Harassment',
  illegal_content: '⚖️ Illegal Content',
  impersonation: '🎭 Impersonation',
  other: '📋 Other',
};

function formatDate(epochSeconds) {
  if (!epochSeconds) return '—';
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function StatusBadge({ status }) {
  const colors = {
    pending: { color: '#fbbf24', bg: '#fbbf2422' },
    reviewed: { color: '#4ade80', bg: '#4ade8022' },
    dismissed: { color: '#888', bg: '#88888822' },
  };
  const c = colors[status] || colors.pending;
  return <span style={s.badge(c.color, c.bg)}>{status}</span>;
}

function StatsPanel({ stats }) {
  if (!stats) return null;
  return (
    <div style={s.statsGrid}>
      <div style={s.statCard('#ef4444')}>
        <div style={s.statValue}>{stats.reports.pending}</div>
        <div style={s.statLabel}>Pending Reports</div>
      </div>
      <div style={s.statCard('#4ade80')}>
        <div style={s.statValue}>{stats.reports.reviewed}</div>
        <div style={s.statLabel}>Reviewed</div>
      </div>
      <div style={s.statCard('#888')}>
        <div style={s.statValue}>{stats.reports.dismissed}</div>
        <div style={s.statLabel}>Dismissed</div>
      </div>
      <div style={s.statCard('#6366f1')}>
        <div style={s.statValue}>{stats.users.total}</div>
        <div style={s.statLabel}>Total Users</div>
      </div>
      <div style={s.statCard('#f59e0b')}>
        <div style={s.statValue}>{stats.users.banned}</div>
        <div style={s.statLabel}>Banned</div>
      </div>
    </div>
  );
}

function ReportsTab({ onStatsChange }) {
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminReports({ status: statusFilter, page, limit: 20 });
      setReports(data.reports);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => { loadReports(); }, [loadReports]);

  const handleUpdateReport = async (reportId, status) => {
    setActionLoading(reportId);
    try {
      await updateReport(reportId, status);
      await loadReports();
      onStatsChange?.();
    } catch (err) {
      console.error('Failed to update report:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <div style={s.infoBox}>
        🔒 <strong>Privacy note:</strong> Messages are end-to-end encrypted. Admins cannot read message content.
        Moderation decisions are based on the reporter's description, the reason category, and the
        number of reports against a user.
      </div>

      <div style={s.filterRow}>
        {['pending', 'reviewed', 'dismissed'].map((st) => (
          <button
            key={st}
            style={s.filterBtn(statusFilter === st)}
            onClick={() => { setStatusFilter(st); setPage(1); }}
          >
            {st.charAt(0).toUpperCase() + st.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={s.emptyState}>Loading reports…</div>
      ) : reports.length === 0 ? (
        <div style={s.emptyState}>
          {statusFilter === 'pending' ? 'No pending reports 🎉' : `No ${statusFilter} reports`}
        </div>
      ) : (
        <>
          {reports.map((r) => (
            <div key={r.id} style={s.reportCard}>
              <div style={s.reportHeader}>
                <div>
                  <span style={s.reportReason}>
                    {REASON_LABELS[r.reason] || r.reason}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
                <div style={s.reportMeta}>{formatDate(r.created_at)}</div>
              </div>
              <div style={{ fontSize: '0.8rem', color: '#aaa', marginBottom: '0.25rem' }}>
                <strong style={{ color: '#ccc' }}>{r.reporter_username || 'Unknown'}</strong> reported{' '}
                <strong style={{ color: '#f87171' }}>{r.reported_username || 'Unknown'}</strong>
              </div>
              {r.details && (
                <div style={s.reportDetails}>
                  "{r.details}"
                </div>
              )}
              {r.status === 'pending' && (
                <div style={s.reportActions}>
                  <button
                    style={s.actionBtn('#fff', '#4ade80')}
                    onClick={() => handleUpdateReport(r.id, 'reviewed')}
                    disabled={actionLoading === r.id}
                  >
                    ✓ Mark Reviewed
                  </button>
                  <button
                    style={s.actionBtn('#fff', '#666')}
                    onClick={() => handleUpdateReport(r.id, 'dismissed')}
                    disabled={actionLoading === r.id}
                  >
                    ✕ Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}

          {totalPages > 1 && (
            <div style={s.pagination}>
              <button
                style={s.pageBtn(page <= 1)}
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </button>
              <span style={{ color: '#666', fontSize: '0.8rem' }}>
                Page {page} of {totalPages}
              </span>
              <button
                style={s.pageBtn(page >= totalPages)}
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function UsersTab({ onStatsChange }) {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmBan, setConfirmBan] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminUsers({ search: search.trim() || undefined, filter, page, limit: 20 });
      setUsers(data.users);
      setTotal(data.total);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  }, [search, filter, page]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleBan = async (userId) => {
    setActionLoading(userId);
    try {
      await banUser(userId);
      setConfirmBan(null);
      await loadUsers();
      onStatsChange?.();
    } catch (err) {
      console.error('Failed to ban user:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnban = async (userId) => {
    setActionLoading(userId);
    try {
      await unbanUser(userId);
      await loadUsers();
      onStatsChange?.();
    } catch (err) {
      console.error('Failed to unban user:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <>
      <div style={s.filterRow}>
        <input
          style={s.searchInput}
          placeholder="🔍 Search by username…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        {['active', 'banned', 'all'].map((f) => (
          <button
            key={f}
            style={s.filterBtn(filter === f)}
            onClick={() => { setFilter(f); setPage(1); }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={s.emptyState}>Loading users…</div>
      ) : users.length === 0 ? (
        <div style={s.emptyState}>No users found</div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Username</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Reports</th>
                  <th style={s.th}>IP</th>
                  <th style={s.th}>Registered</th>
                  <th style={s.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={s.td}>
                      <span style={{ color: '#fff', fontWeight: 500 }}>{u.username}</span>
                      {u.is_admin && <span style={{ ...s.badge('#818cf8', '#818cf822'), marginLeft: '0.5rem' }}>admin</span>}
                    </td>
                    <td style={s.td}>
                      {u.deleted_at ? (
                        <span style={s.badge('#888', '#88888822')}>deleted</span>
                      ) : u.is_banned ? (
                        <span style={s.badge('#ef4444', '#ef444422')}>banned</span>
                      ) : (
                        <span style={s.badge('#4ade80', '#4ade8022')}>active</span>
                      )}
                    </td>
                    <td style={s.td}>
                      {u.report_count > 0 ? (
                        <span style={{ color: u.report_count >= 3 ? '#ef4444' : '#fbbf24', fontWeight: 600 }}>
                          {u.report_count}
                        </span>
                      ) : (
                        <span style={{ color: '#444' }}>0</span>
                      )}
                    </td>
                    <td style={{ ...s.td, color: '#666', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                      {u.registration_ip || '—'}
                    </td>
                    <td style={{ ...s.td, color: '#666', fontSize: '0.8rem' }}>
                      {formatDate(u.created_at)}
                    </td>
                    <td style={s.td}>
                      {u.is_admin ? (
                        <span style={{ color: '#444', fontSize: '0.75rem' }}>—</span>
                      ) : u.is_banned ? (
                        <button
                          style={s.actionBtn('#fff', '#4ade80')}
                          onClick={() => handleUnban(u.id)}
                          disabled={actionLoading === u.id}
                        >
                          Unban
                        </button>
                      ) : confirmBan === u.id ? (
                        <>
                          <button
                            style={s.actionBtn('#fff', '#ef4444')}
                            onClick={() => handleBan(u.id)}
                            disabled={actionLoading === u.id}
                          >
                            Confirm
                          </button>
                          <button
                            style={s.actionBtn('#aaa', '#333')}
                            onClick={() => setConfirmBan(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          style={s.actionBtn('#fff', '#ef4444')}
                          onClick={() => setConfirmBan(u.id)}
                          disabled={actionLoading === u.id}
                        >
                          Ban
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={s.pagination}>
              <button
                style={s.pageBtn(page <= 1)}
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
              >
                ← Prev
              </button>
              <span style={{ color: '#666', fontSize: '0.8rem' }}>
                Page {page} of {totalPages}
              </span>
              <button
                style={s.pageBtn(page >= totalPages)}
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function AdminPanel({ onClose }) {
  const [activeTab, setActiveTab] = useState('reports');
  const [stats, setStats] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await getAdminStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load admin stats:', err);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.title}>🛡️ Admin Dashboard</span>
        <button style={s.backBtn} onClick={onClose}>← Back to Chat</button>
      </div>

      <div style={s.content}>
        <StatsPanel stats={stats} />

        <div style={s.tabs}>
          <button style={s.tab(activeTab === 'reports')} onClick={() => setActiveTab('reports')}>
            📋 Reports {stats?.reports.pending ? `(${stats.reports.pending})` : ''}
          </button>
          <button style={s.tab(activeTab === 'users')} onClick={() => setActiveTab('users')}>
            👥 Users
          </button>
        </div>

        {activeTab === 'reports' && <ReportsTab onStatsChange={loadStats} />}
        {activeTab === 'users' && <UsersTab onStatsChange={loadStats} />}
      </div>
    </div>
  );
}
