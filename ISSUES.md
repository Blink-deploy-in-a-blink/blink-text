# Blink-Text: Identified Chat Flow Issues

> **Scope**: Issues found in the multi-user chat flow, particularly when 3+ users are involved (one user with multiple conversations). Also includes broader logic flow issues discovered during analysis.

---

## Table of Contents

1. [Critical Multi-User Chat Bugs](#1-critical-multi-user-chat-bugs)
2. [Encryption & Key Exchange Issues](#2-encryption--key-exchange-issues)
3. [Socket / Real-Time Messaging Issues](#3-socket--real-time-messaging-issues)
4. [UI & Client Logic Issues](#4-ui--client-logic-issues)
5. [Privacy & Security Concerns](#5-privacy--security-concerns)

---

## 1. Critical Multi-User Chat Bugs

These are the bugs most likely causing the reported problems — messages from one user appearing in the wrong chat, messages not being delivered, and second chats not working properly.

### ~~1.1 Stale Key Exchange Entries After Device Re-Registration~~ — NOT A BUG

**Severity**: ✅ Not a bug — intentional design  
**Files**: `apps/server/routes/keys.js:73`, `apps/web-client/src/services/cryptoService.js`

**Previous assessment was incorrect.** Keeping old device key exchange entries is **intentional**:

- When a user's JWT expires (automatic session timeout) the crypto keys (ephemeral ECDH keys, device ID) are **preserved** in IndexedDB and localStorage so old conversations remain decryptable after re-login.
- Only an explicit manual sign-out wipes crypto keys (and the user is warned that all message history becomes unreadable).
- Deleting old key exchange entries by `user_id` would break decryption for users whose sessions simply expired — an unacceptable UX regression.

The old-device entries in `key_exchange_data` serve as a fallback so the same device can re-derive conversation keys when the session is restored.  The peer-key selection in `setupConversationKey` picks the most recently matching entry for the peer, which is the correct one because the `completeKeyExchangeFromSocket` handler always re-derives when the peer's key fingerprint changes.

> **Session management improvement (implemented):** JWT expiry extended from 24 h → 30 days and a `POST /api/auth/refresh` endpoint was added so the token is silently renewed every time the app is opened, further reducing the chance of session-expiry surprises.

---

### 1.2 No Socket Room Cleanup (Missing `leave_conversation`)

**Severity**: 🔴 Critical  
**Files**: `apps/server/websocket.js` (missing handler), `apps/web-client/src/services/socket.js` (missing function)

**Problem**: When a user opens a conversation, they join the corresponding Socket.io room via `join_conversation`. However, there is **no `leave_conversation` mechanism** — users accumulate room memberships across all conversations they've ever opened.

This means `io.to(conversationId).emit('message', message)` delivers message events for **all** joined conversations to the user's socket. While the client-side `useMessages` hook filters by `conversationId`, this creates several issues:

**Impact**:
- Unnecessary network traffic — every message for every joined room is sent to the socket, even if filtered client-side.
- Server memory buildup — each socket maintains a set of all rooms it has joined.
- All `key_exchange` events for past conversations are delivered, triggering unnecessary processing.
- In high-traffic scenarios, this can degrade performance and cause event handler backlog.

**Fix**: Add a `leave_conversation` socket event on the server and call it from the client when switching conversations.

---

### 1.3 Messages for Non-Active Conversations Are Silently Dropped — ✅ FIXED

**Severity**: 🟠 High → ✅ Fixed  
**Files**: `apps/web-client/src/hooks/useMessages.js:124`, `apps/web-client/src/App.jsx`

**Problem**: The `useMessages` hook's `onMessage` handler filters messages by the currently active `conversationId`:

```js
const onMessage = async (msg) => {
  if (msg.conversationId !== conversationId) return; // silently dropped!
  // ...
};
```

Messages arriving for **non-active** conversations are completely discarded — they are not cached, counted, or indicated in any way.

**Fix applied**: Added a global `message` handler in `App.jsx` that catches messages for non-active conversations, decrypts them (when a key is available), and appends them to the message cache via `appendCachedMessage()`. When the user switches back to that conversation, the cached messages appear immediately.

---

### 1.4 New Conversations Created by Others Don't Trigger Key Preloading

**Severity**: 🟠 High  
**Files**: `apps/web-client/src/hooks/useBackgroundPreloader.js:21`

**Problem**: The `useBackgroundPreloader` hook runs **once** on mount and sets `started.current = true`, preventing it from running again:

```js
if (!userId || started.current) return;
started.current = true;
```

When another user creates a new conversation with you (e.g., User C starts a DM with User A), the `new_conversation` socket event triggers a conversation list refresh, but:
- No `setupConversationKey` is called for the new conversation
- No socket room is joined for the new conversation
- The user won't receive real-time messages or key exchange events until they manually open the conversation

**Impact**:
- User A doesn't receive real-time messages from User C until they click on the conversation.
- Key exchange for the new conversation is delayed, which can cause the "second chat not working properly" symptom.

**Fix**: When a `new_conversation` event is received, also join the socket room and initiate key exchange for the new conversation.

---

### 1.5 Race Condition in Concurrent `setupConversationKey` Calls — ✅ FIXED

**Severity**: 🟠 High → ✅ Fixed  
**Files**: `apps/web-client/src/services/cryptoService.js:195-280`

**Problem**: `setupConversationKey` can be called concurrently for the same conversation from:
- The background preloader (on login)
- The `useMessages` effect (when the user opens a conversation)
- The `sendMsg` retry logic (when sending without a key)

When two calls race:
1. Both check `ephemeralPrivateKeys.get(conversationId)` → `undefined`
2. Both generate **new** ephemeral key pairs
3. The second call's `ephemeralPrivateKeys.set()` overwrites the first call's private key
4. The second call's `storeKeyExchange()` API call overwrites the first on the server
5. If the peer already received and derived a key from the **first** call's public key (via the socket `key_exchange` event), there's a **key mismatch**

**Impact**: Intermittent key mismatches, especially during the initial load when the preloader and manual conversation opening overlap. Messages become undecryptable.

**Fix applied**: Added a per-conversation lock (`setupLocks` Map) in `cryptoService.js`. When `setupConversationKey` is called while another call is already in progress for the same conversation, it waits for the first call to finish. If the first call successfully established the key, the second call returns immediately without generating a conflicting ephemeral key pair.

---

## 2. Encryption & Key Exchange Issues

### 2.1 Group Chat Encryption Is Fundamentally Broken

**Severity**: 🔴 Critical (for group chats)  
**Files**: `apps/web-client/src/services/cryptoService.js:249,267`

**Problem**: The ECDH key exchange is **pairwise** — it derives a shared secret between exactly TWO users. In a group chat with 3+ participants:

```js
const peerEntry = exchangeData.find((e) => e.userId !== myUserId);
```

This only picks **one** peer's ephemeral key. Different participants will derive **different** conversation keys depending on which peer's entry appears first in the database results:
- User A derives key from (A_private, B_public)
- User B derives key from (B_private, A_public) → **same** as A's key (ECDH symmetry)
- User C derives key from (C_private, A_public) → **different** key entirely

Messages encrypted by A (using the A↔B key) cannot be decrypted by C.

**Impact**: Group chats are completely non-functional for encryption/decryption. Only the pair whose keys were used can communicate.

**Fix**: Implement a group key exchange protocol (e.g., sender keys, shared group key wrapped per-participant, or a group key agreement protocol).

---

### 2.2 Key Exchange Event Gap During Conversation Switch

**Severity**: 🟡 Medium  
**Files**: `apps/web-client/src/App.jsx:51-67`, `apps/web-client/src/hooks/useMessages.js:117-205`

**Problem**: Key exchange events are handled by two listeners:
1. `useMessages` hook — handles `key_exchange` for the **active** conversation
2. Global handler in `App.jsx` — handles `key_exchange` for **all other** conversations (skips active)

When the active conversation changes, React cleanup runs before new effects are set up:
1. Old `useMessages` handler removed (for old active conversation)
2. Old global handler removed (which skipped old active conversation)
3. New global handler registered (skips **new** active conversation)
4. New `useMessages` handler registered (handles new active conversation)

Between steps 2 and 4, there's a brief window where `key_exchange` events for **either** conversation could be missed.

**Impact**: Occasional failure to complete key exchange, especially when switching conversations rapidly while peers are also opening conversations.

**Fix**: Use a single global handler that processes all key exchange events, removing the split listener architecture.

---

### 2.3 Peer Key Selection Uses `.find()` Without Deduplication

**Severity**: 🟢 Low (revised — stale keys are intentional, see Issue 1.1)  
**Files**: `apps/web-client/src/services/cryptoService.js:249,267`

**Problem**: When `getKeyExchange(conversationId)` returns multiple entries for the same user (one per device), `exchangeData.find((e) => e.userId !== myUserId)` picks the **first** match. However, this is mitigated by the `completeKeyExchangeFromSocket` handler which always re-derives when the peer's key fingerprint changes, so the latest key is always used in practice.

**Impact**: Low — the re-derivation logic handles this. In rare cases, the first API fetch could derive from an older device's key, but the next socket `key_exchange` event will correct it.

**Fix**: Would improve reliability if entries were sorted by `createdAt` descending before picking, but not critical.

---

## 3. Socket / Real-Time Messaging Issues

### 3.1 Sender Receives Their Own Message Back via `io.to()` Broadcast

**Severity**: 🟡 Medium  
**Files**: `apps/server/websocket.js:101`

**Problem**: The server uses `io.to(conversationId).emit('message', message)` which broadcasts to **all** sockets in the room, including the sender. The sender's only way to see their message in the UI is via this broadcast — there is no optimistic local update.

```js
// Server broadcasts to all, including sender
io.to(conversationId).emit('message', message);
```

**Impact**:
- Perceived latency — the user must wait for the round-trip (client → server → client) before seeing their own message.
- If the network is slow, the chat feels unresponsive.

**Fix**: Either:
- Use `socket.to(conversationId).emit(...)` (excludes sender) and add an optimistic local message in the client, or
- Keep `io.to()` but add an optimistic message on the client and deduplicate when the broadcast arrives.

---

### 3.2 No Message Deduplication — ✅ FIXED

**Severity**: 🟡 Medium → ✅ Fixed  
**Files**: `apps/web-client/src/hooks/useMessages.js:123-139`, `apps/web-client/src/services/messageCache.js`

**Problem**: The `onMessage` handler appends incoming messages without checking if the message already exists.

**Fix applied**: Added deduplication checks in both `useMessages.js` (`setMessages` callback checks `prev.some(m => m.id === msg.id)`) and `messageCache.js` (`appendCachedMessage` skips if the message ID already exists in the cache).

---

### 3.3 `key_exchange` Socket Event Uses `socket.to()` But Has No Persistence Guarantee

**Severity**: 🟡 Medium  
**Files**: `apps/server/websocket.js:121`

**Problem**: The `key_exchange` socket event is forwarded to peers using `socket.to(conversationId).emit(...)`. If the peer is offline or not in the room, the event is lost. The key exchange data **is** persisted in the database (via the REST API), but the real-time socket notification is fire-and-forget.

**Impact**: If User B publishes their ephemeral key while User A is offline, User A won't receive the socket event. User A must rely on the retry logic in `setupConversationKey` to poll the REST API. This works but adds latency to key establishment.

**Fix**: This is acceptable as-is since the REST API serves as the persistent fallback. However, adding a "pending key exchange" queue that replays on reconnect would improve UX.

---

## 4. UI & Client Logic Issues

### 4.1 NewConversationModal Doesn't Support Multiple Participants for Group Chats

**Severity**: 🟠 High  
**Files**: `apps/web-client/src/components/NewConversationModal.jsx:64-74`

**Problem**: The modal's UI suggests comma-separated usernames for group chats:
```jsx
<label>{type === 'direct_message' ? 'Recipient Username' : 'Participant Usernames (comma-separated)'}</label>
```

But the `handleCreate` function only searches for and adds **one** user:
```js
const users = await searchUsers(recipientUsername.trim());
const matchedUser = users.find(
  (u) => u.username.toLowerCase() === recipientUsername.trim().toLowerCase()
);
const participants = [matchedUser.id]; // Only one participant!
```

**Impact**: Group chats can only be created with 2 participants (the creator + one other), despite the UI suggesting otherwise.

**Fix**: Split the input by commas, search for each username individually, and collect all matched user IDs into the `participants` array.

---

### 4.2 No Unread Message Indicators

**Severity**: 🟡 Medium  
**Files**: `apps/web-client/src/components/ConversationList.jsx`

**Problem**: The conversation list shows no indication of unread messages. Combined with Issue 1.3 (messages for non-active conversations are dropped), the user has no way to know when new messages arrive in other conversations.

**Impact**: User must manually check each conversation for new messages, making multi-conversation usage frustrating.

**Fix**: Add an unread count state per conversation, update it from a global `message` handler, and display badges in the conversation list.

---

### 4.3 `new_conversation` Event Payload Lacks Display Data

**Severity**: 🟢 Low  
**Files**: `apps/server/routes/conversations.js:86-95`

**Problem**: When notifying other participants of a new conversation, the server fetches only the raw conversation record:
```js
const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
io.to(uid).emit('new_conversation', { conversation });
```

This object lacks `participant_usernames`, `participant_ids`, and `has_deleted_participant` fields that the client needs for display. The client works around this by calling `load()` to refresh the full list, but this is inefficient.

**Impact**: Extra API call on every `new_conversation` event; brief flash of incomplete data.

**Fix**: Include participant info in the `new_conversation` payload, or at minimum ensure the client-side `load()` is sufficient (it currently is, but it's wasteful).

---

### 4.4 `activeConversation` Stored in `localStorage` Can Become Stale

**Severity**: 🟢 Low  
**Files**: `apps/web-client/src/App.jsx:33-38`

**Problem**: The active conversation is persisted to `localStorage` and restored on page load:
```js
const [activeConversation, setActiveConversation] = useState(() => {
  const raw = localStorage.getItem('blink-active-conv');
  return raw ? JSON.parse(raw) : null;
});
```

If the conversation was deleted, the user was removed, or the peer deleted their account since the last session, the restored conversation object may have stale data (e.g., `has_deleted_participant: 0` when it should be `1`).

**Impact**: Brief display of outdated conversation state until the next API call refreshes the data.

---

## 5. Privacy & Security Concerns

### 5.1 `user_connected` / `user_disconnected` Broadcast to All Users

**Severity**: 🟡 Medium  
**Files**: `apps/server/websocket.js:33,196`

**Problem**: Connection and disconnection events are broadcast globally:
```js
socket.broadcast.emit('user_connected', { userId, username });
socket.broadcast.emit('user_disconnected', { userId, username });
```

**Impact**: All connected users can see when any other user connects or disconnects, regardless of whether they share any conversation. This leaks presence information.

**Fix**: Only emit presence events to users who share at least one conversation with the connecting/disconnecting user.

---

### 5.2 `user_deleted` Event Broadcast to All Connected Users

**Severity**: 🟡 Medium  
**Files**: `apps/server/routes/auth.js:184`

**Problem**: When a user deletes their account, the event is broadcast globally:
```js
io.emit('user_deleted', { userId: req.user.id });
```

**Impact**: All connected users learn that a specific user deleted their account, even if they have no relationship. This is a privacy leak.

**Fix**: Only emit to users who share a conversation with the deleted user.

---

## Summary

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1.1 | ~~Stale key exchange entries after re-login~~ | ✅ Not a bug | Key Exchange |
| 1.2 | No socket room cleanup (no `leave_conversation`) | 🔴 Critical | Socket |
| 1.3 | ~~Messages for non-active conversations silently dropped~~ | ✅ Fixed | Messaging |
| 1.4 | New conversations don't trigger key preloading | 🟠 High | Key Exchange |
| 1.5 | ~~Race condition in concurrent `setupConversationKey`~~ | ✅ Fixed | Key Exchange |
| 2.1 | Group chat encryption fundamentally broken | 🔴 Critical | Encryption |
| 2.2 | Key exchange event gap during conversation switch | 🟡 Medium | Key Exchange |
| 2.3 | Peer key selection without deduplication | 🟢 Low | Key Exchange |
| 3.1 | No optimistic UI update for sent messages | 🟡 Medium | UX |
| 3.2 | ~~No message deduplication~~ | ✅ Fixed | Messaging |
| 3.3 | Socket key_exchange not persistent | 🟡 Medium | Socket |
| 4.1 | Group chat creation UI broken | 🟠 High | UI |
| 4.2 | No unread message indicators | 🟡 Medium | UX |
| 4.3 | `new_conversation` payload lacks display data | 🟢 Low | API |
| 4.4 | Stale active conversation in localStorage | 🟢 Low | State |
| 5.1 | Presence events broadcast globally | 🟡 Medium | Privacy |
| 5.2 | `user_deleted` event broadcast globally | 🟡 Medium | Privacy |

### Root Cause Analysis for the Reported Multi-User Bug

The primary symptoms reported — **"chats of other user coming in the second chat, message of third user not being delivered, second chat not working properly"** — were caused by:

1. **Issue 1.5** (race condition in key setup — **now fixed**) — When the background preloader and user actions overlapped, ephemeral keys got overwritten, causing key mismatches.  Both the preloader and `useMessages` hook called `setupConversationKey` concurrently for the same conversation, generating conflicting ephemeral key pairs.  **A per-conversation lock now prevents this.**

2. **Issue 1.3** (dropped messages for non-active conversations — **now fixed**) — Messages arriving for a non-active conversation were silently discarded by the `useMessages` filter.  When switching back, the user didn't see recent messages until a full server refresh, creating the perception that "messages of the third user are not being delivered."  **A global message handler now decrypts and caches these messages.**

3. **Issue 3.2** (no message deduplication — **now fixed**) — Socket reconnection or server broadcast could cause the same message to appear twice.  **Deduplication checks now prevent this.**

4. **Issue 1.4** (no key preloading for new conversations — still open) — When a third user creates a conversation, the key exchange and room joining don't happen automatically, delaying message delivery.

**Note on stale key exchange entries (Issue 1.1):** The previous analysis incorrectly identified this as a bug.  Preserving old device keys is **intentional** — it ensures that users whose JWT sessions expire (automatic timeout) can still decrypt old conversations after re-login.  The session management has been improved: JWT expiry extended from 24 h → 30 days, and a token refresh endpoint now silently renews the token every time the app is opened.

### Why Direct Messages Should Work (And Now Do)

The ECDH key exchange is **pairwise by design**.  For direct messages (1:1 conversations), each side generates one ephemeral key pair per conversation.  The per-conversation key derivation (`conversationId` used as HKDF salt) ensures that multiple DM conversations produce **independent** conversation keys.  The bugs that were breaking multi-DM scenarios were:

- The race condition (Issue 1.5) causing key overwrites during concurrent setup
- Dropped messages (Issue 1.3) giving the appearance of undelivered messages

Both are now fixed.  Group chats (3+ participants) remain fundamentally broken because ECDH only works between two parties — this requires a separate group key agreement protocol (Issue 2.1).
