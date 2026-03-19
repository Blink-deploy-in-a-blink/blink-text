# Group E2E Encryption + Burner Rooms — Implementation Plan (v2)

**Status**: Draft  
**Depends on**: Disappearing Messages (done), existing ECDH 2-party crypto  
**Unlocks**: Group chats, Burner Rooms (R2), Multi-device (I6)  
**Estimated total**: ~65 hours across 6 phases

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Architecture Overview](#2-architecture-overview)
3. [Phase 1 — Sender Key Crypto Engine](#phase-1--sender-key-crypto-engine-15-hrs)
4. [Phase 2 — Server: Group Key Distribution + Unified Conversations](#phase-2--server-group-key-distribution--unified-conversations-12-hrs)
5. [Phase 3 — Client: Group Encrypt/Decrypt](#phase-3--client-group-encryptdecrypt-12-hrs)
6. [Phase 4 — Guest Sessions + Invite Links](#phase-4--guest-sessions--invite-links-12-hrs)
7. [Phase 5 — Client UI: Group/Room Creation + Join Page](#phase-5--client-ui-grouproom-creation--join-page-8-hrs)
8. [Phase 6 — Room Admin, Moderation + Help/How-To Updates](#phase-6--room-admin-moderation--helphow-to-updates-6-hrs)
9. [Key Rotation Protocol](#key-rotation-protocol)
10. [Security Considerations](#security-considerations)
11. [File Change Map](#file-change-map)
12. [Open Questions](#open-questions)

---

## 1. Problem Statement

**Current state**: ECDH P-256 is 2-party only. `_findLatestPeerEntry()` in `cryptoService.js` picks ONE peer — groups are fundamentally broken. The DB schema supports `group_chat` conversations, but they cannot be created or used.

**Goal**: Enable N-party encrypted conversations (groups) using a Sender Key protocol, then enable Burner Rooms (shareable invite link, no-signup guest access) as a **configuration of the same system** — not a separate feature.

**Two user types**:
- **Registered users**: Existing accounts with full auth, device keys, identity keys
- **Guest users**: Session-only, no account, temporary display name, PoW on join, can be kicked

---

## 2. Architecture Overview

### 2.1 Unified Model: Groups and Rooms Are the Same Thing

**Key insight**: A "burner room" is just a group conversation with `invite_enabled=1` and `allow_guests=1`. There is no separate `rooms` table.

| Feature | DM | Private Group | Burner Room |
|---------|-----|--------------|-------------|
| **DB type** | `direct_message` | `group_chat` | `group_chat` |
| **Invite link** | No | Optional (admin enables) | Always on |
| **Guest access** | No | No | Yes |
| **Expiry timer** | No | Optional | Optional |
| **Message timer** | Optional (existing) | Optional (same) | Optional (same) |
| **Max participants** | 2 | 2-50 (admin picks) | 2-50 (admin picks) |
| **Password** | No | No | Optional |
| **Encryption** | Pairwise ECDH | Sender Keys | Sender Keys |

The **only differences** are boolean flags on the same `conversations` row. Same DB, same queries, same crypto, same ChatWindow UI.

**Benefits over a separate `rooms` table**:
- No duplicate CRUD routes, no duplicate auth checks, no duplicate expiry cleanup
- "Convert a group into a room" = flip two flags
- One ChatWindow handles all types — just reads feature flags
- ~30% less code to write and maintain

### 2.2 New Columns on `conversations` Table

```sql
ALTER TABLE conversations ADD COLUMN slug TEXT UNIQUE;              -- NULL for DMs
ALTER TABLE conversations ADD COLUMN invite_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN allow_guests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN password_hash TEXT;            -- NULL = no password
ALTER TABLE conversations ADD COLUMN max_participants INTEGER NOT NULL DEFAULT 50;
ALTER TABLE conversations ADD COLUMN expires_at INTEGER;            -- NULL = no room expiry
ALTER TABLE conversations ADD COLUMN created_by TEXT;               -- user ID of creator
```

And a new column on `conversation_participants`:

```sql
ALTER TABLE conversation_participants ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
-- Valid roles: 'admin', 'member'
```

### 2.3 Sender Key Protocol (WhatsApp/Signal-style)

Each participant generates their own **Sender Key** (256-bit AES-GCM symmetric key) per group. They distribute it to every other member by encrypting it with a pairwise ECDH-derived key.

```
GROUP: Alice, Bob, Carol

Setup:
  Alice generates SK_alice (random 256-bit key)
  Alice establishes pairwise ECDH channels with Bob and Carol
  Alice encrypts SK_alice with pairwise_key(Alice, Bob) -> sends to Bob via server
  Alice encrypts SK_alice with pairwise_key(Alice, Carol) -> sends to Carol via server

Sending:
  Alice sends: encrypt(SK_alice, "hello") -> server broadcasts to group
  Bob decrypts with SK_alice
  Carol decrypts with SK_alice

Key property: Server only sees ciphertext. Never sees SK_alice or any pairwise key.
```

### 2.4 Why Sender Keys (not Fan-out or MLS)

| Approach | Send cost | Receive cost | Server sees |
|----------|-----------|--------------|-------------|
| **Fan-out** (encrypt once per recipient) | O(N) encryptions per message | O(1) decryption | N ciphertext blobs per message |
| **Sender Keys** (encrypt once, everyone decrypts) | O(1) encryption per message | O(1) decryption | 1 ciphertext blob per message |
| **MLS (Messaging Layer Security)** | O(1) encryption | O(1) decryption | 1 ciphertext + tree metadata |

Sender Keys win for our scale (groups up to 50 people). The O(N) cost moves to key distribution (one-time per join/leave), not per-message. MLS is better for 1000+ member groups but adds enormous protocol complexity.

### 2.5 Pairwise Channel Bootstrapping for Groups

**No existing DM required.** The pairwise channels are "virtual" — they exist only as ECDH handshakes namespaced under the group, not as real conversations.

```javascript
// Deterministic pairwise ID for sender key distribution
function pairwiseId(conversationId, userIdA, userIdB) {
  const sorted = [userIdA, userIdB].sort();
  return `${conversationId}:pair:${sorted[0]}:${sorted[1]}`;
}
```

**How bootstrapping works**:
1. Alice creates a group with Bob and Carol
2. For each member, a virtual pairwise ECDH handshake runs (same mechanism as DMs — ephemeral keypairs, published to server, HKDF derivation) but under the virtual pairwise ID
3. Bob's side completes when Bob **first opens the group** (lazy — same retry logic as existing DMs)
4. Once the pairwise channel is up, sender keys are distributed through it
5. These pairwise channels are used **only** for sender key encryption — never for messages

### 2.6 Guest Users

Guests get a **temporary session token** (JWT scoped to the conversation, short-lived). They generate ephemeral ECDH + identity keys in the browser just like registered users, but:
- No `users` table entry — separate `guest_sessions` table
- No password, no username persistence
- Session dies when browser closes or conversation expires
- PoW challenge on join to prevent spam
- Can be kicked by room admin

---

## Phase 1 — Sender Key Crypto Engine (~15 hrs)

### 1A. New types

Add to `packages/crypto/src/types.ts`:

```typescript
export interface SenderKeyBundle {
  senderKey: Uint8Array;       // 256-bit AES-GCM key
  keyGeneration: number;       // increments on rotation
  signature: string;           // ECDSA signature of (senderKey + keyGeneration + conversationId)
}

export interface EncryptedSenderKey {
  encryptedKey: string;        // base64 AES-GCM ciphertext (sender key encrypted with pairwise key)
  iv: string;                  // base64 12-byte IV
  keyGeneration: number;
  signature: string;           // ECDSA signature for authentication
}
```

### 1B. New CryptoProvider methods

Add to `CryptoProvider` interface:

```typescript
/** Generate a random 256-bit sender key for group encryption. */
generateSenderKey(): Promise<Uint8Array>;

/** Encrypt a sender key using a pairwise key (for distribution to a group member). */
encryptSenderKey(pairwiseKey: Uint8Array, senderKey: Uint8Array): Promise<{ ciphertext: string; iv: string }>;

/** Decrypt a sender key received from a peer. */
decryptSenderKey(pairwiseKey: Uint8Array, ciphertext: string, iv: string): Promise<Uint8Array>;
```

### 1C. Browser + Node provider implementations

In `packages/crypto/src/provider/browser.ts` and `node.ts`:

```typescript
async generateSenderKey(): Promise<Uint8Array> {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

async encryptSenderKey(pairwiseKey: Uint8Array, senderKey: Uint8Array) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', pairwiseKey, 'AES-GCM', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, senderKey);
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

async decryptSenderKey(pairwiseKey: Uint8Array, ciphertext: string, iv: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', pairwiseKey, 'AES-GCM', false, ['decrypt']);
  const ciphertextBytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, cryptoKey, ciphertextBytes);
  return new Uint8Array(decrypted);
}
```

### 1D. CryptoEngine facade

Add 3 passthrough methods to `packages/crypto/src/engine.ts`:

```typescript
generateSenderKey(): Promise<Uint8Array> { return this.provider.generateSenderKey(); }
encryptSenderKey(pairwiseKey: Uint8Array, senderKey: Uint8Array) { return this.provider.encryptSenderKey(pairwiseKey, senderKey); }
decryptSenderKey(pairwiseKey: Uint8Array, ciphertext: string, iv: string) { return this.provider.decryptSenderKey(pairwiseKey, ciphertext, iv); }
```

### 1E. Group encrypt/decrypt

No new methods needed — existing `encryptMessage(senderKey, plaintext)` and `decryptMessage(senderKey, payload)` work with any 256-bit key. The sender key IS the symmetric key for AES-256-GCM. Chain ratchet is per-sender-key (same HKDF mechanism as DMs, providing forward secrecy per message).

### 1F. Tests

- Unit test: generate sender key, encrypt with pairwise key, decrypt on other side
- Unit test: encrypt message with sender key, decrypt with same key
- Unit test: sender key rotation (new generation, old key cannot decrypt new messages)

**Files modified**:
| File | Change |
|------|--------|
| `packages/crypto/src/types.ts` | Add `SenderKeyBundle`, `EncryptedSenderKey`, 3 new provider methods |
| `packages/crypto/src/engine.ts` | Add 3 facade methods |
| `packages/crypto/src/provider/browser.ts` | Implement 3 methods |
| `packages/crypto/src/provider/node.ts` | Implement 3 methods |

---

## Phase 2 — Server: Group Key Distribution + Unified Conversations (~12 hrs)

### 2A. Database migration

Add to `apps/server/db.js`:

**New table** — `group_sender_keys`:
```sql
CREATE TABLE IF NOT EXISTS group_sender_keys (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL,          -- registered user ID or guest session ID
  recipient_user_id TEXT NOT NULL,       -- who this encrypted copy is for
  encrypted_sender_key TEXT NOT NULL,    -- base64 AES-GCM ciphertext
  iv TEXT NOT NULL,                      -- base64 12-byte IV
  key_generation INTEGER NOT NULL DEFAULT 0,
  signature TEXT,                        -- ECDSA signature for authentication
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_gsk_recipient
  ON group_sender_keys(conversation_id, recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_gsk_sender
  ON group_sender_keys(conversation_id, sender_user_id, key_generation);
```

**New table** — `guest_sessions` (needed later in Phase 4, but created now for FK safety):
```sql
CREATE TABLE IF NOT EXISTS guest_sessions (
  id TEXT PRIMARY KEY,                      -- UUID, used as "user ID" in conversation_participants
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,               -- self-chosen, 1-32 chars
  token_hash TEXT NOT NULL,                 -- bcrypt hash of the JWT (for revocation)
  ip_hash TEXT,                             -- hashed IP for moderation
  pow_nonce TEXT,                           -- proof-of-work nonce submitted on join
  is_kicked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_conversation
  ON guest_sessions(conversation_id);
```

**New columns on `conversations`** (safe migration pattern with PRAGMA table_info):
```sql
slug TEXT UNIQUE DEFAULT NULL
invite_enabled INTEGER NOT NULL DEFAULT 0
allow_guests INTEGER NOT NULL DEFAULT 0
password_hash TEXT DEFAULT NULL
max_participants INTEGER NOT NULL DEFAULT 50
expires_at INTEGER DEFAULT NULL
created_by TEXT DEFAULT NULL
```

**New column on `conversation_participants`**:
```sql
role TEXT NOT NULL DEFAULT 'member'
```

### 2B. Sender key REST endpoints

Create `apps/server/routes/group-keys.js`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/conversations/:id/sender-keys` | GET | Get all encrypted sender key copies for the current user |
| `POST /api/conversations/:id/sender-keys` | POST | Store encrypted sender key copies for each recipient |
| `DELETE /api/conversations/:id/sender-keys/:senderUserId` | DELETE | Delete a removed member's sender keys (key rotation) |

### 2C. Update conversation creation

Update `routes/conversations.js` POST:

- When `type === 'group_chat'`:
  - Creator gets `role='admin'` in `conversation_participants`
  - Accept new fields: `maxParticipants`, `expiresIn` (duration in ms), `password`, `inviteEnabled`, `allowGuests`
  - If `inviteEnabled` or `allowGuests`: generate a `slug` (8 chars, alphanumeric, URL-safe)
  - Set `expires_at = Date.now() + expiresIn` if provided
  - Hash `password` with bcrypt if provided
  - Return all fields including `slug` and computed `shareUrl`

### 2D. Public room info endpoint

New endpoint (no auth required):

```
GET /api/conversations/join/:slug
```

Returns public info: `{ name, participantCount, maxParticipants, hasPassword, expiresAt, isOpen }`.
Does NOT return messages, keys, or participant details.

### 2E. Invite link management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `PUT /api/conversations/:id/invite` | PUT | Enable/disable invite link, regenerate slug |
| `GET /api/conversations/:id/invite` | GET | Get current invite link + settings |

### 2F. WebSocket events for real-time key distribution

New socket events in `websocket.js`:

```
sender_key_distributed ->
  Payload: { conversationId, senderUserId, keyGeneration }
  To: all other participants in the conversation room.

sender_key_request ->
  Payload: { conversationId, requestingUserId }
  To: all existing participants (so they send their sender keys to the new member).
```

### 2G. Conversation expiry cleanup

Extend the existing 30s expiry interval in `websocket.js`:

```javascript
// In addition to expired messages, also check for expired conversations:
// SELECT id FROM conversations WHERE expires_at IS NOT NULL AND expires_at <= ?
// For each: delete media files from disk, CASCADE deletes everything
// Notify connected clients: 'conversation_expired' event
```

### 2H. Slug generation

```javascript
function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}
```

**Files modified**:
| File | Change |
|------|--------|
| `apps/server/db.js` | `group_sender_keys` table, `guest_sessions` table, new columns on conversations + participants |
| `apps/server/routes/group-keys.js` | **New file** — sender key CRUD |
| `apps/server/routes/conversations.js` | Group creation with flags, public slug lookup, invite endpoints |
| `apps/server/websocket.js` | Sender key events, conversation expiry cleanup |
| `apps/server/app.js` | Register group-keys route |

---

## Phase 3 — Client: Group Encrypt/Decrypt (~12 hrs)

### 3A. Sender Key Manager

Create `apps/web-client/src/services/groupCrypto.js`:

**In-memory state**:
```javascript
// conversationId -> { mySenderKey: Uint8Array, myKeyGeneration: number }
const mySenderKeys = new Map();

// conversationId -> Map<senderUserId, { senderKey: Uint8Array, keyGeneration: number }>
const peerSenderKeys = new Map();

// conversationId -> Map<senderUserId, { sendChainKey, sendCounter }>
const groupSendChains = new Map();
```

**Key functions**:

```javascript
/**
 * Initialize group crypto for a conversation.
 * 1. Generate my sender key (or load from IndexedDB)
 * 2. For each other participant, establish virtual pairwise ECDH channel
 * 3. Encrypt my sender key with each pairwise key
 * 4. POST encrypted copies to server
 * 5. Fetch other participants' encrypted sender keys for me
 * 6. Decrypt them using pairwise keys
 */
export async function setupGroupKeys(conversationId, myUserId, participantIds)

/**
 * Called when sender_key_distributed event arrives via socket.
 * Fetches the new encrypted sender key from server, decrypts it.
 */
export async function handleSenderKeyDistributed(conversationId, senderUserId)

/**
 * Encrypt a message for the group using MY sender key.
 * Uses chain ratchet for per-message forward secrecy.
 */
export async function encryptGroupMessage(conversationId, plaintext)

/**
 * Decrypt a group message using the SENDER's key.
 * Looks up senderUserId in peerSenderKeys.
 */
export async function decryptGroupMessage(conversationId, senderUserId, encryptedPayload)

/**
 * Rotate my sender key (called when a member is removed/kicked).
 * Generates new key, redistributes to remaining members.
 */
export async function rotateMySenderKey(conversationId, myUserId, remainingParticipantIds)

/**
 * Clean up all group crypto state for a conversation (on leave/expiry).
 */
export async function clearGroupKeys(conversationId)
```

### 3B. Integration with existing cryptoService.js

Update `encryptForConversation` and `decryptConversationMessage` to route based on conversation type:

```javascript
export async function encryptForConversation(conversationId, plaintext) {
  if (isGroupConversation(conversationId)) {
    return encryptGroupMessage(conversationId, plaintext);
  }
  // ... existing DM logic (unchanged)
}

export async function decryptConversationMessage(conversationId, encryptedPayload) {
  if (isGroupConversation(conversationId)) {
    return decryptGroupMessage(conversationId, encryptedPayload.senderUserId, encryptedPayload);
  }
  // ... existing DM logic (unchanged)
}
```

A simple `conversationTypes` Map tracks which conversations are groups (populated from API response when conversations load).

### 3C. Chain ratchet for groups

Each sender key gets its own chain ratchet (same HKDF mechanism as DMs):

```
Root: SK_alice (sender key)
Chain step 0: HKDF(SK_alice) -> messageKey_0, chainKey_1
Chain step 1: HKDF(chainKey_1) -> messageKey_1, chainKey_2
...
```

The receiver re-derives from the sender key using `chainIdx` in the message payload — identical to existing DM chain ratchet code. The `senderUserId` field tells the receiver which sender key to use.

### 3D. Group key setup flow (step by step)

```
User opens group conversation for first time:
  1. cryptoService detects type === 'group_chat'
  2. Calls setupGroupKeys(conversationId, myUserId, participantIds)
  3. setupGroupKeys:
     a. Generate mySenderKey = engine.generateSenderKey()
     b. Save to IndexedDB under key "group-sk-{conversationId}"
     c. For each other participant P:
        i.   Compute virtualId = pairwiseId(conversationId, myUserId, P)
        ii.  Run setupConversationKey(virtualId, myUserId) — same ECDH as DMs
        iii. Get pairwise key from conversationKeys map
        iv.  encryptedCopy = engine.encryptSenderKey(pairwiseKey, mySenderKey)
        v.   POST to /api/conversations/:id/sender-keys
     d. Emit sender_key_distributed via socket
     e. Fetch MY encrypted sender keys from server (from other participants)
     f. For each received key:
        i.   Get pairwise key with that sender
        ii.  Decrypt: peerSK = engine.decryptSenderKey(pairwiseKey, ...)
        iii. Store in peerSenderKeys map + IndexedDB
  4. Ready to encrypt/decrypt group messages
```

### 3E. API additions

Add to `apps/web-client/src/services/api.js`:

```javascript
export async function getSenderKeys(conversationId) { ... }
export async function storeSenderKeys(conversationId, keys) { ... }
export async function deleteSenderKeys(conversationId, senderUserId) { ... }
export async function getConversationBySlug(slug) { ... }    // public, no auth
export async function joinConversationBySlug(slug, body) { ... }
export async function updateInviteSettings(conversationId, settings) { ... }
```

**Files modified**:
| File | Change |
|------|--------|
| `apps/web-client/src/services/groupCrypto.js` | **New file** — sender key management + group encrypt/decrypt |
| `apps/web-client/src/services/cryptoService.js` | Route group conversations to groupCrypto |
| `apps/web-client/src/services/api.js` | Sender key + invite API calls |
| `apps/web-client/src/services/socket.js` | sender_key_distributed, sender_key_request events |
| `apps/web-client/src/hooks/useMessages.js` | Handle sender key socket events |

---

## Phase 4 — Guest Sessions + Invite Links (~12 hrs)

### 4A. Guest authentication middleware

New middleware in `apps/server/auth.js`:

```javascript
/**
 * Authenticate either a registered user JWT or a guest session JWT.
 * Sets req.user = { id, type: 'registered'|'guest', conversationId? }
 */
function authenticateAnyToken(req, res, next) {
  // 1. Verify JWT as normal
  // 2. If token has 'guestId' claim -> look up guest_sessions, check not kicked
  // 3. If token has standard 'id' claim -> existing registered user flow
  // 4. Set req.user.type so routes can distinguish
}
```

### 4B. Join endpoint

Add to `routes/conversations.js`:

```
POST /api/conversations/join/:slug
  Auth: none (public)
  Body: { displayName, password?, powNonce, powHash }
  Validates:
    - Conversation exists and has a valid slug
    - allow_guests=1 (or user is logged in as registered user)
    - Room not full (participant count < max_participants)
    - Room not expired
    - Password matches (if password_hash is set)
    - PoW valid
    - Display name: 1-32 chars, sanitized
  Creates:
    - guest_sessions row
    - conversation_participants row (role='member')
  Returns:
    - { token (short-lived guest JWT), guestSessionId, conversationId }
    - JWT claims: { guestId, conversationId, type: 'guest', displayName }
```

### 4C. WebSocket authentication for guests

Update `websocket.js` io.use() middleware:

```javascript
// Current: jwt.verify -> look up users table
// New: jwt.verify -> if token.type === 'guest', look up guest_sessions instead
// Guest sockets can only join their specific conversation
// Guest sockets have the same send_message/key_exchange capabilities as registered users
```

### 4D. PoW for guest joins

Reuse existing PoW mechanism (`powService.js` + `pow-worker.js`):

```
GET  /api/conversations/join/:slug/challenge  -> { challenge, difficulty }
POST /api/conversations/join/:slug            -> validate PoW alongside other join fields
```

### 4E. Guest session client service

New service: `apps/web-client/src/services/guestSession.js`:

```javascript
// Store guest token in sessionStorage (dies on tab close — intentional)
// Initialize identity + ECDH keys (same flow as registered users)
// Set up group crypto (sender key exchange)
// Handle 'kicked' socket event -> show modal, redirect to join page
// Handle conversation expiry -> show modal, redirect
// Provide isGuest() helper for UI components
```

### 4F. Guest cleanup

- Guest sessions with `last_seen_at` older than 24h are auto-deleted
- When a conversation expires, CASCADE deletes all guest sessions
- When a guest is kicked, their sender keys are deleted + key rotation triggers for all remaining members

**Files modified**:
| File | Change |
|------|--------|
| `apps/server/auth.js` | `authenticateAnyToken` middleware |
| `apps/server/routes/conversations.js` | Join endpoint, PoW challenge endpoint |
| `apps/server/websocket.js` | Guest auth in io.use(), guest cleanup in expiry interval |
| `apps/web-client/src/services/guestSession.js` | **New** — guest token management |

---

## Phase 5 — Client UI: Group/Room Creation + Join Page (~8 hrs)

### 5A. Updated "New Conversation" modal

The existing `NewConversationModal.jsx` gets **three tabs**:

```
[ DM ]  [ Group ]  [ Room ]
```

**DM tab** (existing, unchanged):
- Username input
- Auto-delete timer dropdown
- [Create] button

**Group tab** (new):
- Group name input (required, 1-64 chars)
- Add members by username (multi-input, search-and-add)
- Auto-delete timer dropdown (same as DM: Off, 5min, 1hr, 24hr, 7d, 30d)
- Room expiry dropdown (Off, 1hr, 24hr, 7d, 30d — when the group itself is permanently deleted)
- Max participants slider (2-50, default 20)
- [Create Group] button

**Room tab** (new):
- Room name input (required, 1-64 chars)
- Auto-delete timer dropdown (same)
- Room expiry dropdown (same)
- Max participants slider (2-50, default 20)
- Password toggle + input (optional)
- [Create Room] button -> immediately shows invite link + copy button

**Key difference between Group and Room**: Group tab asks for usernames. Room tab gives you a link to share instead.

After creation, both look **identical** in the sidebar and chat view.

### 5B. Join Room page

New component: `apps/web-client/src/components/JoinRoomPage.jsx`

- Route: `/#/r/:slug` (hash-based routing)
- Shows room name, participant count, expiry countdown
- Display name input (required, 1-32 chars)
- Password input (shown only if room requires one)
- PoW spinner while solving challenge
- [Join Room] button
- On success: stores guest token in sessionStorage, redirects to chat view
- If already logged in: offer "Join as [username]" (join as registered user, no guest session needed)

### 5C. App.jsx routing

```jsx
// On load: check window.location.hash for /#/r/:slug
// If match + logged in: prompt "Join as [username]?"
// If match + not logged in: show JoinRoomPage (join as guest)
// After joining: set activeConversation, show ChatWindow
```

### 5D. ConversationList updates

- Group/room conversations show a group icon instead of user initials
- Participant count badge (e.g. "3/20")
- Room expiry countdown badge (alongside existing message timer badge)
- Context menu: "Copy Invite Link" (for conversations with invite enabled)
- Context menu: "Room Settings" (admin only, for groups/rooms)

### 5E. ChatWindow updates for groups/rooms

**Header area**:
- Shows group/room name + participant count (clickable to expand member list)
- Settings gear icon (admin only)
- Sub-header: "Expires in 23h 41m" (if room expiry set) + "Messages delete: 24hr" (if message timer set)
- "Share Invite Link" copy button (visible if invite_enabled)

**Member list panel** (expandable side panel or dropdown):
- All participants with role badges: Admin / Member / Guest
- Admin sees "Kick" button next to each non-admin member
- Online/offline indicator per member

**Message bubbles**:
- Group messages show sender name above each bubble (not needed in DMs)
- Guest users show a subtle "Guest" badge next to their display name

**Leave option**:
- "Leave Group" / "Leave Room" in settings dropdown

### 5F. Invite link display

When admin creates a group/room with invite enabled, or enables it later:
- Invite link shown in a copyable field in the group/room header area
- Format: `https://your-domain.com/#/r/{slug}`
- Copy button with "Copied!" confirmation

**Files created/modified**:
| File | Change |
|------|--------|
| `apps/web-client/src/components/NewConversationModal.jsx` | Add Group + Room tabs |
| `apps/web-client/src/components/JoinRoomPage.jsx` | **New** — public join page |
| `apps/web-client/src/App.jsx` | `/#/r/:slug` routing, guest session state |
| `apps/web-client/src/components/ConversationList.jsx` | Group icon, member count, invite link, expiry badge |
| `apps/web-client/src/components/ChatWindow.jsx` | Room header, member list, invite link, sender name on messages, kick UI |

---

## Phase 6 — Room Admin, Moderation + Help/How-To Updates (~6 hrs)

### 6A. Room settings (admin only)

Endpoint: `PUT /api/conversations/:id/settings`

```json
{
  "name": "New Room Name",
  "maxParticipants": 30,
  "inviteEnabled": true,
  "allowGuests": false,
  "password": "new-password-or-null",
  "disappearAfter": 3600000,
  "expiresAt": 1742700000000
}
```

New component: `RoomSettingsModal.jsx` — accessible from the gear icon in group/room header.

### 6B. Kick member

- Admin clicks "Kick" next to a user in the member list
- `POST /api/conversations/:id/kick` with `{ userId }`
- Server: sets `is_kicked=1` (if guest), removes from `conversation_participants`
- Server: deletes kicked user's sender key copies, emits `sender_key_rotated` event
- Server: emits `user_kicked` event to conversation room
- All participants see "[Name] was removed" system message
- Kicked user: modal "You have been removed", redirect

### 6C. Close/reopen room

- Admin toggles `invite_enabled=0` to stop new joins via link
- Existing members stay, no one new can join
- Useful for "lock the room" once everyone has joined

### 6D. Report guest

- Existing report mechanism extended to accept guest session IDs
- Admin panel shows guest reports with hashed IP, display name, room context

### 6E. Invite link regeneration

- Admin can regenerate slug (invalidates old link)
- Admin can disable invite link entirely (sets `invite_enabled=0`)

---

### 6F. HelpPage.jsx updates

**New section** — "Groups & Rooms" (add after existing "Features" section):

```
### Groups
- Click + New, select the Group tab
- Enter a group name, add members by username
- Optionally set an auto-delete timer (messages) and/or room expiry (whole group)
- Group creator is the admin — can kick members, change settings, enable invite links
- All messages are end-to-end encrypted using Sender Keys
- Max 50 participants per group

### Burner Rooms
- Click + New, select the Room tab
- Enter a room name, set timers, optionally add a password
- Share the invite link with anyone — they can join without creating an account
- Guests choose a temporary display name and solve a quick security puzzle to join
- Room admin can kick guests, close the room to new joins, or change settings
- If a room expiry is set, the room and ALL data are permanently deleted when it expires

### Invite Links
- Group admins can enable an invite link via Room Settings
- Anyone with the link can join (if the room allows guests) or request to join (if registered-only)
- Admin can regenerate the link to invalidate old ones, or disable it entirely
```

**Update existing sections**:

- "2. Start a conversation" — update to mention: "Click + New. Choose between a DM (one-on-one), Group (add members by username), or Room (shareable invite link)."

- "How Encryption Works" — add paragraph:
  > For group conversations and rooms, Blink uses a **Sender Key** protocol. Each member generates
  > their own encryption key and distributes it to other members through secure pairwise channels.
  > When you send a message, it's encrypted once with your sender key — all members can decrypt it,
  > but the server still never sees the plaintext. When a member leaves or is kicked, all remaining
  > members rotate their keys so the removed person cannot read future messages.

**Update FAQ section**:

- Change "Are group chats supported?" answer from "Not yet..." to:
  > Yes! You can create encrypted group chats with up to 50 members. Click + New and select the
  > Group tab. All group messages use Sender Key encryption — the server never sees your content.

- Add new FAQ items:
  - **"How do burner rooms work?"**
    > Burner rooms let anyone join via a shareable link — no account needed. Guests pick a
    > temporary display name and solve a security puzzle. The room admin can kick guests,
    > lock the room, or set it to auto-expire. All messages are still end-to-end encrypted.

  - **"Can guests read messages sent before they joined?"**
    > Guests receive encrypted messages from the point they join onward. They cannot decrypt
    > messages sent before they joined because they didn't have the sender keys at that time.

  - **"What happens when a room expires?"**
    > The room and ALL its data — messages, media, encryption keys, guest sessions — are
    > permanently deleted from the server. This is irreversible.

  - **"What happens when someone is kicked from a group?"**
    > They are immediately removed and all remaining members rotate their encryption keys.
    > The kicked person cannot read any new messages sent after their removal.

### 6G. WelcomePage.jsx updates

Update the feature pills row:

```jsx
// Current:
{ icon: <ShieldCheck />, text: 'AES-256-GCM encryption' },
{ icon: <Zap />, text: 'Real-time delivery' },
{ icon: <Lock />, text: 'Zero-knowledge server' },

// Updated — add:
{ icon: <Users />, text: 'Encrypted group chats' },
{ icon: <LinkIcon />, text: 'Shareable room links' },
```

Update the info row — add or replace one card:

```jsx
{ title: 'No signup to join', desc: 'Share a room link. Anyone can join without creating an account.' },
```

### 6H. PrivacyPolicy.jsx updates

Add a new section about guest sessions:

```
### Guest Sessions (Burner Rooms)
When you join a room as a guest (without an account), we store:
- Your chosen display name (temporary, deleted when the room expires or you leave)
- A hash of your IP address (for abuse prevention — we never store your raw IP)
- Your session token hash (for authentication during your session)
- Timestamps (when you joined, last activity)

Guest session data is automatically deleted when:
- The room expires
- You are kicked by the room admin
- Your session has been inactive for 24 hours
- You close your browser tab

We do NOT store any guest data permanently. No account is created.
```

### 6I. TermsOfService.jsx updates

Add a section about room conduct:

```
### Room Conduct & Guest Access
- Room administrators may remove (kick) any participant at their discretion
- Guests joining via invite links must provide a display name and complete a security challenge
- Abuse of the room system (spam, harassment, illegal content) may result in IP-based restrictions
- Room creators are responsible for the content shared in rooms they create
- Rooms with expiry timers will be permanently deleted, along with all content, at the set time
```

---

**Files created/modified in Phase 6**:
| File | Change |
|------|--------|
| `apps/server/routes/conversations.js` | Settings endpoint, kick endpoint, close/reopen |
| `apps/server/websocket.js` | `user_kicked` event, key rotation trigger |
| `apps/web-client/src/components/RoomSettingsModal.jsx` | **New** — admin settings modal |
| `apps/web-client/src/components/ChatWindow.jsx` | Kick UI, room lock indicator |
| `apps/web-client/src/components/ConversationList.jsx` | Room settings context menu |
| `apps/web-client/src/components/HelpPage.jsx` | New "Groups & Rooms" section, updated "Start a conversation", updated "How Encryption Works", 4 new FAQ items, updated existing FAQ answer |
| `apps/web-client/src/components/WelcomePage.jsx` | New feature pills, updated info row |
| `apps/web-client/src/components/PrivacyPolicy.jsx` | Guest session data disclosure section |
| `apps/web-client/src/components/TermsOfService.jsx` | Room conduct + guest responsibilities section |

---

## Key Rotation Protocol

### When to rotate

| Event | Action |
|-------|--------|
| Member removed/kicked | ALL remaining members generate new sender keys and redistribute |
| Member leaves voluntarily | Same as removed |
| New member joins | Existing members send their CURRENT sender keys to the new member (no rotation needed) |
| Admin triggers manual rotation | All members generate new sender keys |

### Rotation flow

```
Carol is removed from group (Alice, Bob, Carol):
  1. Server removes Carol from conversation_participants
  2. Server deletes Carol's sender key copies from group_sender_keys
  3. Server emits 'member_removed' event to conversation room
  4. Alice and Bob each:
     a. Delete Carol's sender key from peerSenderKeys
     b. Generate NEW mySenderKey (new generation number)
     c. Encrypt new key for each remaining member
     d. POST to server, emit sender_key_distributed
  5. Carol's old sender keys are gone — she can't decrypt new messages
```

### Forward secrecy after removal

Chain ratchet ensures even if Carol retained old sender keys, she can only derive message keys up to the chain counter at removal time. New sender keys = new chain = old chain keys useless.

---

## Security Considerations

### Threat model

| Threat | Mitigation |
|--------|-----------|
| Server reads messages | Impossible — server only has ciphertext encrypted with sender keys it never sees |
| Removed member reads new messages | Key rotation generates completely new sender keys |
| Guest spams rooms | PoW on join, rate limiting on socket, admin kick |
| Room link leaked | Optional password, admin can close room, admin can kick strangers |
| IP logging for guests | IPs hashed with rotating daily salt. Admin sees hashed IPs, never raw |
| Compromised sender key | Chain ratchet limits damage. Key rotation replaces key entirely |
| Guest impersonation | Display names are not unique, but crypto identity (sender key) is unforgeable |

### What the server knows

- Who is in which conversation (participant lists)
- When messages are sent (timestamps)
- Message sizes (ciphertext length)
- Guest IP hashes
- Conversation metadata (name, expiry, participant count)

### What the server NEVER knows

- Message content (plaintext)
- Sender keys
- Pairwise ECDH shared secrets
- Private keys of any kind

---

## File Change Map (Complete Summary)

### New files (5)

| File | Purpose |
|------|---------|
| `apps/server/routes/group-keys.js` | Sender key CRUD endpoints |
| `apps/web-client/src/services/groupCrypto.js` | Sender key management, group encrypt/decrypt |
| `apps/web-client/src/services/guestSession.js` | Guest token storage, identity init |
| `apps/web-client/src/components/JoinRoomPage.jsx` | Public room join page |
| `apps/web-client/src/components/RoomSettingsModal.jsx` | Room admin settings modal |

### Modified files (17)

| File | Change |
|------|--------|
| `packages/crypto/src/types.ts` | `SenderKeyBundle`, `EncryptedSenderKey`, 3 provider methods |
| `packages/crypto/src/engine.ts` | 3 facade methods |
| `packages/crypto/src/provider/browser.ts` | 3 method implementations |
| `packages/crypto/src/provider/node.ts` | 3 method implementations |
| `apps/server/db.js` | `group_sender_keys` + `guest_sessions` tables, conversation columns, participant role |
| `apps/server/app.js` | Register group-keys route |
| `apps/server/auth.js` | `authenticateAnyToken` middleware |
| `apps/server/websocket.js` | Guest auth, sender key events, conversation expiry, kick event |
| `apps/server/routes/conversations.js` | Group flags, join endpoint, invite, kick, settings |
| `apps/web-client/src/services/cryptoService.js` | Route groups to groupCrypto |
| `apps/web-client/src/services/api.js` | Sender key + invite + room API calls |
| `apps/web-client/src/services/socket.js` | Sender key + room events |
| `apps/web-client/src/hooks/useMessages.js` | Group key socket events |
| `apps/web-client/src/App.jsx` | `/#/r/:slug` routing, guest state |
| `apps/web-client/src/components/NewConversationModal.jsx` | Group + Room tabs |
| `apps/web-client/src/components/ConversationList.jsx` | Group icon, member count, invite, expiry badge |
| `apps/web-client/src/components/ChatWindow.jsx` | Room header, member list, invite link, sender name, kick |
| `apps/web-client/src/components/HelpPage.jsx` | Groups & Rooms section, updated FAQ, encryption docs |
| `apps/web-client/src/components/WelcomePage.jsx` | Feature pills + info row |
| `apps/web-client/src/components/PrivacyPolicy.jsx` | Guest session disclosure |
| `apps/web-client/src/components/TermsOfService.jsx` | Room conduct section |

---

## Build Order

```
Phase 1 (Crypto Engine)              ── no dependencies, start immediately
    |
Phase 2 (Server: Keys + Unified)     ── depends on Phase 1 types
    |
Phase 3 (Client: Group Crypto)       ── depends on Phase 1 + 2
    |                                    MILESTONE 1: Groups work between registered users
Phase 4 (Guest Sessions)             ── depends on Phase 2 (can overlap with Phase 3)
    |
Phase 5 (Client UI)                  ── depends on Phase 3 + 4
    |                                    MILESTONE 2: Full UI + burner rooms + guest access
Phase 6 (Admin + Help + Docs)        ── depends on Phase 5
                                         MILESTONE 3: Polish, moderation, updated help/legal docs
```

---

## Open Questions

1. **Max group size**: 50 is the current plan. Good enough?
2. **Guest display name uniqueness**: Allow duplicates? (Recommend: allow dupes, show color suffix)
3. **Room creation by guests**: Registered-only for v1? (Recommend: yes, prevents spam)
4. **Backward compat**: Existing DMs completely unaffected — group crypto is a parallel code path.
5. **Key-in-URL-fragment**: Skip it — use sender key protocol. URL is just the room slug.
6. **Anything else** to add or change before coding?
