# Architecture

> Deep reference for contributors. For a quick overview, see the [README](../README.md).

---

## Monorepo Layout

```
apps/
  server/            Node.js · Express · Socket.io · better-sqlite3
  web-client/        React · Vite (no router library — hash-based routing)

packages/
  crypto/            TypeScript CryptoEngine with BrowserProvider + NodeProvider
  shared/            Wire-format validators (validateEncryptedMessage, validateKeyExchange)
```

**Workspaces**: managed by npm workspaces from the root `package.json`.

---

## Server (`apps/server`)

### REST API Routes

All routes are registered in `app.js` under `/api/<resource>`. Every route except `/health` and the public room-join endpoint uses `authenticateToken` middleware.

| Mount Path | File | Key Endpoints |
|---|---|---|
| `/api/auth` | `routes/auth.js` | `GET /pow-challenge`, `POST /register`, `POST /login`, `POST /refresh`, `PUT /password`, `PUT /username`, `DELETE /account` |
| `/api/conversations` | `routes/conversations.js` | CRUD, invite link management, `GET /join/:slug`, nuke chat |
| `/api/keys` | `routes/keys.js` | Get/store ECDH ephemeral keys for DM key exchange |
| `/api/devices` | `routes/devices.js` | Register device identity + ECDH public keys |
| `/api/users` | `routes/users.js` | Lookup users by username |
| `/api/media` | `routes/media.js` | Encrypted media upload/download, per-user storage quota |
| `/api/reports` | `routes/reports.js` | Submit user reports |
| `/api/admin` | `routes/admin.js` | Platform stats, user management, report review queue |
| `/api/blocks` | `routes/blocks.js` | Block/unblock users, list blocked users |
| `/api/group-keys` | `routes/group-keys.js` | Store/retrieve group sender keys + pairwise ECDH public keys |

### WebSocket Events (`websocket.js`)

All events go through the Socket.io connection authenticated by JWT (or guest token).

| Event (client → server) | Purpose |
|---|---|
| `join_conversation` | Join a Socket.io room for real-time updates |
| `leave_conversation` | Leave a Socket.io room |
| `send_message` | Send an encrypted message (stored + broadcast) |
| `edit_message` | Edit an existing message (re-encrypted payload) |
| `delete_message` | Delete for me / delete for everyone |
| `key_exchange` | Forward ECDH ephemeral public key to peer (DM) |
| `key_confirm` | Confirm DM key exchange completion |
| `sender_key_distributed` | Distribute encrypted sender key to group members |
| `sender_key_request` | Request missing sender keys from existing members |
| `group_pairwise_exchange` | Exchange pairwise ECDH public keys for group key wrapping |

| Event (server → client) | Purpose |
|---|---|
| `message` | New message in a conversation |
| `message_edited` | A message was edited |
| `message_deleted` | A message was deleted for everyone |
| `user_joined` | A user joined a group/room |
| `user_connected` | An online-status notification |
| `messages_expired` | Disappearing messages were cleaned up |
| `conversation_expired` | An entire room expired and was deleted |
| `conversation_nuked` | All messages in a conversation were wiped |
| `sender_key_distributed` | Forwarded sender key from another member |
| `sender_key_request` | Forwarded request for sender keys |
| `group_pairwise_exchange` | Forwarded pairwise ECDH public key |

### Rate Limiting

- **Global**: 200 requests/min (Express)
- **Auth routes**: 20 requests/15 min
- **WebSocket**: 30 events/10 s per user (in `websocket.js`)

### Background Jobs

A `setInterval` in `websocket.js` runs every 30 s to:
1. Delete messages past their `expires_at` timestamp and emit `messages_expired`
2. Delete conversations past their `expires_at` and emit `conversation_expired`
3. Clean up stale guest sessions (no activity for 24 h)
4. Purge orphaned pairwise keys for expired conversations

---

## Database Schema (`db.js`)

SQLite via `better-sqlite3` (WAL mode, foreign keys ON). Schema is inline `CREATE TABLE IF NOT EXISTS` + safe `ALTER TABLE` migrations that check column existence before adding. **No migration framework.**

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `username` | TEXT UNIQUE | |
| `password_hash` | TEXT | bcrypt |
| `is_admin` | INTEGER | 0/1 |
| `is_banned` | INTEGER | 0/1 |
| `registration_ip` | TEXT | Hashed |
| `deleted_at` | INTEGER | Soft-delete timestamp |
| `session_nonce` | TEXT | Single-session enforcement |
| `failed_login_attempts` | INTEGER | Account lockout counter |
| `locked_until` | INTEGER | Lockout expiry timestamp |
| `username_changed_at` | INTEGER | Cooldown tracking |
| `created_at` | INTEGER | |

