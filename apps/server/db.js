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

// Session nonce for single-session enforcement.
// Each login generates a fresh nonce stored in the DB and embedded in the JWT.
// Every authenticated request checks that the JWT's nonce matches the DB.
// If another device logs in, the nonce changes and the old JWT is instantly invalid.
if (!userColumns.includes('session_nonce')) {
  db.exec("ALTER TABLE users ADD COLUMN session_nonce TEXT DEFAULT NULL");
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

module.exports = db;
