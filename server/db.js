'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(process.env.DATABASE_PATH)
  : path.join(__dirname, 'blink.db');

const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    public_key TEXT,
    identity_public_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
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
    timestamp INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
  );

  CREATE TABLE IF NOT EXISTS key_exchange_data (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ephemeral_public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_participants_user ON conversation_participants(user_id);
  CREATE INDEX IF NOT EXISTS idx_key_exchange_conversation ON key_exchange_data(conversation_id, user_id);
`);

module.exports = db;