### `devices`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `user_id` | TEXT FK → users | |
| `device_name` | TEXT | |
| `identity_public_key` | TEXT | ECDSA P-256 |
| `ecdh_public_key` | TEXT | ECDH P-256 |
| `created_at` | INTEGER | |

### `conversations`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | UUID |
| `type` | TEXT | `direct_message` or `group_chat` |
| `name` | TEXT | Group/room display name |
| `slug` | TEXT UNIQUE | Public invite slug (rooms) |
| `invite_enabled` | INTEGER | 0/1 |
| `allow_guests` | INTEGER | 0/1 |
| `password_hash` | TEXT | Optional bcrypt room password |
| `max_participants` | INTEGER | Default 50 |
| `disappear_after` | INTEGER | Auto-delete timer (ms), NULL = off |
| `expires_at` | INTEGER | Room expiry timestamp |
| `created_by` | TEXT | Creator user ID |
| `created_at` | INTEGER | |

### `conversation_participants`

| Column | Type | Notes |
|---|---|---|
| `conversation_id` | TEXT FK → conversations | |
| `user_id` | TEXT | No FK (supports guests) |
| `role` | TEXT | `admin` or `member` |
| `joined_at` | INTEGER | |

### `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `conversation_id` | TEXT FK → conversations | |
| `sender_id` | TEXT | No FK (supports guests) |
| `ciphertext` | TEXT | Encrypted payload |
| `iv` | TEXT | 12-byte IV (base64) |
| `version` | TEXT | `v1` |
| `message_type` | TEXT | `text` or `media` |
| `media_id` | TEXT | FK to media, if media message |
| `reply_to_id` | TEXT | Quoted message ID |
| `edited` | INTEGER | 0/1 |
| `chain_idx` | INTEGER | Sender Key chain index (groups) |
| `expires_at` | INTEGER | Disappearing message expiry |
| `timestamp` | INTEGER | Subsecond ms precision |

### `message_deletions`

| Column | Type | Notes |
|---|---|---|
| `message_id` | TEXT FK → messages | |
| `user_id` | TEXT | No FK (supports guests) |

### `key_exchange_data`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `conversation_id` | TEXT FK → conversations | |
| `user_id` | TEXT FK → users | |
| `device_id` | TEXT FK → devices | |
| `ephemeral_public_key` | TEXT | ECDH P-256 |
| `created_at` | INTEGER | |

### `media`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `conversation_id` | TEXT FK → conversations | |
| `sender_id` | TEXT FK → users | |
| `file_path` | TEXT | Encrypted blob path |
| `iv` | TEXT | |
| `version` | TEXT | |
| `file_size` | INTEGER | Bytes, for quota enforcement |
| `created_at` | INTEGER | |

### `reports`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `reporter_id` | TEXT FK → users | |
| `reported_user_id` | TEXT FK → users | |
| `conversation_id` | TEXT FK → conversations | |
| `message_id` | TEXT | |
| `reason` | TEXT | |
| `details` | TEXT | |
| `status` | TEXT | `pending`, `reviewed`, `dismissed` |
| `created_at` | INTEGER | |
| `reviewed_at` | INTEGER | |
| `reviewed_by` | TEXT | |

### `user_blocks`

| Column | Type | Notes |
|---|---|---|
| `blocker_id` | TEXT FK → users | |
| `blocked_id` | TEXT FK → users | |
| `created_at` | INTEGER | |

### `group_sender_keys`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `conversation_id` | TEXT FK → conversations | |
| `sender_user_id` | TEXT | Key owner |
| `recipient_user_id` | TEXT | Intended decryptor |
| `encrypted_sender_key` | TEXT | AES-wrapped with pairwise key |
| `iv` | TEXT | |
| `key_generation` | INTEGER | Rotation counter |
| `signature` | TEXT | |
| `created_at` | INTEGER | |

### `group_pairwise_keys`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `conversation_id` | TEXT FK → conversations | |
| `user_id` | TEXT | Key publisher |
| `peer_user_id` | TEXT | Intended peer |
| `ephemeral_public_key` | TEXT | ECDH P-256 |
| `created_at` | INTEGER | |

### `guest_sessions`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Guest UUID |
| `conversation_id` | TEXT FK → conversations | |
| `display_name` | TEXT | |
| `token_hash` | TEXT | |
| `ip_hash` | TEXT | |
| `pow_nonce` | TEXT | |
| `is_kicked` | INTEGER | 0/1 |
| `created_at` | INTEGER | |
| `last_seen_at` | INTEGER | Updated on activity |

---

## Client (`apps/web-client`)

