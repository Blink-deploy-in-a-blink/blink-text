# Blink-Text Security Audit Report

> **Audit Date:** 2026-03-18
> **Auditor:** Security Architecture & Engineering Review
> **Scope:** Full codebase — server (`apps/server`), client (`apps/web-client`), crypto engine (`packages/crypto`), shared schemas (`packages/shared`)
> **Methodology:** Manual source code review, threat modeling, abuse vector analysis

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Risk Severity Matrix](#2-risk-severity-matrix)
3. [Critical Vulnerabilities](#3-critical-vulnerabilities)
4. [High Severity Findings](#4-high-severity-findings)
5. [Medium Severity Findings](#5-medium-severity-findings)
6. [Low Severity Findings](#6-low-severity-findings)
7. [Informational Findings](#7-informational-findings)
8. [Abuse & Spam Vector Analysis](#8-abuse--spam-vector-analysis)
9. [Cryptographic Protocol Analysis](#9-cryptographic-protocol-analysis)
10. [Privacy Architecture Review](#10-privacy-architecture-review)
11. [Remediation Roadmap](#11-remediation-roadmap)
12. [Privacy-Enhancing Feature Suggestions](#12-privacy-enhancing-feature-suggestions-beyond-planmd)
13. [Conclusion](#13-conclusion)

---

## 1. Executive Summary

Blink-Text is a privacy-focused, end-to-end encrypted messaging platform with a "dumb relay" server architecture. The security posture is **above average for a pre-launch project** — the team has implemented PoW anti-spam, JWT session management with single-session enforcement, rate limiting, admin controls via CLI-only promotion, and a key confirmation handshake. The E2E encryption uses standard ECDH P-256 with HKDF-SHA-256, which is a sound foundation.

However, this audit identified **4 critical**, **9 high**, **8 medium**, **6 low**, and **5 informational** findings that should be addressed before public launch. The most dangerous findings relate to:

- **Default JWT secret** allowing full server compromise if `.env` is misconfigured
- **No password change session invalidation** allowing stolen tokens to remain valid indefinitely
- **Unlimited resource consumption** (devices, conversations, media uploads, reports) enabling denial-of-service
- **User enumeration** via search and registration endpoints undermining platform anonymity
- **Weak PoW difficulty** that doesn't deter GPU-equipped attackers

The platform's core E2E encryption design is solid for 1:1 conversations. Group chat encryption is acknowledged as broken (ECDH is 2-party only) and is correctly hidden from the UI.

### Summary Statistics

| Severity | Count | Requires Code Change | Configuration Only |
|----------|-------|---------------------|--------------------|
| 🔴 Critical | 4 | 3 | 1 |
| 🟠 High | 9 | 9 | 0 |
| 🟡 Medium | 8 | 7 | 1 |
| 🔵 Low | 6 | 4 | 2 |
| ⚪ Info | 5 | 0 | 0 |
| **Total** | **32** | **23** | **4** |

---

## 2. Risk Severity Matrix

| ID | Title | Severity | CVSS | Exploitability | Impact |
|----|-------|----------|------|---------------|--------|
| C-1 | Default JWT Secret | 🔴 Critical | 9.8 | Trivial | Full server takeover |
| C-2 | No Password-Change Session Revocation | 🔴 Critical | 8.1 | Medium | Persistent unauthorized access |
| C-3 | Unlimited Device Registration DoS | 🔴 Critical | 7.5 | Easy | Database exhaustion / server crash |
| C-4 | Unbounded Media Storage Exhaustion | 🔴 Critical | 7.5 | Easy | Disk exhaustion / server crash |
| H-1 | Username Enumeration on Registration | 🟠 High | 5.3 | Trivial | Privacy breach / user deanonymization |
| H-2 | User Search Allows Full Enumeration | 🟠 High | 5.3 | Easy | Complete user list extraction |
| H-3 | Unrestricted DM Creation (Spam Vector) | 🟠 High | 6.5 | Easy | Mass spam to all users |
| H-4 | Report System Flooding | 🟠 High | 5.3 | Easy | Admin queue DoS |
| H-5 | Username Squatting (No Reserved Names) | 🟠 High | 4.3 | Trivial | Impersonation / social engineering |
| H-6 | Missing Conversation Creation Limits | 🟠 High | 5.3 | Easy | Database bloat / DoS |
| H-7 | CORS Allows All Private IP Ranges | 🟠 High | 5.0 | Medium | Cross-origin attacks on shared networks |
| H-8 | Media Encryption Uses Static Root Key | 🟠 High | 4.7 | Hard | No forward secrecy for media |
| H-9 | WebSocket Payload Size Unlimited | 🟠 High | 5.3 | Easy | Memory exhaustion via large payloads |
| M-1 | No Account Lockout After Failed Logins | 🟡 Medium | 5.3 | Medium | Brute-force password attacks |
| M-2 | PoW Difficulty Too Low for GPUs | 🟡 Medium | 5.3 | Medium | Mass bot registration |
| M-3 | Admin Panel Exposes Registration IPs | 🟡 Medium | 4.3 | Low | User deanonymization by admin |
| M-4 | Client-Provided Message IDs | 🟡 Medium | 3.7 | Medium | Message ID collision / overwrite |
| M-5 | Message Edit Has No Size Limits | 🟡 Medium | 4.3 | Easy | Storage abuse via payload inflation |
| M-6 | Soft-Delete Doesn't Purge Messages | 🟡 Medium | 4.0 | Low | Deleted user data persists forever |
| M-7 | Token Refresh Ignores Password Changes | 🟡 Medium | 5.3 | Medium | Stale sessions survive password changes |
| M-8 | No TLS Certificate Pinning Guidance | 🟡 Medium | 4.3 | Medium | MITM on self-hosted deployments |
| L-1 | Console Logging of Crypto Key Prefixes | 🔵 Low | 2.4 | Low | Partial key material in server logs |
| L-2 | No Database Encryption at Rest | 🔵 Low | 3.7 | Low | Data exposure if disk is stolen |
| L-3 | Missing Strict-Transport-Security Config | 🔵 Low | 3.1 | Low | Downgrade attacks |
| L-4 | PoW Challenges Stored In-Memory Only | 🔵 Low | 2.0 | Low | Server restart clears valid challenges |
| L-5 | WebSocket Error Callbacks Inconsistent | 🔵 Low | 2.0 | N/A | Silent failures on missing acks |
| L-6 | No API Versioning | 🔵 Low | 1.0 | N/A | Breaking changes affect all clients |
| I-1 | No Formal Third-Party Audit | ⚪ Info | — | — | Trust gap |
| I-2 | No Automated Security Testing (SAST/DAST) | ⚪ Info | — | — | Regression risk |
| I-3 | No CSP Nonce for Inline Scripts | ⚪ Info | — | — | XSS risk reduction |
| I-4 | No Subresource Integrity (SRI) | ⚪ Info | — | — | CDN compromise risk |
| I-5 | No Test Infrastructure | ⚪ Info | — | — | Unverified behavior |

---

## 3. Critical Vulnerabilities

### C-1: Default JWT Secret Allows Full Server Takeover

**File:** `apps/server/auth.js:6`
```javascript
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
```

**Impact:** If `JWT_SECRET` is not set (which only produces a console warning), anyone who knows the default value `'change-me-in-production'` (visible in the open-source code) can:
1. Forge a JWT for **any user** (including admin accounts)
2. Gain full admin API access (ban users, read reports, view all user data)
3. Impersonate any user in WebSocket connections
4. Read all conversation metadata and encrypted messages
5. Upload/download encrypted media from any conversation

**Exploitation:**
```bash
# Forge an admin token (trivial):
node -e "
const jwt = require('jsonwebtoken');
const token = jwt.sign(
  { id: 'ADMIN_USER_UUID', username: 'admin', nonce: 'KNOWN_NONCE' },
  'change-me-in-production',
  { expiresIn: '30d' }
);
console.log(token);
"
# Use this token to access any endpoint, including admin APIs
```

The nonce check (session_nonce) adds a layer, but the attacker can still forge tokens for freshly-created accounts where the nonce is predictable, or brute-force existing nonces (128-bit, but if the DB is exposed via other means, the game is over).

**Recommendation:**
1. **Refuse to start** the server without `JWT_SECRET` being explicitly set
2. Validate minimum length (32+ characters) on startup
3. Remove the fallback entirely

```javascript
// Replace current code with:
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be set and at least 32 characters. Exiting.');
  process.exit(1);
}
```

**Severity:** 🔴 Critical | **CVSS:** 9.8

---

### C-2: No Password-Change Session Revocation

**File:** `apps/server/routes/auth.js:218-248`

When a user changes their password via `PUT /api/auth/password`, the `session_nonce` is **NOT** regenerated. This means:

1. If an attacker steals a user's JWT (XSS, network sniffing, shoulder surfing)
2. The legitimate user discovers the compromise and changes their password
3. **The attacker's stolen token remains fully valid** for up to 30 days

The session_nonce mechanism was designed to invalidate old sessions on new login, but password changes bypass it entirely.

**Exploitation:**
```bash
# 1. Attacker steals a valid JWT from the network/localStorage
# 2. Victim changes their password
# 3. Attacker's old JWT still works for ALL endpoints:
curl -H "Authorization: Bearer $STOLEN_TOKEN" https://blink.example.com/api/conversations
# Still returns 200 with full conversation data
```

**Recommendation:** Regenerate `session_nonce` after password change:
```javascript
// In PUT /api/auth/password handler, after updating password_hash:
const newNonce = crypto.randomBytes(16).toString('hex');
db.prepare('UPDATE users SET session_nonce = ? WHERE id = ?').run(newNonce, req.user.id);
// Issue a new token with the new nonce
const newToken = signToken({ id: req.user.id, username: user.username, nonce: newNonce });
return res.json({ message: 'Password changed successfully', token: newToken });
```

**Severity:** 🔴 Critical | **CVSS:** 8.1

---

### C-3: Unlimited Device Registration — Database Exhaustion DoS

**File:** `apps/server/routes/devices.js:14-39`

The `POST /api/devices` endpoint has **no limit** on how many devices a single user can register. Each device creates a row with two JWK objects (identity + ECDH public keys), each ~500 bytes of JSON.

**Exploitation:**
```bash
# Register 100,000 devices in a loop (within 200 req/min global rate limit):
for i in $(seq 1 100000); do
  curl -X POST https://blink.example.com/api/devices \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"identityPublicKey":{"kty":"EC","crv":"P-256","x":"...","y":"..."},"ecdhPublicKey":{"kty":"EC","crv":"P-256","x":"...","y":"..."}}'
done
# Result: ~100 MB of device records per user. 10 users = 1 GB. DB grows unbounded.
```

**Recommendation:**
1. Limit to **5 devices per user** (or 10 for premium)
2. Add a check before INSERT:
```javascript
const deviceCount = db.prepare('SELECT COUNT(*) as count FROM devices WHERE user_id = ?').get(req.user.id).count;
if (deviceCount >= 5) {
  return res.status(400).json({ error: 'Maximum device limit reached. Remove a device first.' });
}
```

**Severity:** 🔴 Critical | **CVSS:** 7.5

---

### C-4: Unbounded Media Storage Exhaustion

**File:** `apps/server/routes/media.js:30-33`

The upload endpoint allows **100 MB per file** with **no per-user storage limit**. A single malicious user can fill the server's entire disk.

**Exploitation:**
```bash
# Upload 100 MB encrypted blobs repeatedly:
for i in $(seq 1 1000); do
  dd if=/dev/urandom bs=100M count=1 2>/dev/null | \
    curl -X POST https://blink.example.com/api/media/upload \
      -H "Authorization: Bearer $TOKEN" \
      -F "file=@-" \
      -F "conversationId=$CONV_ID" \
      -F "iv=random_iv_here"
done
# Result: 100 GB of disk consumed. Server crashes when disk is full.
```

**Recommendation:**
1. Implement per-user storage quotas (e.g., 500 MB free tier)
2. Track total storage per user:
```javascript
const totalStorage = db.prepare(
  'SELECT COALESCE(SUM(file_size), 0) as total FROM media WHERE sender_id = ?'
).get(req.user.id).total;
if (totalStorage + req.file.size > MAX_STORAGE_PER_USER) {
  fs.unlinkSync(req.file.path);
  return res.status(413).json({ error: 'Storage quota exceeded', used: totalStorage, limit: MAX_STORAGE_PER_USER });
}
```
3. Consider maximum total server storage with alerts

**Severity:** 🔴 Critical | **CVSS:** 7.5

---

## 4. High Severity Findings

### H-1: Username Enumeration on Registration

**File:** `apps/server/routes/auth.js:120-123`

```javascript
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  return res.status(409).json({ error: 'Username already taken' });
}
```

The `409` response with `'Username already taken'` reveals whether a specific username is registered. For an anonymous messaging platform, this is a significant privacy concern:

- An adversary can check if a journalist's known alias exists on the platform
- Systematic probing can enumerate all registered usernames
- The 20/15min rate limit per IP is easily bypassed with rotating proxies

**Recommendation:** Return the same response whether the username exists or not. Use a timing-safe approach:

```javascript
// Always hash a password (even for existing users) to prevent timing attacks
const dummyHash = await bcrypt.hash('dummy-password', 12);
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  // Simulate the same response time as a successful registration
  return res.status(201).json({ token: '...', user: { id: '...', username } });
  // Note: This is complex. Alternative: return a generic error for both
  // "username taken" and "registration failed" cases.
}
```

More practically, consider returning a generic 400 error:
```javascript
if (existing) {
  return res.status(400).json({ error: 'Registration failed. Try a different username.' });
}
```

**Severity:** 🟠 High | **Impact:** Undermines platform anonymity

---

### H-2: User Search Allows Full User Enumeration

**File:** `apps/server/routes/users.js:13-30`

The search endpoint allows querying with single-character strings (min length: 1) and returns up to 20 results. An attacker can systematically extract **every registered username**:

```bash
# Enumerate all users by querying single characters:
for char in a b c d e f g h i j k l m n o p q r s t u v w x y z 0 1 2 3 4 5 6 7 8 9 _; do
  curl "https://blink.example.com/api/users/search?q=$char" \
    -H "Authorization: Bearer $TOKEN"
done
# Result: Full user list in 36 requests
```

**Recommendation:**
1. Increase minimum search query length to **3 characters**
2. Add a dedicated rate limit on the search endpoint (e.g., 10 searches per minute)
3. Consider returning only exact username matches (not LIKE queries)
4. Limit results to users who share at least one conversation with the requester, OR require mutual contact approval

**Severity:** 🟠 High | **Impact:** Complete user list extraction

---

### H-3: Unrestricted DM Creation — Mass Spam Vector

**File:** `apps/server/routes/conversations.js:41-141`

Any authenticated user can create a DM with **any other user** without the recipient's consent. The only check is for blocks. Combined with H-2 (user enumeration), this enables:

1. Enumerate all users via search endpoint
2. Create a DM conversation with each user
3. Send encrypted spam messages to every user on the platform
4. Each DM costs one conversation + one message = 2 requests
5. At 200 requests/min rate limit: **100 users spammed per minute**

**Exploitation flow:**
```
1. Register account (PoW: ~2 seconds)
2. GET /api/users/search?q=a,b,c...z (36 requests → all usernames)
3. For each user: POST /api/conversations (create DM)
4. For each conversation: send_message via WebSocket
5. Total: ~500 users spammed in ~5 minutes before anyone notices
```

**Recommendation:** Implement one or more of these mitigations:
1. **Message request system**: New DMs from non-contacts go to a "Message Requests" queue that the recipient must accept
2. **Trust levels** (as described in PLAN.md R6): New accounts (<24h) cannot initiate DMs
3. **Per-user conversation creation rate limit**: Max 5 new conversations per hour for new accounts
4. **Mutual contact requirement**: Users must add each other as contacts before DM

**Severity:** 🟠 High | **Impact:** Platform-wide spam

---

### H-4: Report System Flooding

**File:** `apps/server/routes/reports.js:14-85`

There is **no rate limit** on the report submission endpoint. A user can submit thousands of reports against the same or different users, flooding the admin queue:

```bash
for i in $(seq 1 10000); do
  curl -X POST https://blink.example.com/api/reports \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"reportedUserId":"victim-uuid","reason":"spam","details":"report #'$i'"}'
done
```

**Recommendation:**
1. Rate limit: Max 5 reports per user per hour
2. Deduplicate: Max 1 pending report per (reporter, reported_user) pair
3. Add a `reporter_report_count` check — if a user has submitted >20 reports in 24h, flag for review

**Severity:** 🟠 High | **Impact:** Admin queue DoS, potential false-flag abuse

---

### H-5: Username Squatting — No Reserved Names

**File:** `apps/server/routes/auth.js:72-77`

The username validation only checks `^[a-zA-Z0-9_]+$` with 3-32 characters. There are **no reserved/blocked usernames**. An attacker can register:

- `admin`, `administrator`, `support`, `help`, `blink`, `system`, `moderator`
- `security`, `abuse`, `noreply`, `root`, `server`, `official`

This enables social engineering attacks ("Hi, I'm from Blink support, please send me your password").

**Recommendation:** Maintain a blocklist of reserved usernames:
```javascript
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'support', 'help', 'blink', 'system',
  'moderator', 'mod', 'security', 'abuse', 'noreply', 'root',
  'server', 'official', 'staff', 'team', 'bot', 'info', 'contact',
  'deleted', 'deleted_user', 'announcement', 'channel',
]);
// In registration handler:
if (RESERVED_USERNAMES.has(username.toLowerCase())) {
  return res.status(400).json({ error: 'This username is reserved' });
}
```

**Severity:** 🟠 High | **Impact:** Impersonation / social engineering

---

### H-6: Missing Conversation Creation Limits

**File:** `apps/server/routes/conversations.js:41-141`

There is no limit on how many conversations a single user can create. An attacker can:
1. Create millions of conversation records
2. Each conversation creates entries in `conversations` + `conversation_participants`
3. Database grows unboundedly until disk is full

**Recommendation:**
1. Limit: Max 100 active conversations per user (or 500 for premium)
2. Add a check before creation:
```javascript
const convCount = db.prepare(`
  SELECT COUNT(*) as count FROM conversation_participants WHERE user_id = ?
`).get(req.user.id).count;
if (convCount >= MAX_CONVERSATIONS_PER_USER) {
  return res.status(400).json({ error: 'Maximum conversation limit reached' });
}
```

**Severity:** 🟠 High | **Impact:** Database DoS

---

### H-7: CORS Allows All Private IP Ranges

**File:** `apps/server/app.js:35-52`

```javascript
function isAllowedOrigin(origin) {
  if (!origin) return true; // curl, mobile apps, same-origin
  // ...
  if (ip.startsWith('192.168.') || ip.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  // ...
}
```

**Issues:**
1. **`if (!origin) return true`**: Allows requests with no Origin header (not just curl — any non-browser HTTP client). While this is common for APIs, it bypasses CORS entirely for scripted attacks.
2. **All private IP ranges allowed**: On a shared network (coffee shop, coworking space, university), any machine on the LAN can make cross-origin requests to the Blink server. If a user has the Blink tab open, a malicious page on the same network could potentially exploit this.
3. **Port not checked**: `192.168.1.100:9999` (attacker's server) would be allowed.

**Recommendation:**
1. Remove blanket private IP allowance in production
2. Only allow `CLIENT_ORIGIN` and `localhost` by default
3. Make LAN access opt-in via environment variable:
```javascript
const ALLOW_LAN = process.env.ALLOW_LAN === 'true';
```

**Severity:** 🟠 High | **Impact:** Cross-origin attacks on shared networks

---

### H-8: Media Encryption Uses Static Root Key (No Forward Secrecy)

**File:** `apps/web-client/src/services/cryptoService.js:719-726`

```javascript
export async function encryptMediaForConversation(conversationId, data) {
  const entry = conversationKeys.get(conversationId);
  // ...
  // Media uses the root key directly (same as v1) for simplicity
  return engine.encryptBinary(entry.rootKey, data);
}
```

Text messages use a chain ratchet (v2) providing forward secrecy, but **media files are encrypted with the static root key**. If the root key is ever compromised, **all past and future media in that conversation is decryptable**.

This is especially concerning because:
- Media files persist on disk as `.enc` files
- Messages can be re-encrypted with a new root key after re-keying, but media files on disk remain encrypted with the old key
- The comment acknowledges this is "for simplicity" but doesn't flag the security implication

**Recommendation:**
1. Generate a random per-file AES-256 key for each media upload
2. Encrypt the per-file key with the current chain ratchet message key
3. Send the encrypted file key in the message metadata (inside the E2E encrypted payload)

**Severity:** 🟠 High | **Impact:** No forward secrecy for media — compromise of root key exposes all media

---

### H-9: WebSocket Payload Size Unlimited

**File:** `apps/server/websocket.js` (Socket.io server configuration)

The Socket.io server is created with **default settings**, which allow up to **1 MB per message** by default. However, there is no explicit `maxHttpBufferSize` configuration, and ciphertext/iv fields in messages are not length-validated server-side.

A malicious client could:
1. Send messages with multi-megabyte ciphertext fields
2. Each message is stored in SQLite, bloating the database
3. Other clients must download and attempt to decrypt these oversized messages

**Recommendation:**
1. Set `maxHttpBufferSize` explicitly:
```javascript
const io = new Server(httpServer, {
  maxHttpBufferSize: 64 * 1024, // 64 KB max per WebSocket message
  // ...
});
```
2. Validate ciphertext length server-side before storing:
```javascript
if (ciphertext.length > 32768) { // ~24 KB of plaintext after base64
  if (typeof ack === 'function') ack({ error: 'Message too large' });
  return;
}
```

**Severity:** 🟠 High | **Impact:** Memory/database exhaustion via oversized messages

---

## 5. Medium Severity Findings

### M-1: No Account Lockout After Failed Logins

**File:** `apps/server/routes/auth.js:14-20, 150-198`

The only brute-force protection is the global `authLimiter` (20 requests per 15 minutes per IP). This allows:
- 20 password attempts per 15 minutes per IP
- 80 attempts per hour per IP
- With 10 proxy IPs: 800 attempts/hour
- An 8-character lowercase password has ~208 billion combinations — safe
- But common passwords like `password123` can be tried across many users

**Recommendation:**
1. Per-username rate limiting: Lock the account after 5 failed attempts for 15 minutes
2. Exponential backoff: 1s, 2s, 4s, 8s delay between attempts
3. Track failed attempts in DB:
```sql
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until INTEGER DEFAULT NULL;
```

**Severity:** 🟡 Medium

---

### M-2: PoW Difficulty Too Low for GPU-Equipped Attackers

**File:** `apps/server/routes/auth.js:27`

```javascript
const POW_DIFFICULTY = 18; // 18 leading zero bits
```

At 18 bits difficulty:
- CPU: ~1-3 seconds per solution (good for legitimate users)
- Modern GPU (RTX 4090): ~2^18 = 262,144 hashes needed. At 10 billion hashes/sec = **0.026 milliseconds**
- Even a mid-range GPU can solve this in under 1ms

A GPU-equipped attacker can register thousands of accounts per second, limited only by the HTTP rate limiter (20/15min per IP), which is easily bypassed with proxies.

**Recommendation:**
1. Use **memory-hard** PoW instead of SHA-256 (e.g., Argon2, scrypt) to neutralize GPU advantage
2. Or increase difficulty to 24+ bits (adds ~15-30 seconds for CPU, still trivial for GPU)
3. Best approach: adaptive difficulty based on registration velocity:
```javascript
function getCurrentDifficulty() {
  const recentRegistrations = countRegistrationsInLastHour();
  if (recentRegistrations > 100) return 24;
  if (recentRegistrations > 50) return 22;
  return 18;
}
```

**Severity:** 🟡 Medium

---

### M-3: Admin Panel Exposes Registration IPs to Admin Users

**File:** `apps/server/routes/admin.js:57`

```javascript
SELECT u.id, u.username, u.is_admin, u.is_banned, u.registration_ip, ...
```

The admin user list endpoint returns `registration_ip` for all users. While this is needed for law enforcement compliance, it creates a risk:
- A rogue admin can deanonymize users
- Admin accounts are high-value targets — if compromised, all user IPs are exposed
- There's no audit log of admin actions

**Recommendation:**
1. **Mask IPs by default** in the admin panel (show only first two octets: `192.168.x.x`)
2. Full IP revelation should require a **second authentication step** (password re-entry)
3. Implement **admin audit logging** — log every admin action with timestamp and IP
4. Consider hashing registration IPs with a pepper (retain ability to compare but not read):
```javascript
// Store: SHA-256(IP + server_pepper)
// Can still check "was this IP used before?" but can't read the IP without the pepper
```

**Severity:** 🟡 Medium

---

### M-4: Client-Provided Message IDs

**File:** `apps/server/websocket.js:156`

```javascript
const messageId = payload.id || uuidv4();
```

The server accepts client-provided UUIDs for message IDs. While UUID collision is astronomically unlikely, a malicious client can:
1. Set `id` to a non-UUID string (the shared validator checks for non-empty string, not UUID format)
2. Set `id` to an existing message ID — the INSERT would fail due to PRIMARY KEY constraint, but the error is caught and returns a generic "Failed to store message"

**Recommendation:**
1. Always generate message IDs server-side:
```javascript
const messageId = uuidv4(); // Never trust client-provided IDs
```
2. Or validate UUID format if client-provided IDs are needed for optimistic updates

**Severity:** 🟡 Medium

---

### M-5: Message Edit Has No Size Limits

**Files:** `apps/server/websocket.js:247-286`, `apps/server/routes/conversations.js:242-278`

Edited messages have no validation on the size of `ciphertext` or `iv` fields. A malicious client can:
1. Send a normal 100-byte message
2. Edit it to contain a 10 MB ciphertext field
3. Repeat across many messages to inflate database size

**Recommendation:** Validate payload size on edit (same as on send):
```javascript
if (typeof ciphertext !== 'string' || ciphertext.length > 32768) {
  if (typeof ack === 'function') ack({ error: 'Payload too large' });
  return;
}
```

**Severity:** 🟡 Medium

---

### M-6: Soft-Delete Doesn't Purge User Messages

**File:** `apps/server/routes/auth.js:271-287`

When a user deletes their account:
1. Username is scrambled to `deleted_<uuid_prefix>`
2. Password hash is set to `'DELETED'`
3. Devices and key_exchange_data are removed
4. **Messages remain in the database with the user's original UUID as `sender_id`**

This means:
- Encrypted messages from deleted users persist indefinitely
- The `sender_id` UUID is still linked to the user record (now showing `deleted_*`)
- If `deleteConversations` is false (default), conversations persist with the user's participation

**Recommendation:**
1. Offer a clear "delete all my messages" option (already partially there with `deleteConversations`)
2. When `deleteConversations` is true, also delete all messages sent by the user
3. Consider a scheduled job that purges messages from deleted accounts after 30 days

**Severity:** 🟡 Medium

---

### M-7: Token Refresh Ignores Password Changes

**File:** `apps/server/routes/auth.js:202-216`

The `/api/auth/refresh` endpoint re-uses the current `session_nonce` from the database. Since password changes don't update the nonce (see C-2), a stolen token can be refreshed indefinitely:

```
1. Attacker steals JWT (nonce: ABC123)
2. Victim changes password (nonce remains ABC123)
3. Attacker calls POST /api/auth/refresh → gets new JWT (still nonce: ABC123)
4. Attacker has a fresh 30-day token
```

**Recommendation:** This is fixed by C-2's recommendation (regenerate nonce on password change). Additionally, token refresh should check `password_hash` hasn't changed since the token was issued:

```javascript
// Add 'password_changed_at' column to users table
// Include in JWT: { ..., passwordChangedAt: user.password_changed_at }
// On refresh: verify JWT's passwordChangedAt matches current DB value
```

**Severity:** 🟡 Medium

---

### M-8: No TLS Certificate Pinning Guidance for Self-Hosted Deployments

**Files:** README.md, nginx.conf

The deployment documentation recommends nginx + Cloudflare but doesn't discuss:
1. Certificate pinning for API connections
2. HSTS preloading
3. Certificate transparency monitoring
4. Self-signed certificate risks on LAN deployments

For self-hosted LAN deployments using `mkcert`, users are relying on a self-signed CA. If an attacker can install their own CA certificate (e.g., corporate proxy), they can MITM all traffic.

**Recommendation:** Add a security hardening guide for self-hosted deployments covering:
1. Let's Encrypt setup for internet-facing instances
2. HSTS configuration with preloading
3. Certificate transparency log monitoring
4. Warning about self-signed CA risks

**Severity:** 🟡 Medium

---

## 6. Low Severity Findings

### L-1: Console Logging of Crypto Key Prefixes

**File:** `apps/web-client/src/services/cryptoService.js:679-681`

```javascript
const keyHex = Array.from(rootKey.slice(0, 8))
  .map((b) => b.toString(16).padStart(2, '0')).join('');
console.log('[crypto] Derived root key prefix:', keyHex, ...);
```

Key prefixes (first 8 bytes / 64 bits) are logged to the browser console. While this is the client side (not server logs), it could be captured by:
- Browser extensions with console access
- Developer tools left open in screenshots
- Error reporting services that capture console output

**Recommendation:** Remove or gate behind a `DEBUG` flag:
```javascript
if (import.meta.env.DEV) {
  console.log('[crypto] Derived root key prefix:', keyHex);
}
```

**Severity:** 🔵 Low

---

### L-2: No Database Encryption at Rest

**File:** `apps/server/db.js`

SQLite database `blink.db` stores all user data, conversation metadata, encrypted messages, and password hashes in an unencrypted file. If the server's disk is compromised:
- All password hashes (bcrypt, 12 rounds — strong) are exposed
- All conversation metadata (who talked to whom, when) is exposed
- Registration IPs are exposed
- Encrypted message ciphertext is exposed (still E2E encrypted, but metadata is not)

**Recommendation:** Consider `sqlcipher` (SQLite encryption extension) for at-rest encryption of the database file.

**Severity:** 🔵 Low

---

### L-3: Missing Strict-Transport-Security Header Configuration

**File:** `apps/server/app.js:54-72`

While `helmet` is used, HSTS configuration isn't explicitly set. By default, helmet includes HSTS, but the `max-age` and `includeSubDomains` settings should be verified for production.

**Recommendation:**
```javascript
app.use(helmet({
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  // ...existing config
}));
```

**Severity:** 🔵 Low

---

### L-4: PoW Challenges Stored In-Memory Only

**File:** `apps/server/routes/auth.js:30-40`

PoW challenges are stored in a `Map()` that is lost on server restart. If the server restarts during a user's registration flow, their challenge becomes invalid and they must restart.

**Recommendation:** This is acceptable for single-server deployments. For multi-server (behind a load balancer), challenges would need to be stored in Redis or the database. Add a comment documenting this limitation.

**Severity:** 🔵 Low

---

### L-5: WebSocket Error Callbacks Inconsistent

**File:** `apps/server/websocket.js`

Some WebSocket handlers check `typeof ack === 'function'` before calling the acknowledgment callback. When no callback is provided, errors are silently dropped. This isn't a security vulnerability per se, but it can cause the client to hang waiting for a response.

Events with inconsistent ack handling: `key_exchange` (no ack on validation failure), `key_confirm` (no ack at all), `join_conversation` (error emitted instead of ack'd).

**Recommendation:** Standardize: always require ack callbacks or always emit error events.

**Severity:** 🔵 Low

---

### L-6: No API Versioning

**File:** `apps/server/app.js:91-99`

All endpoints are under `/api/` with no version prefix (e.g., `/api/v1/`). Breaking changes to the API will affect all connected clients simultaneously.

**Recommendation:** Add API versioning for future-proofing:
```javascript
app.use('/api/v1/auth', authRoutes);
// Maintain backwards compatibility:
app.use('/api/auth', authRoutes); // deprecated, redirect to v1
```

**Severity:** 🔵 Low

---

## 7. Informational Findings

### I-1: No Formal Third-Party Security Audit

As acknowledged in PLAN.md's competitive analysis, the platform has no independent security audit. Signal has had multiple. Before handling sensitive communications (journalists, activists), a formal audit of the crypto implementation and server architecture is strongly recommended.

### I-2: No Automated Security Testing

There is no CI/CD pipeline with SAST (Static Application Security Testing) or DAST (Dynamic Application Security Testing). Security regressions can be introduced without detection.

**Recommendation:** Add `npm audit`, `eslint-plugin-security`, and `semgrep` to CI.

### I-3: No CSP Nonce for Inline Scripts

The Content-Security-Policy uses `'self'` for `scriptSrc`, which is good. However, if any inline scripts are needed in the future, a nonce-based CSP should be implemented rather than `'unsafe-inline'`.

### I-4: No Subresource Integrity (SRI)

The Vite build doesn't generate SRI hashes for script/style tags. If the built assets are served through a CDN that is compromised, malicious code could be injected.

### I-5: No Test Infrastructure

There are no unit tests, integration tests, or end-to-end tests. Security-critical logic (auth, crypto, rate limiting) has no automated verification of correct behavior.

---

## 8. Abuse & Spam Vector Analysis

This section analyzes how the platform can be abused by malicious actors, beyond the individual vulnerabilities listed above.

### 8.1 Mass Bot Registration Attack

| Aspect | Details |
|--------|---------|
| **Attack** | Register thousands of bot accounts for spam |
| **Current Defenses** | PoW (18 bits), rate limit (20/15min/IP) |
| **Bypass** | GPU solves PoW in <1ms. Rotating proxies bypass IP rate limit. |
| **Cost to Attacker** | ~$5/hr for proxy pool + GPU = 10,000 accounts/hour |
| **Impact** | Platform flooded with spam bots, legitimate users leave |

**Recommended Layered Defense:**
1. Memory-hard PoW (Argon2) to neutralize GPU advantage
2. hCaptcha on registration (already in PLAN.md)
3. Progressive rate limiting: 1st account/IP free, 2nd requires higher PoW, 3rd blocked for 24h
4. Device fingerprinting (canvas, WebGL, audio context) — not for tracking, just for rate limiting

### 8.2 Targeted Harassment Campaign

| Aspect | Details |
|--------|---------|
| **Attack** | Create accounts to harass a specific user after being blocked |
| **Current Defenses** | Block user (prevents messages), report + admin ban |
| **Bypass** | Create new account, re-initiate DM. Repeat after each ban. |
| **Cost** | PoW per account (~2 seconds), new proxy per ban |
| **Impact** | Victim cannot escape harassment |

**Recommended Layered Defense:**
1. **Trust levels** (PLAN.md R6): New accounts can't initiate DMs for 24h
2. **Message request system**: Recipients must accept DMs from unknown users
3. **Shadow banning**: Banned users think they're sending messages, but they're never delivered
4. **IP range banning**: Admin can ban an IP range, not just individual accounts

### 8.3 Metadata Harvesting / Social Graph Extraction

| Aspect | Details |
|--------|---------|
| **Attack** | Extract the social graph (who talks to whom) from the server |
| **Current Defenses** | JWT auth required, admin-only user list |
| **Bypass** | Compromise an admin account (C-1), or extract from DB backup |
| **Data Exposed** | All usernames, conversation participants, message timestamps, registration IPs |
| **Impact** | Deanonymize users, reveal communication patterns |

**Recommended Defense:**
1. Hash registration IPs (separate from law enforcement preservation)
2. Minimize server-side metadata (see Section 10)
3. Admin audit logging (who viewed what, when)
4. Database encryption at rest

### 8.4 Conversation Key Theft via WebSocket Race

| Aspect | Details |
|--------|---------|
| **Attack** | Exploit the key_exchange socket event to inject a malicious public key |
| **Current Defenses** | Only conversation participants can emit key_exchange events |
| **Scenario** | Attacker joins a group conversation and injects their ephemeral key, causing peers to derive a key shared with the attacker |
| **Impact** | Attacker can read messages encrypted with the derived shared key |

**Mitigation:** The key_confirm handshake should prevent this — both sides verify they derived the same key. However, if the attacker is fast enough to inject between key exchange and confirmation, they could be a MITM. Full MITM prevention requires out-of-band key verification (safety numbers).

### 8.5 Server Operator as Adversary

| Aspect | Details |
|--------|---------|
| **Scenario** | The server operator is malicious or compromised |
| **What they CAN do** | Read all metadata, modify server code to inject malicious public keys, serve a modified client that leaks plaintext |
| **What they CANNOT do** | Decrypt existing E2E encrypted messages (without modifying the client) |
| **Impact** | Full compromise of future communications |

**This is the fundamental limitation of any web-based E2E system.** Signal mitigates this with native apps (code signing) and reproducible builds. Web-based platforms cannot fully solve this.

**Recommended Mitigations:**
1. Client code checksums (SRI + hash verification)
2. Browser extension that verifies client code integrity
3. Published source maps + reproducible builds
4. Transparency reports (canary pages)

---

## 9. Cryptographic Protocol Analysis

### 9.1 Key Exchange (ECDH P-256)

| Aspect | Assessment |
|--------|-----------|
| **Algorithm** | ECDH P-256 — NIST standard, widely trusted |
| **Key derivation** | HKDF-SHA-256 with conversation ID as info — correct |
| **Ephemeral keys** | Fresh keypair per conversation — good |
| **Key storage** | IndexedDB (not localStorage) — correct |
| **Key confirmation** | HMAC-SHA-256 handshake — good (detects mismatch) |

**Issues:**
1. **No out-of-band verification**: Users cannot compare safety numbers / QR codes to verify they're talking to the right person. Without this, a MITM attack at the server level is undetectable.
2. **Key exchange is not authenticated**: The ephemeral public keys are not signed with the identity key. An active attacker on the network (or compromised server) could substitute their own public key.

**Recommendation:** Sign ephemeral public keys with the identity key:
```javascript
// When publishing ephemeral key:
const signature = await engine.sign(identityKeypair.privateKey, ephemeralPublicKey);
// Peer verifies signature against sender's identity public key (fetched from devices endpoint)
```

### 9.2 Symmetric Encryption (AES-256-GCM)

| Aspect | Assessment |
|--------|-----------|
| **Algorithm** | AES-256-GCM — gold standard |
| **IV generation** | Random per message (via Web Crypto) — correct |
| **IV size** | 12 bytes (standard for GCM) — correct |
| **Key size** | 256 bits (HKDF output) — correct |

**No issues found.** The symmetric encryption is correctly implemented.

### 9.3 Chain Ratchet (Forward Secrecy)

| Aspect | Assessment |
|--------|-----------|
| **Mechanism** | HKDF chain: chainKey → (nextChainKey, messageKey) |
| **Salt** | Zero salt (32 zero bytes) |
| **Info** | `'blink-chain-v2'` |
| **Forward secrecy** | ✅ Send chain key is overwritten after each message |

**Issues:**
1. **Zero salt in HKDF**: Using a zero salt is technically valid (HKDF spec says it's acceptable when no salt is available), but using the conversation ID or a counter as salt would be stronger.
2. **No Double Ratchet**: The current implementation uses a symmetric ratchet only. Signal's Double Ratchet combines both a symmetric (chain) ratchet and an asymmetric (DH) ratchet. The asymmetric ratchet provides **post-compromise security** — if a chain key is compromised, the next DH ratchet step re-secures the channel. Blink's current design does not recover from key compromise within a session.
3. **Receive chain re-derivation from root**: For decryption, the receiver re-derives the chain from the root key up to the target counter. This is O(n) per message, which is fine for low-volume chats but degrades for high-volume conversations.

**Recommendation:** Long-term, implement the full Double Ratchet (asymmetric + symmetric ratchet) for post-compromise security. Short-term, the current chain ratchet provides adequate forward secrecy.

### 9.4 Media Encryption

| Aspect | Assessment |
|--------|-----------|
| **Algorithm** | AES-256-GCM with root key |
| **Forward secrecy** | ❌ No — uses static root key |
| **IV** | Random per file — correct |
| **Key** | Conversation root key (shared between all participants) |

See H-8 for details. Media should use per-file keys.

---

## 10. Privacy Architecture Review

### 10.1 What the Server Knows

| Data Category | Stored | Encrypted | Impact |
|---------------|--------|-----------|--------|
| Username | ✅ Cleartext | ❌ | Links to real identity if username is reused |
| Password hash | ✅ bcrypt(12) | N/A | Strong, but crackable for weak passwords |
| Registration IP | ✅ Cleartext | ❌ | Direct deanonymization |
| Device fingerprint | ✅ UserAgent string | ❌ | Browser/OS identification |
| Conversation graph | ✅ (participant table) | ❌ | Who talks to whom |
| Message timestamps | ✅ Millisecond precision | ❌ | Communication pattern analysis |
| Message ciphertext | ✅ | ✅ (E2E) | Content protected |
| Media ciphertext | ✅ | ✅ (E2E) | Content protected |
| Media file sizes | ✅ Cleartext | ❌ | Can infer content type |
| Public keys (ECDH, identity) | ✅ | ❌ | Cryptographic identity |

### 10.2 Metadata Minimization Opportunities

1. **Registration IP**: Hash with a pepper (still allow comparison for rate limiting). Store unhashed only when legally required (law enforcement hold).

2. **Message timestamps**: Round to the nearest minute (or 5 minutes) instead of millisecond precision. Millisecond timestamps enable traffic correlation attacks.

3. **Conversation graph**: Currently, the server knows exactly who is in each conversation. Consider implementing a "sealed sender" pattern where the server routes messages by conversation ID without knowing who the participants are. (This is architecturally complex but worth exploring.)

4. **Media file sizes**: Pad all uploaded files to the nearest power-of-2 size (e.g., 1 KB, 2 KB, 4 KB, ... 64 MB) to prevent inferring content type from size.

5. **UserAgent string**: Don't store the full UserAgent. At most, store a hash for device deduplication.

### 10.3 Client-Side Privacy

| Aspect | Status | Notes |
|--------|--------|-------|
| Private keys in IndexedDB | ✅ Good | Not in localStorage |
| Device ID in localStorage | ⚠️ Acceptable | Not sensitive crypto material |
| Token in localStorage | ⚠️ Risk | XSS can steal it. Consider httpOnly cookies. |
| Plaintext in memory only | ✅ Good | Messages decrypted in React state, not persisted |
| Console logging of keys | ❌ Bad | Key prefixes logged (see L-1) |

---

## 11. Remediation Roadmap

### Immediate (Before Public Launch)

| Priority | Finding | Fix Time | Effort |
|----------|---------|----------|--------|
| 🔴 P0 | C-1: Default JWT secret | 30 min | Trivial |
| 🔴 P0 | C-2: Password change session revocation | 1 hr | Easy |
| 🔴 P0 | C-3: Device registration limit | 30 min | Trivial |
| 🔴 P0 | C-4: Media storage limits | 1 hr | Easy |
| 🟠 P1 | H-5: Reserved usernames | 30 min | Trivial |
| 🟠 P1 | H-9: WebSocket payload size limit | 30 min | Trivial |
| 🟠 P1 | H-3: DM creation rate limit | 2 hrs | Easy |
| 🟠 P1 | H-4: Report rate limit | 1 hr | Easy |
| 🟠 P1 | H-6: Conversation creation limit | 1 hr | Easy |

### Short-Term (First Month Post-Launch)

| Priority | Finding | Fix Time | Effort |
|----------|---------|----------|--------|
| 🟠 P2 | H-1: Username enumeration | 2 hrs | Medium |
| 🟠 P2 | H-2: User search hardening | 2 hrs | Medium |
| 🟠 P2 | H-7: CORS tightening | 1 hr | Easy |
| 🟠 P2 | H-8: Per-file media encryption | 8 hrs | Hard |
| 🟡 P2 | M-1: Account lockout | 2 hrs | Easy |
| 🟡 P2 | M-2: PoW difficulty increase | 4 hrs | Medium |
| 🟡 P2 | M-5: Message size limits | 1 hr | Easy |

### Medium-Term (3-6 Months)

| Priority | Finding | Fix Time | Effort |
|----------|---------|----------|--------|
| 🟡 P3 | M-3: Admin IP masking + audit log | 8 hrs | Medium |
| 🟡 P3 | M-4: Server-generated message IDs | 2 hrs | Easy |
| 🟡 P3 | M-6: Message purge for deleted accounts | 4 hrs | Medium |
| 🟡 P3 | M-8: TLS hardening guide | 4 hrs | Documentation |
| 🔵 P3 | L-1: Remove console key logging | 1 hr | Trivial |
| 🔵 P3 | L-2: Database encryption at rest | 4 hrs | Medium |

---

## 12. Privacy-Enhancing Feature Suggestions (Beyond PLAN.md)

These features are **not in the current PLAN.md** and would further differentiate Blink from competitors on privacy.

### 12.1 🔒 Sealed Sender (Metadata-Private Messaging)

**What:** The server relays messages without knowing who sent them. The sender's identity is encrypted inside the E2E payload, visible only to the recipient.

**How:** 
1. Sender encrypts their user ID inside the message payload (before E2E encryption)
2. Server sees only the conversation ID and an anonymous ciphertext blob
3. Recipient decrypts and learns the sender's identity from the inner payload
4. Server routes purely by conversation room — it never learns `senderId`

**Why it kills:** Signal has this. It's the gold standard for metadata privacy. Currently, Blink's server knows exactly who sends each message.

**Effort:** ~15-20 hours
**Impact:** Eliminates sender-metadata surveillance even by the server operator

---

### 12.2 🕵️ Tor Hidden Service Support (.onion)

**What:** Allow running the Blink server as a Tor .onion hidden service, so neither the server operator nor network observers know the IP addresses of users.

**How:**
1. Add a Tor configuration guide
2. Modify the client to support `.onion` URLs
3. Optimize WebSocket connections for Tor's latency

**Why it kills:** Users in repressive countries can access Blink without revealing their IP to anyone — not even the server. Combined with username-only registration, this is **true anonymity**.

**Effort:** ~8-10 hours (documentation + minor code changes)
**Impact:** Journalists, activists, whistleblowers in hostile environments

---

### 12.3 📊 Traffic Analysis Resistance (Message Padding + Decoy Traffic)

**What:** Pad all messages and media to fixed sizes, and optionally generate decoy traffic, to prevent an observer from inferring communication patterns.

**How:**
1. **Message padding**: All E2E encrypted payloads are padded to a fixed length (e.g., 4 KB). Short messages get random padding, long messages are split.
2. **Decoy traffic**: Client periodically sends encrypted "null messages" that are indistinguishable from real messages. Server relays them but the recipient's client silently discards them.
3. **Timing jitter**: Add random delays (50-500ms) before sending, to mask real-time communication patterns.

**Why it kills:** Even if an attacker captures all network traffic, they can't tell when you're actually communicating vs. idle. This defeats traffic correlation attacks used by nation-state adversaries.

**Effort:** ~15-20 hours
**Impact:** Nation-state level traffic analysis resistance

---

### 12.4 🪦 Dead Man's Switch (Auto-Delete Account)

**What:** Users can set a timer: "If I don't log in within N days, delete my account and all my data."

**How:**
1. New user setting: `auto_delete_after_days` (7, 30, 90, 365, null)
2. Server job checks `last_login` vs `auto_delete_after_days`
3. On trigger: full account deletion (not soft-delete) — wipe messages, media, conversations
4. Optional: send a warning notification 24h before deletion (if push notifications exist)

**Why it kills:** Journalists and activists can set this to 7 days. If they're detained and can't log in, their account self-destructs. No data to seize.

**Effort:** ~6-8 hours
**Impact:** Protects users who are physically compromised (detained, kidnapped, device seized)

---

### 12.5 🚨 Panic Button (Emergency Data Wipe)

**What:** A keyboard shortcut (e.g., `Ctrl+Shift+X` three times) that instantly:
1. Wipes all local data (IndexedDB, localStorage, sessionStorage)
2. Closes the browser tab
3. Optionally: triggers server-side account deletion via a pre-authenticated "panic endpoint"

**How:**
1. Client-side: keyboard listener for panic sequence
2. Server-side: `DELETE /api/auth/panic` endpoint that accepts a pre-shared panic token (set during registration)
3. No confirmation dialog — immediate action

**Why it kills:** User at a border crossing, laptop search, or emergency situation. One key combo and everything is gone. Signal has "disappearing messages" but nothing this immediate for local data.

**Effort:** ~6-8 hours
**Impact:** Physical security in hostile situations

---

### 12.6 🔐 Key Transparency Log

**What:** A public, append-only log of all public key changes. Any user (or automated monitor) can verify that their key hasn't been tampered with by the server.

**How:**
1. Server publishes a Merkle tree of all user public keys
2. On each key change, the new key is appended to the log
3. Clients can audit: "Is my current public key what the log says it should be?"
4. Third-party monitors can watch for unauthorized key changes

**Why it kills:** This is what Google Key Transparency and Apple's iMessage Contact Key Verification do. It makes MITM attacks by the server operator **detectable** — even if they inject a malicious public key, the change is logged and auditable.

**Effort:** ~30-40 hours
**Impact:** Cryptographic guarantee against server-side key manipulation

---

### 12.7 🎭 Anonymous Account Recovery via Secret Shares

**What:** Instead of email/phone recovery, users can split a recovery key into N shares using Shamir's Secret Sharing. They give shares to trusted contacts. To recover, M of N shares are needed.

**How:**
1. On registration, generate a recovery key
2. Split into 5 shares using Shamir's Secret Sharing (threshold: 3 of 5)
3. User distributes shares to 5 trusted contacts (via the encrypted messaging itself)
4. If locked out, collect 3 shares from contacts → reconstruct recovery key → regain access

**Why it kills:** Account recovery without ANY centralized authority or PII. No email, no phone, no security questions. Just trust your friends.

**Effort:** ~15-20 hours
**Impact:** Solves the "I forgot my password" problem without compromising anonymity

---

### 12.8 🛡️ Verifiable Builds + Code Integrity

**What:** Publish build hashes so users can verify the client code hasn't been tampered with.

**How:**
1. Reproducible Vite builds (pin all dependencies, use `npm ci`)
2. Publish SHA-256 hashes of each release's build artifacts
3. Browser extension that checks: "Is the JavaScript I'm executing the same hash as the published one?"
4. CI/CD pipeline that builds from source and compares hashes

**Why it kills:** This addresses the fundamental weakness of web-based E2E encryption: you're trusting the server to serve unmodified JavaScript. With verifiable builds, **anyone can verify** the code is clean.

**Effort:** ~10-15 hours (build pipeline + extension)
**Impact:** Addresses the #1 trust gap of web-based E2E encryption

---

### 12.9 📡 Mesh Mode (Serverless P2P via WebRTC)

**What:** Allow two users to communicate directly (peer-to-peer via WebRTC data channels) without any server involvement, once they've exchanged keys.

**How:**
1. Initial key exchange happens via the Blink server (as today)
2. Once keys are established, clients attempt a direct WebRTC data channel
3. If both users are online and NAT traversal succeeds, messages flow peer-to-peer
4. Server is completely bypassed — zero metadata, zero latency

**Why it kills:** **Zero-metadata messaging.** The server never sees message timestamps, sizes, or frequency. Only the two endpoints know they're communicating. Even the server operator has **zero** visibility.

**Effort:** ~30-40 hours (WebRTC data channels + fallback to server relay)
**Impact:** Maximum privacy — removes the server from the communication path entirely

---

### 12.10 🔇 Stealth Mode (Anti-Forensic)

**What:** An optional mode where the client leaves **zero traces** on the device:
1. Runs entirely in a private/incognito window
2. Uses `sessionStorage` only (cleared on tab close)
3. No IndexedDB, no localStorage, no cookies
4. Keys exist only in memory — closing the tab destroys everything

**How:**
1. Query parameter: `?stealth=true` activates stealth mode
2. All storage operations redirect to in-memory Map objects
3. Warning displayed: "Stealth mode — all data will be lost when you close this tab"
4. No message history, no key persistence — every session is a fresh start

**Why it kills:** Forensic investigators examining a seized device find zero evidence that Blink was ever used. Not even IndexedDB entries. Combined with Tor, this is **maximum deniability**.

**Effort:** ~10-12 hours
**Impact:** Anti-forensic capability for high-risk users

---

## 13. Conclusion

Blink-Text has a solid security foundation for a pre-launch product. The E2E encryption architecture, admin separation model, session enforcement, and anti-spam measures demonstrate security-conscious design. The team has clearly thought about threat models and legal compliance (as evidenced by PLAN.md).

**The most urgent fixes before public launch are:**

1. **🔴 Remove the default JWT secret** (C-1) — this is a one-line fix that prevents total server compromise
2. **🔴 Regenerate session nonce on password change** (C-2) — prevents stolen tokens from surviving credential rotation
3. **🔴 Add resource limits** (C-3, C-4, H-6) — prevents DoS via unbounded database/disk growth
4. **🟠 Add rate limits on DM creation, reports, and search** (H-3, H-4, H-2) — prevents spam and abuse

The privacy-enhancing features in Section 12 would elevate Blink from "a decent encrypted messenger" to "a genuinely differentiated privacy tool." The highest-impact additions would be:

- **Sealed Sender** (12.1) — eliminates sender metadata on the server
- **Verifiable Builds** (12.8) — addresses the #1 trust gap of web-based E2E
- **Dead Man's Switch** (12.4) — protects physically compromised users
- **Panic Button** (12.5) — immediate emergency data destruction

These features, combined with the existing username-only registration and self-hosting capability, would create a product that genuinely serves journalists, activists, and privacy-conscious users in ways Signal cannot.

---

*This audit was conducted via manual source code review. For production deployment, a formal penetration test and cryptographic audit by a third-party security firm is strongly recommended.*
