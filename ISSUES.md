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

### 1.2 No Socket Room Cleanup (Missing `leave_conversation`) — ✅ FIXED

**Severity**: 🔴 Critical → ✅ Fixed  
**Files**: `apps/server/websocket.js`, `apps/web-client/src/services/socket.js`, `apps/web-client/src/hooks/useMessages.js`

**Problem**: When a user opens a conversation, they join the corresponding Socket.io room via `join_conversation`. However, there was **no `leave_conversation` mechanism** — users accumulated room memberships across all conversations they've ever opened.

**Fix applied**:
- Added `leave_conversation` socket event handler on the server that calls `socket.leave(conversationId)`.
- Added `leaveConversation()` function in `socket.js` client service.
- `useMessages` now calls `leaveConversation(prevConversationId)` when the user switches conversations, so room memberships are properly cleaned up.

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

### 1.4 New Conversations Created by Others Don't Trigger Key Preloading — ✅ FIXED

**Severity**: 🟠 High → ✅ Fixed  
**Files**: `apps/web-client/src/App.jsx`

**Problem**: The `useBackgroundPreloader` hook ran **once** on mount — new conversations created by others didn't trigger key exchange or socket room joining.

**Fix applied**: Added a `new_conversation` socket event handler in `App.jsx` that automatically joins the socket room and initiates key exchange (fire-and-forget, 0 retries) for any new conversation created by another user. The key will be established either immediately (if the peer is online) or when the user opens the conversation.

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

### 2.2 Key Exchange Event Gap During Conversation Switch — ✅ FIXED

**Severity**: 🟡 Medium → ✅ Fixed  
**Files**: `apps/web-client/src/App.jsx`, `apps/web-client/src/hooks/useMessages.js`

**Problem**: Key exchange events were handled by two split listeners (useMessages for active, App.jsx global for others). During conversation switches, a brief gap existed where events for either conversation could be missed.

**Fix applied**: Replaced the split key_exchange listener architecture with a single unified global handler in `App.jsx`. The handler processes key_exchange events for **all** conversations without skipping the active one. The useMessages hook no longer registers its own key_exchange listener, eliminating the gap entirely.

---

### 2.3 Peer Key Selection Uses `.find()` Without Deduplication — ✅ FIXED

**Severity**: 🟢 Low → ✅ Fixed  
**Files**: `apps/web-client/src/services/cryptoService.js`

**Problem**: `exchangeData.find((e) => e.userId !== myUserId)` picked the **first** match without considering which entry was the most recent.

**Fix applied**: Added `_findLatestPeerEntry()` helper that filters by peer, sorts by `createdAt` descending, and picks the most recent entry. This ensures that stale entries from old devices don't shadow the latest one.

---

## 3. Socket / Real-Time Messaging Issues

### 3.1 Sender Receives Their Own Message Back via `io.to()` Broadcast — ✅ FIXED

**Severity**: 🟡 Medium → ✅ Fixed  
**Files**: `apps/web-client/src/hooks/useMessages.js`

**Problem**: The server uses `io.to(conversationId).emit('message', message)` which broadcasts to all sockets including the sender. Without optimistic local updates, users had to wait for the full roundtrip before seeing their message.

**Fix applied**: The `sendMsg` function now adds the message to the local state and cache **immediately** with an `_optimistic: true` marker before the server roundtrip. When the server echo arrives, the deduplication logic detects the same message ID and replaces the optimistic version with the server-confirmed one. This eliminates perceived latency.

---

### 3.2 No Message Deduplication — ✅ FIXED

**Severity**: 🟡 Medium → ✅ Fixed  
**Files**: `apps/web-client/src/hooks/useMessages.js:123-139`, `apps/web-client/src/services/messageCache.js`

**Problem**: The `onMessage` handler appends incoming messages without checking if the message already exists.

**Fix applied**: Added deduplication checks in both `useMessages.js` (`setMessages` callback checks `prev.some(m => m.id === msg.id)`) and `messageCache.js` (`appendCachedMessage` skips if the message ID already exists in the cache).

---

### 3.3 `key_exchange` Socket Event Uses `socket.to()` But Has No Persistence Guarantee — ACCEPTABLE

**Severity**: 🟡 Medium → ✅ Acceptable as-is  
**Files**: `apps/server/websocket.js:121`

**Problem**: The `key_exchange` socket event is forwarded to peers using `socket.to(conversationId).emit(...)`. If the peer is offline or not in the room, the event is lost. The key exchange data **is** persisted in the database (via the REST API), so the socket notification is fire-and-forget.