### Routing

Hash-based routing in `App.jsx` — no React Router. Helper functions `navigate()` and `navigateReplace()` manipulate `window.location.hash`.

| Hash Route | Component |
|---|---|
| `#/login` | `Login` |
| `#/register` | `Register` |
| `#/chat/:convId` | `ChatWindow` |
| `#/r/:slug` | `JoinRoomPage` → `GuestChatView` |
| `#/help` | `HelpPage` |
| `#/privacy` | `PrivacyPolicy` |
| `#/terms` | `TermsOfService` |
| `#/welcome` | `WelcomePage` |

### Service Layer (`src/services/`)

| File | Responsibility |
|---|---|
| `api.js` | Axios wrapper; auto-attaches JWT from `localStorage`/`sessionStorage` |
| `socket.js` | Socket.io client; connect/disconnect/emit helpers |
| `cryptoService.js` | DM encryption/decryption via `CryptoEngine` + `BrowserProvider` |
| `groupCrypto.js` | Group Sender Key protocol: generate, distribute, encrypt, decrypt |
| `guestSession.js` | Burner room session management (`sessionStorage` only) |
| `forwardService.js` | Forward text + media messages across conversations |
| `messageCache.js` | Client-side message caching |
| `powService.js` | Proof-of-Work solver for registration (Web Worker) |

### Hooks (`src/hooks/`)

| Hook | Responsibility |
|---|---|
| `useAuth` | Login/logout, token management, session expiry detection |
| `useMessages` | Message CRUD, socket listeners, decryption orchestration |
| `useBackgroundPreloader` | Preload conversation data in the background |

### Components (`src/components/`)

| Component | Role |
|---|---|
| `ChatWindow` | Main chat view (messages, input, media preview) |
| `ConversationList` | Sidebar: conversations, settings, block/nuke/report actions |
| `MessageInput` | Compose bar with media upload |
| `Login` / `Register` | Auth forms (Register includes PoW solving) |
| `GuestChatView` | Guest (burner room) chat experience |
| `JoinRoomPage` | Room join form (password, display name) |
| `NewConversationModal` | Create DM or group |
| `ForwardModal` | Pick conversation to forward a message to |
| `MediaPreviewModal` | Full-screen encrypted media viewer |
| `ReportModal` | Report a user |
| `AdminPanel` | Admin dashboard (stats, users, reports) |
| `SessionExpiredModal` | Prompt on session expiry |
| `WelcomePage` / `HelpPage` | Static info pages |
| `MaintenancePage` | Shown when `VITE_MAINTENANCE_MODE=true` |
| `PrivacyPolicy` / `TermsOfService` | Legal pages |

---

## Crypto Package (`packages/crypto`)

Platform-agnostic facade built with TypeScript + tsup.

```
src/
  types.ts    CryptoProvider interface
  engine.ts   CryptoEngine class (delegates to a provider)
  index.ts    Re-exports
  provider/
    browser.ts  BrowserProvider — Web Crypto API
    node.ts     NodeProvider — Node.js crypto module
```

**Key operations**: ECDH P-256 key generation, ECDH derive, HKDF-SHA-256, AES-256-GCM encrypt/decrypt, ECDSA P-256 sign/verify, random bytes.

**Vite alias**: `@blink-text/crypto` points to `packages/crypto/src/index.ts` (source, not dist) during dev — changes are hot-reloaded without rebuilding.

---

## Encryption Flows

### DM (Direct Message)

1. Both parties generate ephemeral ECDH P-256 keypairs
2. Public keys exchanged via server (`key_exchange` socket event)
3. Each derives AES-256-GCM shared key locally via ECDH + HKDF-SHA-256
4. Messages encrypted with shared key + random 12-byte IV
5. Server sees only `{ ciphertext, iv }`

### Group (Sender Key Protocol)

1. Each member generates a random 256-bit **sender key**
2. For each pair of members, a **pairwise wrapping key** is derived:
   - Each publishes an ephemeral ECDH P-256 public key for the other
   - Both derive a shared AES key via ECDH + HKDF
3. Sender key is AES-wrapped per-recipient using the pairwise key and stored on the server
4. Messages are encrypted once with the sender's sender key (AES-256-GCM + chain index)
5. All recipients holding a copy of that sender key can decrypt
6. **Late joiners**: server emits `sender_key_request` → existing members re-distribute their sender keys

### Guest Sessions

- Guests get a 24 h JWT stored in `sessionStorage` (ephemeral by design)
- Crypto keys stored in IndexedDB like registered users
- On tab close, `sessionStorage` is wiped → guest identity is gone
- Guests participate in the same Sender Key protocol as registered users
