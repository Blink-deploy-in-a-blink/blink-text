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

### 1.1 Stale Key Exchange Entries After Device Re-Registration

**Severity**: 🔴 Critical — root cause of key mismatch / wrong decryption across chats  
**Files**: `apps/server/routes/keys.js:73`, `apps/web-client/src/services/cryptoService.js:249`

**Problem**: When a user logs out and back in (or their session expires), a **new device** is registered with a new `device_id`. The server's key exchange upsert logic deletes old entries by `(conversation_id, device_id)`:

```js
// apps/server/routes/keys.js:73
db.prepare('DELETE FROM key_exchange_data WHERE conversation_id = ? AND device_id = ?')
  .run(conversationId, deviceId);
```

Since the new device has a **different** `device_id`, the old device's key exchange entries **remain in the database**. This results in multiple `key_exchange_data` rows for the same user in the same conversation (one per device).

When the peer fetches key exchange data, `exchangeData.find((e) => e.userId !== myUserId)` returns the **first** (oldest/stale) entry, causing the peer to derive a conversation key from the **wrong** ephemeral public key.

**Impact**: 
- Messages encrypted by User A cannot be decrypted by User B (and vice versa) because they derived keys from different ephemeral key pairs.
- When User A has 2 conversations (with User B and User C), switching between them may trigger re-key flows that further corrupt the key state.
- Messages appear as `[unable to decrypt]` or get decrypted with the wrong key (cross-contamination between chats).

**Fix**: The DELETE should use `user_id` instead of `device_id`:
```js
db.prepare('DELETE FROM key_exchange_data WHERE conversation_id = ? AND user_id = ?')
  .run(conversationId, req.user.id);
```

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

### 1.3 Messages for Non-Active Conversations Are Silently Dropped

**Severity**: 🟠 High  
**Files**: `apps/web-client/src/hooks/useMessages.js:124`

**Problem**: The `useMessages` hook's `onMessage` handler filters messages by the currently active `conversationId`:

```js
const onMessage = async (msg) => {
  if (msg.conversationId !== conversationId) return; // silently dropped!
  // ...
};
```

Messages arriving for **non-active** conversations are completely discarded — they are not cached, counted, or indicated in any way. Combined with the lack of room cleanup (Issue 1.2), the socket receives messages for all joined conversations but only processes ones matching the active conversation.

**Impact**:
- No unread message indicators — the user has no way to know a new message arrived in another conversation.
- When switching back to a previously viewed conversation, the cache is stale — messages sent by others while the user was viewing a different chat don't appear until a full server re-fetch.
- Creates the perception that "messages of the third user are not being delivered."

**Fix**: Add a global `message` handler (similar to the global `key_exchange` handler in `App.jsx`) that updates the message cache and unread counts for non-active conversations.

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

### 1.5 Race Condition in Concurrent `setupConversationKey` Calls

**Severity**: 🟠 High  
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

**Fix**: Add a per-conversation lock/mutex to `setupConversationKey` so only one call can run at a time per conversation.

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

**Severity**: 🟡 Medium  
**Files**: `apps/web-client/src/services/cryptoService.js:249,267`

**Problem**: When `getKeyExchange(conversationId)` returns multiple entries for the same user (due to Issue 1.1), `exchangeData.find((e) => e.userId !== myUserId)` picks the **first** match, which may be a stale entry from an old device.

**Impact**: Key derivation uses an outdated ephemeral public key, resulting in a key mismatch with the peer who is now using a different (newer) ephemeral key pair.

**Fix**: Sort key exchange entries by `createdAt` descending and pick the most recent entry per user, or better yet, ensure only one entry per user exists (fix Issue 1.1 at the source).

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

### 3.2 No Message Deduplication

**Severity**: 🟡 Medium  
**Files**: `apps/web-client/src/hooks/useMessages.js:123-139`

**Problem**: The `onMessage` handler appends incoming messages without checking if the message already exists:

```js
setMessages((prev) => [...prev, decryptedMsg]);
```

If a message event is received twice (e.g., due to Socket.io reconnection, or the user has multiple tabs), duplicate messages appear in the UI.

**Impact**: Duplicate messages displayed in the chat window under certain network conditions or multi-tab usage.

**Fix**: Check `prev.some((m) => m.id === decryptedMsg.id)` before appending.

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
| 1.1 | Stale key exchange entries after re-login | 🔴 Critical | Key Exchange |
| 1.2 | No socket room cleanup (no `leave_conversation`) | 🔴 Critical | Socket |
| 1.3 | Messages for non-active conversations silently dropped | 🟠 High | Messaging |
| 1.4 | New conversations don't trigger key preloading | 🟠 High | Key Exchange |
| 1.5 | Race condition in concurrent `setupConversationKey` | 🟠 High | Key Exchange |
| 2.1 | Group chat encryption fundamentally broken | 🔴 Critical | Encryption |
| 2.2 | Key exchange event gap during conversation switch | 🟡 Medium | Key Exchange |
| 2.3 | Peer key selection without deduplication | 🟡 Medium | Key Exchange |
| 3.1 | No optimistic UI update for sent messages | 🟡 Medium | UX |
| 3.2 | No message deduplication | 🟡 Medium | Messaging |
| 3.3 | Socket key_exchange not persistent | 🟡 Medium | Socket |
| 4.1 | Group chat creation UI broken | 🟠 High | UI |
| 4.2 | No unread message indicators | 🟡 Medium | UX |
| 4.3 | `new_conversation` payload lacks display data | 🟢 Low | API |
| 4.4 | Stale active conversation in localStorage | 🟢 Low | State |
| 5.1 | Presence events broadcast globally | 🟡 Medium | Privacy |
| 5.2 | `user_deleted` event broadcast globally | 🟡 Medium | Privacy |

### Root Cause Analysis for the Reported Multi-User Bug

The primary symptoms reported — **"chats of other user coming in the second chat, message of third user not being delivered, second chat not working properly"** — are most likely caused by a combination of:

1. **Issue 1.1** (stale key exchange entries) — After any re-login, key exchange entries from old devices accumulate in the database. Peers derive keys from stale entries, causing decryption failures or cross-contamination when the wrong conversation key is used.

2. **Issue 1.3** (dropped messages for non-active conversations) — Messages arriving for a non-active conversation are silently discarded. When switching back, the user doesn't see recent messages until a full server refresh.

3. **Issue 1.4** (no key preloading for new conversations) — When a third user creates a conversation, the key exchange and room joining don't happen automatically, delaying message delivery.

4. **Issue 1.5** (race condition in key setup) — When the background preloader and user actions overlap, ephemeral keys get overwritten, causing key mismatches.

These issues compound: a stale key causes decryption failure, the message shows as `[unable to decrypt]`, the user switches conversations, misses messages in the first chat, and the overall experience breaks down when more than one conversation is active.
