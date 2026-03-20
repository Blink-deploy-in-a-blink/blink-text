'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, 'blink.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    deleted_at INTEGER DEFAULT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT,
    identity_public_key TEXT NOT NULL,
    ecdh_public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('direct_message', 'group_chat')),
    name TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT 'v1',
    reply_to_id TEXT,
    edited INTEGER NOT NULL DEFAULT 0,
    timestamp INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
  );

  CREATE TABLE IF NOT EXISTS key_exchange_data (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ephemeral_public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);
  CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
  CREATE INDEX IF NOT EXISTS idx_key_exchange_conversation ON key_exchange_data(conversation_id, user_id);

  CREATE TABLE IF NOT EXISTS message_deletions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    iv TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT 'v1',
    file_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`);

// Safe migrations: ALTER TABLE only if column doesn't exist yet
const userColumns = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
if (!userColumns.includes('deleted_at')) {
  db.exec("ALTER TABLE users ADD COLUMN deleted_at INTEGER DEFAULT NULL");
}
if (!userColumns.includes('registration_ip')) {
  db.exec("ALTER TABLE users ADD COLUMN registration_ip TEXT DEFAULT NULL");
}
if (!userColumns.includes('is_admin')) {
  db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.includes('is_banned')) {
  db.exec("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0");
}

const messageColumns = db.prepare("PRAGMA table_info(messages)").all().map(c => c.name);
if (!messageColumns.includes('message_type')) {
  db.exec("ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'");
}
if (!messageColumns.includes('media_id')) {
  db.exec("ALTER TABLE messages ADD COLUMN media_id TEXT DEFAULT NULL");
}
if (!messageColumns.includes('chain_idx')) {
  db.exec("ALTER TABLE messages ADD COLUMN chain_idx INTEGER DEFAULT NULL");
}

// Disappearing messages: per-message expiry timestamp (ms)
if (!messageColumns.includes('expires_at')) {
  db.exec("ALTER TABLE messages ADD COLUMN expires_at INTEGER DEFAULT NULL");
}

// Disappearing messages: per-conversation default timer (ms duration), NULL = off
const convColumns = db.prepare("PRAGMA table_info(conversations)").all().map(c => c.name);
if (!convColumns.includes('disappear_after')) {
  db.exec("ALTER TABLE conversations ADD COLUMN disappear_after INTEGER DEFAULT NULL");
}

// ── Group / Room unified columns on conversations ──
if (!convColumns.includes('slug')) {
  db.exec("ALTER TABLE conversations ADD COLUMN slug TEXT DEFAULT NULL");
}
if (!convColumns.includes('invite_enabled')) {
  db.exec("ALTER TABLE conversations ADD COLUMN invite_enabled INTEGER NOT NULL DEFAULT 0");
}
if (!convColumns.includes('allow_guests')) {
  db.exec("ALTER TABLE conversations ADD COLUMN allow_guests INTEGER NOT NULL DEFAULT 0");
}
if (!convColumns.includes('password_hash')) {
  db.exec("ALTER TABLE conversations ADD COLUMN password_hash TEXT DEFAULT NULL");
}
if (!convColumns.includes('max_participants')) {
  db.exec("ALTER TABLE conversations ADD COLUMN max_participants INTEGER NOT NULL DEFAULT 50");
}
if (!convColumns.includes('expires_at')) {
  db.exec("ALTER TABLE conversations ADD COLUMN expires_at INTEGER DEFAULT NULL");
}
if (!convColumns.includes('created_by')) {
  db.exec("ALTER TABLE conversations ADD COLUMN created_by TEXT DEFAULT NULL");
}

// ── Participant roles (admin / member) ──
const cpColumns = db.prepare("PRAGMA table_info(conversation_participants)").all().map(c => c.name);
if (!cpColumns.includes('role')) {
  db.exec("ALTER TABLE conversation_participants ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
}

// Session nonce for single-session enforcement.
// Each login generates a fresh nonce stored in the DB and embedded in the JWT.
// Every authenticated request checks that the JWT's nonce matches the DB.
// If another device logs in, the nonce changes and the old JWT is instantly invalid.
if (!userColumns.includes('session_nonce')) {
  db.exec("ALTER TABLE users ADD COLUMN session_nonce TEXT DEFAULT NULL");
}

// Account lockout: track failed login attempts per user
if (!userColumns.includes('failed_login_attempts')) {
  db.exec("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0");
}
if (!userColumns.includes('locked_until')) {
  db.exec("ALTER TABLE users ADD COLUMN locked_until INTEGER DEFAULT NULL");
}

// Reports table for user reporting mechanism
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    message_id TEXT,
    reason TEXT NOT NULL,
    details TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'dismissed')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    reviewed_at INTEGER DEFAULT NULL,
    reviewed_by TEXT DEFAULT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
  CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON reports(reported_user_id);
`);