**Assessment**: This is acceptable because:
1. The REST API serves as the persistent fallback — `setupConversationKey` polls via `getKeyExchange()` with retries.
2. The background preloader runs on app load and establishes keys for all existing conversations.
3. New conversations now trigger automatic key exchange via the `new_conversation` handler (Issue 1.4 fix).
4. The unified key_exchange handler (Issue 2.2 fix) ensures no events are missed while the app is connected.

---

## 4. UI & Client Logic Issues

### 4.1 NewConversationModal Doesn't Support Multiple Participants for Group Chats — ✅ FIXED

**Severity**: 🟠 High → ✅ Fixed  
**Files**: `apps/web-client/src/components/NewConversationModal.jsx`

**Problem**: The modal's UI suggested comma-separated usernames for group chats, but `handleCreate` only resolved a single username.

**Fix applied**: The `handleCreate` function now splits the input by commas for group chats, resolves each username individually via `searchUsers()`, and collects all matched user IDs into the `participants` array. If any username is not found, it shows a specific error message identifying the missing user.

---

### 4.2 No Unread Message Indicators — ✅ FIXED

**Severity**: 🟡 Medium → ✅ Fixed  
**Files**: `apps/web-client/src/services/messageCache.js`, `apps/web-client/src/App.jsx`, `apps/web-client/src/components/ConversationList.jsx`

**Problem**: The conversation list showed no indication of unread messages.

**Fix applied**: 
- Added unread count tracking in `messageCache.js` (`incrementUnread`, `clearUnread`, `getUnreadCount`, `onUnreadChange`).
- The global message handler in `App.jsx` calls `incrementUnread()` for any message arriving in a non-active conversation.
- `handleSelectConversation` calls `clearUnread()` when the user switches to a conversation.
- `ConversationList.jsx` displays purple badges with unread counts next to each conversation name.
- A change listener triggers re-renders when unread counts change.

---

### 4.3 `new_conversation` Event Payload Lacks Display Data — ✅ FIXED

**Severity**: 🟢 Low → ✅ Fixed  
**Files**: `apps/server/routes/conversations.js`

**Problem**: The `new_conversation` event payload only contained the raw conversation record, lacking `participant_usernames`, `participant_ids`, and `has_deleted_participant` fields.

**Fix applied**: The server now fetches an enriched conversation record (with JOINed participant usernames and IDs) before emitting the `new_conversation` event. The response to the conversation creator is also enriched.

---

### 4.4 `activeConversation` Stored in `localStorage` Can Become Stale — ✅ FIXED

**Severity**: 🟢 Low → ✅ Fixed  
**Files**: `apps/web-client/src/App.jsx`

**Problem**: The active conversation was persisted to `localStorage` and restored on page load without validation. If the conversation was deleted or the user was removed, stale data would be displayed.

**Fix applied**: On mount, `MessengerView` fetches the full conversation list and validates the stored `activeConversation`. If the conversation no longer exists (or the user was removed), it's cleared. If it does exist, the stored data is refreshed with the latest from the server (e.g. updated `has_deleted_participant` status).

---

## 5. Privacy & Security Concerns

### 5.1 `user_connected` / `user_disconnected` Broadcast to All Users — ✅ FIXED

**Severity**: 🟡 Medium → ✅ Fixed  
**Files**: `apps/server/websocket.js`

**Problem**: Connection and disconnection events were broadcast globally to all connected users.

**Fix applied**: Presence events are now scoped to users who share at least one conversation with the connecting/disconnecting user. A SQL query fetches distinct peer user IDs from `conversation_participants`, and events are emitted only to those users' personal rooms.

---

### 5.2 `user_deleted` Event Broadcast to All Connected Users — ✅ FIXED

**Severity**: 🟡 Medium → ✅ Fixed  
**Files**: `apps/server/routes/auth.js`

**Problem**: When a user deleted their account, the event was broadcast globally to all connected users.

**Fix applied**: The `user_deleted` event is now only emitted to users who share at least one conversation with the deleted user, using the same peer-discovery query as the presence events.

---

