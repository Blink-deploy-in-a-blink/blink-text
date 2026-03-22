# Security Model

> Cypher is designed so the server is a **dumb relay** — it never sees private keys, conversation keys, or plaintext. This document describes every security mechanism in the codebase.

---

## Threat Model

| What we protect against | How |
|---|---|
| Server compromise | All encryption/decryption happens client-side; server stores only ciphertext, IVs, and public keys |
| Man-in-the-middle | TLS/WSS via Cloudflare or reverse proxy; ECDSA identity signing for key exchange authenticity |
| Brute-force login | Account lockout after repeated failed attempts; bcrypt with 12 salt rounds |
| Spam / bot registration | SHA-256 Proof-of-Work challenge (difficulty 18) solved in a Web Worker |
| Session hijacking | Single-session enforcement via `session_nonce` — logging in elsewhere instantly revokes the old JWT |
| Credential stuffing | Rate limiting: 20 auth requests / 15 min per IP |
| Privilege escalation | Admin promotion is CLI-only (`admin-cli.js`) — no API endpoint can grant admin |
| Unwanted contact | User blocking prevents DM creation between blocked pairs |
| Stale data exposure | Disappearing messages with server-side cleanup every 30 s; room expiry; nuke chat |

---

## Cryptographic Primitives

| Primitive | Usage |
|---|---|
| **AES-256-GCM** | Message encryption (DM + group), media encryption, sender key wrapping |
| **ECDH P-256** | DM shared key derivation; group pairwise wrapping key derivation |
| **HKDF-SHA-256** | Key derivation after ECDH |
| **ECDSA P-256** | Identity signing for key exchange verification |
| **SHA-256** | Proof-of-Work challenge, token hashing |
| **bcrypt** (12 rounds) | Password hashing |

All crypto operations use the Web Crypto API (browser) or Node.js `crypto` module (server-side tooling), abstracted via `@blink-text/crypto`'s `CryptoEngine`.

---

## Private Key Storage

- **IndexedDB** (`blink-crypto` database) — never `localStorage`
- On **explicit logout**: all crypto keys are wiped (IndexedDB + localStorage session data)
- On **session expiry** (token timeout): only session data is cleared — crypto keys are preserved so previously decrypted messages remain accessible on re-login
- **Guest sessions**: same IndexedDB storage, but session identity is in `sessionStorage` (wiped on tab close)

---

## Authentication & Sessions

| Feature | Detail |
|---|---|
| JWT algorithm | HS256 |
| Token lifetime | 30 days (registered users), 24 hours (guests) |
| Auto-refresh | Client refreshes token before expiry via `POST /api/auth/refresh` |
| Single-session | `session_nonce` column in `users` — each login generates a fresh nonce embedded in the JWT; every authenticated request verifies the nonce matches the DB |
| Account lockout | `failed_login_attempts` + `locked_until` columns; locks after repeated failures |
| Password hashing | `bcrypt`, 12 salt rounds |
| Password change | Invalidates all sessions (new `session_nonce`) |
| Username change | Cooldown tracked via `username_changed_at`; also invalidates sessions |
| Account deletion | Soft-delete (`deleted_at` timestamp); crypto keys wiped client-side |

---

## Encryption Flows

### DM (Direct Message)

1. Both parties generate ephemeral **ECDH P-256** keypairs
2. Public keys exchanged via server (`key_exchange` socket event) — server sees only the public half
3. Each side computes `ECDH(myPrivate, peerPublic)` → feeds result into **HKDF-SHA-256** → 256-bit AES key
4. Every message encrypted with the shared AES key + a fresh random **12-byte IV**
5. Server stores `{ ciphertext, iv }` only

### Group (Sender Key Protocol + Pairwise ECDH)

1. Each group member generates a random 256-bit **sender key** (used to encrypt their messages)
2. For each pair of members, a **pairwise wrapping key** is derived:
   - Each publishes an ephemeral ECDH P-256 public key targeting the specific peer
   - Both derive a shared AES wrapping key via `ECDH + HKDF-SHA-256`
3. The sender key is AES-GCM-wrapped per-recipient using the pairwise wrapping key
4. Wrapped sender keys are stored on the server (`group_sender_keys` table) — server sees only opaque blobs
5. Messages are encrypted once with the sender's sender key (AES-256-GCM + incrementing chain index)
6. All recipients holding a copy of that sender key can decrypt
7. **Late joiners** receive keys via `sender_key_request` → existing members re-wrap and distribute

**Why pairwise ECDH?** Earlier versions used a deterministic HKDF-based wrapping key derived from the two user IDs — meaning the server could theoretically compute it. The current design uses real ephemeral ECDH so the server never has the inputs to derive wrapping keys.

---

## Transport Security

| Layer | Implementation |
|---|---|
| TLS | Terminated at Cloudflare (recommended) or nginx reverse proxy |
| Security headers | `helmet` middleware: CSP, HSTS, X-Frame-Options, X-Content-Type-Options |
| CORS | Restricted to `CLIENT_ORIGIN`; optional `ALLOW_LAN` for local dev |
| WebSocket | Socket.io over WSS; JWT verified on connection |
| Browser cache | `index.html` served with `no-store, no-cache` to prevent back-button session leak |

---

## Rate Limiting & Anti-Spam

| Scope | Limit |
|---|---|
| Global HTTP | 200 requests / min |
| Auth routes (`/api/auth/*`) | 20 requests / 15 min |
| WebSocket events (per user) | 30 events / 10 s |
| Registration | Requires solving a SHA-256 PoW challenge (difficulty 18) |
| Reports | One pending report per (reporter, reported_user) pair (DB unique index) |

---

## User Safety

| Feature | Detail |
|---|---|
| User blocking | `user_blocks` table; enforced on conversation creation and message delivery |
| User reporting | `reports` table with `pending/reviewed/dismissed` workflow; admin review queue |
| Ban enforcement | `is_banned` flag checked on every authenticated request and WebSocket connection |
| Disappearing messages | Per-conversation `disappear_after` timer; `expires_at` per message; server cleanup every 30 s |
| Room expiry | `expires_at` on conversations; server auto-deletes expired rooms + emits `conversation_expired` |
| Nuke chat | Irreversibly deletes all messages + media for a conversation (both parties) |

---

## Guest Sessions

| Property | Detail |
|---|---|
| Token type | 24 h JWT with `guest: true` claim |
| Storage | `sessionStorage` only (wiped on tab close) |
| Identity | UUID in `guest_sessions` table, not in `users` |
| Crypto | Full Sender Key participation; keys in IndexedDB |
| FK constraints | Relaxed — `conversation_participants.user_id` and `messages.sender_id` do not reference `users` |
| Cleanup | Stale guests (24 h no activity) are purged by the server's background job |

---

## Admin

- **Promotion**: CLI-only via `node admin-cli.js promote <username>` — no API endpoint
- **Capabilities**: ban/unban users, review reports, view platform stats
- **No elevated crypto access**: admins cannot read messages (they don't have the keys)
