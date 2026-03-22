# Room & Group Encryption Fix Plan

> **Status**: Planning — no implementation yet  
> **Goal**: Fix all identified flaws so rooms work end-to-end with proper E2E encryption  
> **Flaw #1 (MaintenancePage)**: Intentional kill switch while rooms are broken. Removed last, after all other fixes are verified.

---

## Table of Contents

1. [Flaw Summary](#flaw-summary)
2. [Phase 1 — Guest userId Fix (Flaw #2)](#phase-1--guest-userid-fix-flaw-2)
3. [Phase 2 — Real Pairwise ECDH for Group Sender Key Wrapping (Flaw #4)](#phase-2--real-pairwise-ecdh-for-group-sender-key-wrapping-flaw-4)
4. [Phase 3 — Sender Key Catch-Up for Late Joiners (Flaw #5)](#phase-3--sender-key-catch-up-for-late-joiners-flaw-5)
5. [Phase 4 — Global Socket Handlers for Sender Key Events (Flaw #6)](#phase-4--global-socket-handlers-for-sender-key-events-flaw-6)
6. [Phase 5 — Guest Crypto State Resilience (Flaw #7)](#phase-5--guest-crypto-state-resilience-flaw-7)
7. [Phase 6 — Remove Room Kill Switch (Flaw #1)](#phase-6--remove-room-kill-switch-flaw-1)
8. [Verification Checklist](#verification-checklist)

---

## Flaw Summary

| # | Flaw | Severity | Phase |
|---|------|----------|-------|
| 2 | `_getCurrentUserId()` returns `null` for guests | 🔴 Critical | 1 |
| 4 | Wrapping keys are deterministic HKDF, not real ECDH | 🟠 Medium | 2 |
| 5 | No sender key catch-up for late joiners | 🟠 Medium | 3 |
| 6 | `sender_key_distributed`/`request` only handled in active conversation | 🟡 Low-Med | 4 |
| 7 | Guest in-memory crypto state lost on remount | 🟡 Low | 5 |
| 1 | Room route hardcoded to `<MaintenancePage />` | 🔴 Critical | 6 (last) |

---

## Phase 1 — Guest userId Fix (Flaw #2)

**Problem**: `groupCrypto.js` → `_getCurrentUserId()` reads `localStorage.getItem('blink-user')`, which is never set for guests. Returns `null`. This breaks `decryptGroupMessage()` and `decryptGroupMedia()` because they can't determine if the sender is "me".

### Changes

#### 1A. `apps/web-client/src/services/groupCrypto.js`

**Replace `_getCurrentUserId()` (lines 670-678) with guest-aware version:**

```javascript
function _getCurrentUserId() {
  try {
    // Registered user
    const raw = localStorage.getItem('blink-user');
    if (raw) return JSON.parse(raw).id;
    // Guest user
    const guestRaw = sessionStorage.getItem('blink-guest-session');
    if (guestRaw) return JSON.parse(guestRaw).guestSessionId;
    return null;
  } catch {
    return null;
  }
}
```

**Why this works**: Guest session is saved to `sessionStorage` under `blink-guest-session` by `guestSession.js` → `saveGuestSession()`, which stores `{ guestSessionId, conversationId, ... }`. The `guestSessionId` is the UUID the server assigned as the guest's participant ID.

**Why not pass userId as a parameter**: `_getCurrentUserId()` is called from `decryptGroupMessage()` and `decryptGroupMedia()`, which are called from `cryptoService.js`'s `decryptConversationMessage()` and `decryptMediaForConversation()`. These are called by `useMessages.js`'s `decryptBatch()` which maps over raw messages. Threading `myUserId` down through all these layers would require changing the signatures of 6+ exported functions and every callsite. The storage check is simpler and consistent with how the rest of the codebase resolves the current user.

### Files Modified
| File | Change |
|------|--------|
| `apps/web-client/src/services/groupCrypto.js` | Replace `_getCurrentUserId()` (~5 lines) |

### Estimated Time: 15 minutes

---

## Phase 2 — Real Pairwise ECDH for Group Sender Key Wrapping (Flaw #4)

**Problem**: `_deriveWrappingKey()` produces a deterministic key from `HKDF("blink-group-wrap:" + conversationId + senderUserId + recipientUserId)`. The server knows all three UUIDs and can compute the same key → can decrypt sender keys → can read all group messages. This violates the E2E invariant.

**Solution**: Replace deterministic HKDF with real pairwise ECDH ephemeral keypairs, reusing the same ECDH + HKDF-SHA-256 mechanism that DMs already use. Each pair of participants in a group performs a one-time ECDH handshake to derive a pairwise wrapping key that the server cannot compute.

### Design

**Pairwise key exchange model:**
- For a group with N members, each member needs a pairwise key with every other member = N-1 ECDH handshakes per member.
- These use the SAME `CryptoEngine.deriveConversationKeyFromExchange()` as DMs, but with a synthetic `pairwiseId` as the conversation identifier for HKDF salt.
- Pairwise ephemeral public keys are stored in a NEW server table (not `key_exchange_data`, which has hard FK constraints to `users` and `devices` that block guests).

**Pairwise ID derivation** (deterministic, sorted so both sides compute the same ID):
```javascript
function pairwiseId(conversationId, userIdA, userIdB) {
  const sorted = [userIdA, userIdB].sort();
  return `${conversationId}:pair:${sorted[0]}:${sorted[1]}`;
}
```

### Changes

#### 2A. New DB table: `group_pairwise_keys` in `apps/server/db.js`

```sql
CREATE TABLE IF NOT EXISTS group_pairwise_keys (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,            -- no FK to users (guests allowed)
  peer_user_id TEXT NOT NULL,       -- the other side of the pair
  ephemeral_public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gpk_unique
  ON group_pairwise_keys(conversation_id, user_id, peer_user_id);
CREATE INDEX IF NOT EXISTS idx_gpk_lookup
  ON group_pairwise_keys(conversation_id, peer_user_id);
```

**Why a new table instead of reusing `key_exchange_data`:**
- `key_exchange_data` has `REFERENCES users(id)` and `REFERENCES devices(id)` — guests can't use it.
- Migrating those FKs away would break DM key exchange semantics.
- A dedicated table is cleaner: DM keys in `key_exchange_data`, group pairwise keys in `group_pairwise_keys`.

#### 2B. New server route: `apps/server/routes/group-keys.js` (extend existing)

Add two endpoints to the existing `group-keys.js` router (which already uses `authenticateAnyToken`):

**`POST /api/group-keys/:conversationId/pairwise`** — publish my ephemeral public key for a specific peer:
```
Body: { peerUserId: string, ephemeralPublicKey: JWK }
```
- Validates caller is a participant.
- Upserts into `group_pairwise_keys` (one row per `(conversation_id, user_id, peer_user_id)` triple).

**`GET /api/group-keys/:conversationId/pairwise`** — fetch all pairwise ephemeral keys published FOR me:
```
Response: { pairwiseKeys: [{ userId, peerUserId, ephemeralPublicKey, createdAt }] }
```
- Returns rows where `peer_user_id = req.user.id` (keys others published for me).
- Also returns rows where `user_id = req.user.id` (my own keys, so I can verify what's published).

#### 2C. `apps/web-client/src/services/groupCrypto.js` — replace `_deriveWrappingKey()`

**New in-memory state:**
```javascript
// conversationId -> Map<peerUserId, { myPrivateKey: JWK, pairwiseKey: Uint8Array }>
const pairwiseKeys = new Map();
```

**New function `_ensurePairwiseKey(conversationId, myUserId, peerId)`:**
1. Check in-memory cache → `pairwiseKeys.get(conversationId)?.get(peerId)`.
2. Check IndexedDB → `loadKey(`group-pair-${pairwiseId(conversationId, myUserId, peerId)}`)`.
3. If found, return the cached pairwise key.
4. Generate fresh ECDH ephemeral keypair → `engine.generateECDHKey()`.
5. POST my public key to `/api/group-keys/:conversationId/pairwise` with `peerUserId = peerId`.
6. GET pairwise keys → find the peer's public key for me.
7. If peer's key exists: `engine.deriveConversationKeyFromExchange(myPrivateKey, peerPublicKey, pairwiseId)` → store pairwise key.
8. If peer's key doesn't exist yet: store my keypair, return `null` (will retry later).

**Replace `_deriveWrappingKey()` callsites:**
- In `_doSetupGroupKeys()`: call `_ensurePairwiseKey()` for each peer instead of `_deriveWrappingKey()`. If pairwise key isn't available yet (peer hasn't published), skip that peer for now — they'll get our sender key when they come online and complete the handshake.
- In `_fetchAndDecryptPeerKeys()`: same — use pairwise key to decrypt.
- In `handleSenderKeyRequest()`: same.
- In `rotateMySenderKey()`: same.

**Socket event for pairwise key exchange:**
- Add new socket event `group_pairwise_exchange` (emitted when a user publishes a pairwise key).
- When received: complete the ECDH handshake for that pair, then fetch+decrypt any pending sender keys from that peer.

#### 2D. `apps/server/websocket.js` — new socket event

Add handler for `group_pairwise_exchange`:
```javascript
socket.on('group_pairwise_exchange', ({ conversationId, targetUserId }) => {
  // Validate participant, then relay to target user
  io.to(targetUserId).emit('group_pairwise_exchange', {
    conversationId,
    fromUserId: userId,
  });
});
```

#### 2E. IndexedDB persistence for pairwise keys

Store in IndexedDB under key `group-pair-${pairwiseId}`:
```javascript
{ myPublicKey: JWK, myPrivateKey: JWK, pairwiseKey: Uint8Array }
```
This survives page reloads. Guests use `sessionStorage` only for session metadata — IndexedDB is still available and appropriate for crypto keys (it's per-origin, not per-tab).

#### 2F. Cleanup

- Delete pairwise keys for a conversation when: member leaves, member is kicked, conversation expires.
- On full logout: wipe all `group-pair-*` keys from IndexedDB (already handled by `clearAllGroupKeys()` pattern — extend it).

### Migration: backward compatibility with existing groups

- Existing registered-user groups already have sender keys distributed with the old deterministic wrapping.
- On first open after upgrade: `setupGroupKeys` will detect no pairwise keys exist, generate ECDH pairs, re-distribute sender keys with real pairwise wrapping.
- Old sender key copies (wrapped with deterministic keys) become undecryptable with the new code. This is acceptable — the sender key re-distribution replaces them.
- **No data migration needed** — the system self-heals on next use.

### Files Modified

| File | Change |
|------|--------|
| `apps/server/db.js` | Add `group_pairwise_keys` table |
| `apps/server/routes/group-keys.js` | Add POST + GET `/pairwise` endpoints |
| `apps/server/websocket.js` | Add `group_pairwise_exchange` socket event handler |
| `apps/web-client/src/services/groupCrypto.js` | Replace `_deriveWrappingKey` with `_ensurePairwiseKey`, add pairwise state management, add socket handler |
| `apps/web-client/src/services/api.js` | Add `publishPairwiseKey()` and `getPairwiseKeys()` API functions |
| `apps/web-client/src/services/socket.js` | Add `emitGroupPairwiseExchange()` function |

### Estimated Time: 10-12 hours

---

## Phase 3 — Sender Key Catch-Up for Late Joiners (Flaw #5)

**Problem**: When a guest joins a room, existing members may have already distributed their sender keys — but not to this new guest. The guest calls `setupGroupKeys` which distributes THEIR key to everyone, but can't decrypt anyone else's messages until those members re-distribute.

### Design

**Server-side auto-notify on join:**

When a new participant is added to a group (in `POST /api/conversations/join/:slug`), the server emits a `sender_key_request` event to ALL existing participants on behalf of the new joiner. This tells them "someone new joined, please re-distribute your sender key."

**Client-side retry on open:**

When `setupGroupKeys` runs and finds missing peer sender keys (step 5 in `_fetchAndDecryptPeerKeys`), it emits `sender_key_request` to each missing peer via socket. This handles the case where the server-side notification was missed.

### Changes

#### 3A. `apps/server/routes/conversations.js` — POST `/join/:slug`

After the guest is added as a participant and the `user_joined` event is emitted, also emit `sender_key_request` to all existing participants:

```javascript
// After joinTransaction() and io.to(conv.id).emit('user_joined', ...) :
// Notify existing members to re-distribute their sender keys to the new joiner
const existingParticipants = db.prepare(
  'SELECT user_id FROM conversation_participants WHERE conversation_id = ? AND user_id != ?'
).all(conv.id, guestId);

for (const p of existingParticipants) {
  io.to(p.user_id).emit('sender_key_request', {
    conversationId: conv.id,
    requestingUserId: guestId,
  });
}
```

#### 3B. `apps/web-client/src/services/groupCrypto.js` — `_fetchAndDecryptPeerKeys`

After fetching and decrypting available peer keys, check for missing peers and request their keys:

```javascript
// At end of _fetchAndDecryptPeerKeys:
const peerMap = peerSenderKeys.get(conversationId);
for (const peerId of otherIds) {
  if (!peerMap?.has(peerId)) {
    // This peer hasn't distributed their sender key to us yet — request it
    emitSenderKeyRequest(conversationId, peerId);
  }
}
```

(Import `emitSenderKeyRequest` from `socket.js` — already exported.)

#### 3C. `apps/web-client/src/services/groupCrypto.js` — `_doSetupGroupKeys`

In step 2, when distributing our sender key, if `_ensurePairwiseKey()` returns `null` for a peer (pairwise ECDH not yet complete), DON'T skip silently. Instead, publish our pairwise public key and emit a `group_pairwise_exchange` notification so the peer can complete when they come online.

### Files Modified

| File | Change |
|------|--------|
| `apps/server/routes/conversations.js` | Emit `sender_key_request` to existing members on guest join |
| `apps/web-client/src/services/groupCrypto.js` | Request missing peer keys after fetch, handle incomplete pairwise setup |
| `apps/web-client/src/services/socket.js` | Already has `emitSenderKeyRequest` — no change needed |

### Estimated Time: 2-3 hours

---

## Phase 4 — Global Socket Handlers for Sender Key Events (Flaw #6)

**Problem**: `sender_key_distributed` and `sender_key_request` handlers are in `useMessages.js`, which only runs for the currently active conversation. If you're viewing conversation A and a peer distributes their sender key for group B, you miss it.

### Design

Move these handlers to `App.jsx`'s global socket `useEffect` (same pattern as `key_exchange` and `key_confirm`). They fire for ALL conversations, not just the active one.

### Changes

#### 4A. `apps/web-client/src/App.jsx` — `MessengerView` component

Add a new `useEffect` block (alongside the existing global `key_exchange` handler):

```javascript
// Global sender key socket handlers — fire for ALL group conversations
useEffect(() => {
  const socket = getSocket();
  if (!socket) return;

  const deps = {
    emitSenderKeyDistributed,
    getMyUserId: () => user.id,
  };

  const onSenderKeyDistributed = async ({ conversationId, senderUserId }) => {
    if (!isGroupConversation(conversationId)) return;
    try {
      await handleSenderKeyDistributed(conversationId, senderUserId, deps);
    } catch (err) {
      console.warn('[global] sender_key_distributed failed:', conversationId, err.message);
    }
  };

  const onSenderKeyRequest = async ({ conversationId, requestingUserId }) => {
    if (!isGroupConversation(conversationId)) return;
    try {
      await handleSenderKeyRequest(conversationId, requestingUserId, deps);
    } catch (err) {
      console.warn('[global] sender_key_request failed:', conversationId, err.message);
    }
  };

  // New: handle pairwise key exchange completion
  const onGroupPairwiseExchange = async ({ conversationId, fromUserId }) => {
    if (!isGroupConversation(conversationId)) return;
    try {
      await handleGroupPairwiseExchange(conversationId, fromUserId, user.id, deps);
    } catch (err) {
      console.warn('[global] group_pairwise_exchange failed:', conversationId, err.message);
    }
  };

  socket.on('sender_key_distributed', onSenderKeyDistributed);
  socket.on('sender_key_request', onSenderKeyRequest);
  socket.on('group_pairwise_exchange', onGroupPairwiseExchange);
  return () => {
    socket.off('sender_key_distributed', onSenderKeyDistributed);
    socket.off('sender_key_request', onSenderKeyRequest);
    socket.off('group_pairwise_exchange', onGroupPairwiseExchange);
  };
}, [user.id]);
```

#### 4B. `apps/web-client/src/hooks/useMessages.js`

Remove the `sender_key_distributed` and `sender_key_request` handlers from the per-conversation socket effect (lines ~365-395). They're now handled globally. Keep `user_kicked` and `conversation_expired` in `useMessages` since those are UI-affecting and conversation-scoped.

#### 4C. `apps/web-client/src/components/GuestChatView.jsx`

Add the same global handlers for the guest context. The guest's `App` component doesn't render `MessengerView`, so `GuestChatView` needs its own:

```javascript
useEffect(() => {
  const socket = getSocket();
  if (!socket) return;

  const deps = {
    emitSenderKeyDistributed,
    getMyUserId: () => guestSessionId,
  };

  const onSenderKeyDistributed = async ({ conversationId: cid, senderUserId }) => {
    if (cid !== conversationId) return;
    try {
      await handleSenderKeyDistributed(conversationId, senderUserId, deps);
    } catch (err) {
      console.warn('[guest] sender_key_distributed failed:', err.message);
    }
  };

  const onSenderKeyRequest = async ({ conversationId: cid, requestingUserId }) => {
    if (cid !== conversationId) return;
    try {
      await handleSenderKeyRequest(conversationId, requestingUserId, deps);
    } catch (err) {
      console.warn('[guest] sender_key_request failed:', err.message);
    }
  };

  socket.on('sender_key_distributed', onSenderKeyDistributed);
  socket.on('sender_key_request', onSenderKeyRequest);
  return () => {
    socket.off('sender_key_distributed', onSenderKeyDistributed);
    socket.off('sender_key_request', onSenderKeyRequest);
  };
}, [conversationId, guestSessionId]);
```

### Files Modified

| File | Change |
|------|--------|
| `apps/web-client/src/App.jsx` | Add global `sender_key_distributed`, `sender_key_request`, `group_pairwise_exchange` handlers |
| `apps/web-client/src/hooks/useMessages.js` | Remove per-conversation sender key handlers |
| `apps/web-client/src/components/GuestChatView.jsx` | Add sender key socket handlers for guest context |

### Estimated Time: 2 hours

---

## Phase 5 — Guest Crypto State Resilience (Flaw #7)

**Problem**: Guest in-memory state (`groupConversations` Map, `mySenderKeys`, `peerSenderKeys`) is lost on page reload or component remount. If `isGroupConversation()` returns `false` after remount, the system falls through to the DM ECDH path which fails for guests.

### Design

**On `GuestChatView` mount**: Always call `registerGroupConversation(conversationId)` before any crypto operations. (Already done — `setupDone.current` guard prevents double-setup but `registerGroupConversation` is idempotent.)

**The real fix**: `setupGroupKeys` already reloads sender keys from IndexedDB (step 1 in `_doSetupGroupKeys` — it loads `group-sk-${conversationId}` from IndexedDB). Peer keys are also loaded in `_fetchAndDecryptPeerKeys`. The missing piece is that `groupConversations` (the type-tracking Map) is never persisted.

### Changes

#### 5A. `apps/web-client/src/components/GuestChatView.jsx`

Remove the `setupDone.current` guard that prevents re-setup. Instead, make the setup `useEffect` depend on `conversationId` and always re-register:

```javascript
useEffect(() => {
  registerGroupConversation(conversationId);
  joinConversation(conversationId);

  let cancelled = false;
  (async () => {
    try {
      const participants = await refreshParticipants();
      if (cancelled) return;
      const pIds = participants.map((p) => p.user_id || p.id);
      await setupGroupKeys(conversationId, guestSessionId, pIds, {
        emitSenderKeyDistributed,
      });
      if (!cancelled) setGroupKeysReady(true);
    } catch (err) {
      console.warn('[GuestChat] Group key setup failed:', err.message);
      if (!cancelled) setGroupKeysReady(true); // allow viewing
    }
  })();

  return () => { cancelled = true; };
}, [conversationId, guestSessionId, refreshParticipants]);
```

This is safe because `setupGroupKeys` has its own per-conversation lock (`groupSetupLocks`) and short-circuits if keys already exist in memory.

#### 5B. `apps/web-client/src/services/groupCrypto.js` — `setupGroupKeys`

The existing check at line ~254 already handles this:
```javascript
if (mySenderKeys.has(conversationId)) {
  // check if all peer keys present, skip if so
}
```
No change needed. The lock + early-return pattern makes repeated calls safe.

### Files Modified

| File | Change |
|------|--------|
| `apps/web-client/src/components/GuestChatView.jsx` | Remove `setupDone.current` guard, use cancellation pattern instead |

### Estimated Time: 30 minutes

---

## Phase 6 — Remove Room Kill Switch (Flaw #1)

**Problem**: `App.jsx` line ~666 hardcodes `if (hashRoute.route === 'room') return <MaintenancePage />`, preventing all room access.

**When**: Only after Phases 1-5 are complete and manually verified.

### Changes

#### 6A. `apps/web-client/src/App.jsx`

Replace:
```jsx
if (hashRoute.route === 'room') {
  return <MaintenancePage />;
}
```

With the intended logic (render `JoinRoomPage` for non-logged-in users, or redirect for logged-in users joining as registered participants):

```jsx
if (hashRoute.route === 'room') {
  // If already in a guest session for this room, show guest chat
  if (guestSession && !user) {
    return (
      <GuestChatView
        guestSession={guestSession}
        onLeave={() => {
          setGuestSession(null);
          navigateReplace('/');
        }}
      />
    );
  }
  // Show the join page (works for both logged-in and anonymous users)
  return (
    <JoinRoomPage
      slug={hashRoute.slug}
      onJoined={(data) => {
        setGuestSession({
          guestSessionId: data.guestSessionId,
          conversationId: data.conversationId,
          conversationName: data.conversationName,
          expiresAt: data.expiresAt,
        });
      }}
    />
  );
}
```

### Files Modified

| File | Change |
|------|--------|
| `apps/web-client/src/App.jsx` | Replace MaintenancePage with JoinRoomPage/GuestChatView routing |

### Estimated Time: 30 minutes

---

## Verification Checklist

Test each scenario with two browser windows (one registered user, one guest):

### Phase 1 Verification
- [ ] Guest joins room → `_getCurrentUserId()` returns guest UUID
- [ ] Guest can decrypt their own messages
- [ ] Guest can decrypt registered user's messages

### Phase 2 Verification
- [ ] `group_pairwise_keys` table created on server start
- [ ] Two registered users creating a group → pairwise ECDH completes → sender keys distributed → messages encrypt/decrypt
- [ ] Server DB has `group_pairwise_keys` rows but cannot derive the pairwise key (verify by inspecting — only public keys stored)
- [ ] Guest joins → pairwise ECDH with each existing member → sender key distribution works

### Phase 3 Verification
- [ ] Registered user creates room with messages → guest joins later → guest requests sender keys → can read history
- [ ] Two guests join at different times → both can eventually read each other's messages
- [ ] Existing members receive `sender_key_request` on guest join and auto-redistribute

### Phase 4 Verification
- [ ] Registered user viewing conversation A → guest distributes sender key for room B → user switches to room B → can decrypt without re-setup
- [ ] Guest receives `sender_key_distributed` while in the room → decrypts new messages immediately

### Phase 5 Verification
- [ ] Guest refreshes page (F5) → reconnects → `registerGroupConversation` fires → can still send/receive
- [ ] Guest socket reconnects after network blip → group crypto state recovered from IndexedDB

### Phase 6 Verification
- [ ] Navigate to `/#/r/<slug>` → JoinRoomPage renders (not MaintenancePage)
- [ ] Complete guest join flow → GuestChatView renders
- [ ] Send messages both directions → E2E encryption verified
- [ ] Guest leaves → session cleared → back to welcome page
- [ ] Expired room → shows "expired" message
- [ ] Full room → shows "room is full" message

---

## Implementation Order & Dependencies

```
Phase 1 (15 min)     — no dependencies, unblocks decryption
    ↓
Phase 2 (10-12 hrs)  — depends on Phase 1 (needs working guest userId)
    ↓
Phase 3 (2-3 hrs)    — depends on Phase 2 (catch-up uses pairwise ECDH)
    ↓
Phase 4 (2 hrs)      — depends on Phase 2 (handlers call groupCrypto functions that use pairwise)
    ↓
Phase 5 (30 min)     — independent, can be done in parallel with 3/4
    ↓
Phase 6 (30 min)     — depends on ALL above being verified
```

**Total estimated time: ~16-18 hours**

---

## Files Changed (Complete List)

| File | Phases | Type of Change |
|------|--------|----------------|
| `apps/server/db.js` | 2 | Add `group_pairwise_keys` table |
| `apps/server/routes/group-keys.js` | 2 | Add pairwise key POST + GET endpoints |
| `apps/server/routes/conversations.js` | 3 | Emit `sender_key_request` on guest join |
| `apps/server/websocket.js` | 2 | Add `group_pairwise_exchange` socket event |
| `apps/web-client/src/services/groupCrypto.js` | 1, 2, 3 | Fix userId, replace wrapping key, add catch-up logic |
| `apps/web-client/src/services/api.js` | 2 | Add `publishPairwiseKey()`, `getPairwiseKeys()` |
| `apps/web-client/src/services/socket.js` | 2 | Add `emitGroupPairwiseExchange()` |
| `apps/web-client/src/App.jsx` | 4, 6 | Add global sender key handlers, remove MaintenancePage override |
| `apps/web-client/src/hooks/useMessages.js` | 4 | Remove per-conversation sender key handlers |
| `apps/web-client/src/components/GuestChatView.jsx` | 4, 5 | Add sender key handlers, fix remount resilience |