## Summary

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1.1 | ~~Stale key exchange entries after re-login~~ | ✅ Not a bug | Key Exchange |
| 1.2 | ~~No socket room cleanup (no `leave_conversation`)~~ | ✅ Fixed | Socket |
| 1.3 | ~~Messages for non-active conversations silently dropped~~ | ✅ Fixed | Messaging |
| 1.4 | ~~New conversations don't trigger key preloading~~ | ✅ Fixed | Key Exchange |
| 1.5 | ~~Race condition in concurrent `setupConversationKey`~~ | ✅ Fixed | Key Exchange |
| 2.1 | Group chat encryption fundamentally broken | 🔴 Deferred | Encryption |
| 2.2 | ~~Key exchange event gap during conversation switch~~ | ✅ Fixed | Key Exchange |
| 2.3 | ~~Peer key selection without deduplication~~ | ✅ Fixed | Key Exchange |
| 3.1 | ~~No optimistic UI update for sent messages~~ | ✅ Fixed | UX |
| 3.2 | ~~No message deduplication~~ | ✅ Fixed | Messaging |
| 3.3 | Socket key_exchange not persistent | ✅ Acceptable | Socket |
| 4.1 | ~~Group chat creation UI broken~~ | ✅ Fixed | UI |
| 4.2 | ~~No unread message indicators~~ | ✅ Fixed | UX |
| 4.3 | ~~`new_conversation` payload lacks display data~~ | ✅ Fixed | API |
| 4.4 | ~~Stale active conversation in localStorage~~ | ✅ Fixed | State |
| 5.1 | ~~Presence events broadcast globally~~ | ✅ Fixed | Privacy |
| 5.2 | ~~`user_deleted` event broadcast globally~~ | ✅ Fixed | Privacy |

### Root Cause Analysis for the Reported Multi-User Bug

The primary symptoms reported — **"chats of other user coming in the second chat, message of third user not being delivered, second chat not working properly"** — were caused by:

1. **Issue 1.5** (race condition in key setup — **fixed**) — When the background preloader and user actions overlapped, ephemeral keys got overwritten, causing key mismatches.  Both the preloader and `useMessages` hook called `setupConversationKey` concurrently for the same conversation, generating conflicting ephemeral key pairs.  **A per-conversation lock now prevents this.**

2. **Issue 1.3** (dropped messages for non-active conversations — **fixed**) — Messages arriving for a non-active conversation were silently discarded by the `useMessages` filter.  When switching back, the user didn't see recent messages until a full server refresh, creating the perception that "messages of the third user are not being delivered."  **A global message handler now decrypts and caches these messages.**

3. **Issue 3.2** (no message deduplication — **fixed**) — Socket reconnection or server broadcast could cause the same message to appear twice.  **Deduplication checks now prevent this.**

4. **Issue 1.4** (no key preloading for new conversations — **fixed**) — When a third user created a conversation, the key exchange and room joining didn't happen automatically.  **The `new_conversation` event handler now auto-joins the room and initiates key exchange.**

5. **Issue 1.2** (no socket room cleanup — **fixed**) — Users accumulated room memberships, causing unnecessary traffic and processing overhead.  **`leave_conversation` now cleans up rooms when switching.**

6. **Issue 2.2** (key exchange event gap — **fixed**) — Split key_exchange listeners had a gap during conversation switches.  **A single unified handler eliminates the gap.**

**Note on stale key exchange entries (Issue 1.1):** The previous analysis incorrectly identified this as a bug.  Preserving old device keys is **intentional** — it ensures that users whose JWT sessions expire (automatic timeout) can still decrypt old conversations after re-login.  The session management has been improved: JWT expiry extended from 24 h → 30 days, and a token refresh endpoint now silently renews the token every time the app is opened.

### Why Direct Messages Should Work (And Now Do)

The ECDH key exchange is **pairwise by design**.  For direct messages (1:1 conversations), each side generates one ephemeral key pair per conversation.  The per-conversation key derivation (`conversationId` used as HKDF salt) ensures that multiple DM conversations produce **independent** conversation keys.  The bugs that were breaking multi-DM scenarios were:

- The race condition (Issue 1.5) causing key overwrites during concurrent setup
- Dropped messages (Issue 1.3) giving the appearance of undelivered messages
- Missing room cleanup (Issue 1.2) causing unnecessary event traffic
- Key exchange gaps (Issue 2.2) during rapid conversation switching
- No preloading for new conversations (Issue 1.4) delaying first message delivery

All are now fixed.  Group chats (3+ participants) remain fundamentally limited because ECDH only works between two parties — this requires a separate group key agreement protocol (Issue 2.1, deferred).

### Remaining Issue

**Issue 2.1 — Group Chat Encryption** is the only remaining open issue.  The ECDH key exchange is pairwise by design and cannot support 3+ participants without a protocol redesign (e.g., sender keys, shared group key wrapped per-participant).  The group chat creation UI now correctly supports adding multiple users (Issue 4.1), but **encryption in group chats will only work between the conversation creator and each individual participant**, not across all participants.  A full solution requires:

1. A group key generation and distribution protocol
2. Per-participant key wrapping using pairwise ECDH keys
3. Server-side storage for wrapped group keys
4. Re-keying when participants join or leave

This is a significant architectural change that should be designed and implemented as a dedicated feature.