// User blocks table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (blocker_id, blocked_id)
  );
  CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON user_blocks(blocker_id);
  CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON user_blocks(blocked_id);
`);

// Performance indexes for rate-limit and quota queries
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_media_sender_id ON media(sender_id);
  CREATE INDEX IF NOT EXISTS idx_reports_reporter_created ON reports(reporter_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;
`);

// Enforce at most one pending report per (reporter, reported_user) pair at the DB level
// This makes the dedup check atomic — even concurrent requests can't create duplicates.
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_pending
  ON reports(reporter_id, reported_user_id)
  WHERE status = 'pending';
`);

// ── Group sender keys: encrypted sender key copies for group E2E encryption ──
db.exec(`
  CREATE TABLE IF NOT EXISTS group_sender_keys (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL,
    recipient_user_id TEXT NOT NULL,
    encrypted_sender_key TEXT NOT NULL,
    iv TEXT NOT NULL,
    key_generation INTEGER NOT NULL DEFAULT 0,
    signature TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_gsk_recipient
    ON group_sender_keys(conversation_id, recipient_user_id);
  CREATE INDEX IF NOT EXISTS idx_gsk_sender
    ON group_sender_keys(conversation_id, sender_user_id, key_generation);
`);

// ── Guest sessions for burner rooms (no-account users) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS guest_sessions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    token_hash TEXT NOT NULL DEFAULT '',
    ip_hash TEXT,
    pow_nonce TEXT,
    is_kicked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_guest_sessions_conversation
    ON guest_sessions(conversation_id);
`);

// Unique index on conversation slug for fast public lookups
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_slug
    ON conversations(slug) WHERE slug IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_conversations_expires
    ON conversations(expires_at) WHERE expires_at IS NOT NULL;
`);

// ── Migration: remove FK on conversation_participants.user_id for guest support ──
// Guests have IDs in guest_sessions, not in users, so the FK to users blocks guest joins.
{
  const cpSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE name = 'conversation_participants' AND type = 'table'"
  ).get();
  if (cpSchema && cpSchema.sql && cpSchema.sql.includes('REFERENCES users')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE conversation_participants_new (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
        role TEXT NOT NULL DEFAULT 'member',
        PRIMARY KEY (conversation_id, user_id)
      );
      INSERT INTO conversation_participants_new (conversation_id, user_id, joined_at, role)
        SELECT conversation_id, user_id, joined_at, role FROM conversation_participants;
      DROP TABLE conversation_participants;
      ALTER TABLE conversation_participants_new RENAME TO conversation_participants;
      CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);
    `);
    db.pragma('foreign_keys = ON');
  }
}

// ── Migration: remove FK on messages.sender_id for guest support ──
// Guests send messages but their IDs are not in the users table.
{
  const msgSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE name = 'messages' AND type = 'table'"
  ).get();
  if (msgSchema && msgSchema.sql && /sender_id[^,]*REFERENCES\s+users/i.test(msgSchema.sql)) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE messages_new (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT 'v1',
        reply_to_id TEXT,
        edited INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
        message_type TEXT NOT NULL DEFAULT 'text',
        media_id TEXT DEFAULT NULL,
        chain_idx INTEGER DEFAULT NULL,
        expires_at INTEGER DEFAULT NULL
      );
      INSERT INTO messages_new (id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, edited, timestamp, message_type, media_id, chain_idx, expires_at)
        SELECT id, conversation_id, sender_id, ciphertext, iv, version, reply_to_id, edited, timestamp, message_type, media_id, chain_idx, expires_at FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;
    `);
    db.pragma('foreign_keys = ON');
  }
}

// ── Migration: remove FK on message_deletions.user_id for guest support ──
{
  const mdSchema = db.prepare(
    "SELECT sql FROM sqlite_master WHERE name = 'message_deletions' AND type = 'table'"
  ).get();
  if (mdSchema && mdSchema.sql && /user_id[^,]*REFERENCES\s+users/i.test(mdSchema.sql)) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE message_deletions_new (
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        PRIMARY KEY (message_id, user_id)
      );
      INSERT INTO message_deletions_new (message_id, user_id)
        SELECT message_id, user_id FROM message_deletions;
      DROP TABLE message_deletions;
      ALTER TABLE message_deletions_new RENAME TO message_deletions;
    `);
    db.pragma('foreign_keys = ON');
  }
}

module.exports = db;
