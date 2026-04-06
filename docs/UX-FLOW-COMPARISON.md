# Blink-Text UX Flow Comparison

> **Compared against**: Signal, Telegram, WhatsApp, SimpleX, Session
>
> **Focus**: How conversations start, how E2E encryption is established & maintained, message delivery reliability, state persistence on refresh, and group chat UX — **not** UI features or visual design.

---

## Table of Contents

1. [Conversation Initiation](#1-conversation-initiation)
2. [E2E Encryption Establishment](#2-e2e-encryption-establishment)
3. [Message Delivery & Reliability](#3-message-delivery--reliability)
4. [State Persistence on Refresh / Restart](#4-state-persistence-on-refresh--restart)
5. [Group Chat Flows](#5-group-chat-flows)
6. [Identified Pain Points in Blink-Text](#6-identified-pain-points-in-blink-text)
7. [Summary Matrix](#7-summary-matrix)
8. [Recommendations](#8-recommendations)

---

## 1. Conversation Initiation

### Signal

- **DMs**: User enters a phone number or selects a contact. Signal checks the server for a registered user. If found, the conversation is created **instantly** — no handshake is needed from the recipient. The sender can type and send immediately; encryption is set up transparently using prekeys the recipient uploaded ahead of time.
- **Groups**: Creator selects members from contacts, gives the group a name, and hits create. All members are added atomically. Signal v2 groups use cryptographic group state (signed by admins) so the server cannot silently add members.
- **UX feel**: Instant. No loading spinners, no "waiting for key exchange", no PoW delays. Conversation is usable the moment you tap "send".

### Telegram

- **Cloud chats (default)**: Tap "New Message", select a contact. The conversation is instantly available because Telegram uses server-side encryption — no client-side key exchange needed.
- **Secret Chats (E2E)**: User explicitly starts a "Secret Chat". The recipient **must be online** to complete the Diffie-Hellman handshake. If they're offline, the request sits pending. This is a known friction point.
- **Groups**: Creator adds members from contacts. Groups are cloud-encrypted only — no E2E option for groups.
- **UX feel**: Cloud chats are instant. Secret chats require both parties online, which is friction but clearly communicated.

### WhatsApp

- **DMs**: User taps "New Chat", selects a contact (phone number based). Conversation is created instantly. E2E encryption is established transparently via prekeys (X3DH), just like Signal. Users never see or wait for key exchange.
- **Groups**: Creator selects up to 1024 members, names the group. Members are added immediately. Sender Keys are distributed automatically in the background via pairwise encrypted channels.
- **UX feel**: Instant. Encryption is completely invisible to the user. "It just works."

### SimpleX

- **DMs**: User generates a one-time invitation (QR code or link) and shares it out-of-band (copy-paste, show screen, etc.). The recipient scans/imports the invitation. Both sides perform X3DH key exchange and start a double ratchet session. Each direction uses a unique, single-use queue on a relay server.
- **Groups**: Creator generates a group and shares invitation links with each member individually.
- **UX feel**: Intentionally manual. The out-of-band exchange is a deliberate privacy feature (no server-side contact discovery), but it creates more friction than phone-number-based apps. The trade-off is maximum metadata privacy.

### Session

- **DMs**: User enters a Session ID (a long alphanumeric public key) or scans a QR code. The conversation is created and the first message can be sent immediately — encryption is established using the recipient's public key, and messages are queued in the recipient's swarm until they come online.
- **Groups**: Creator creates a closed group and adds members by Session ID. Each member establishes pairwise E2E channels with every other member. Limited to ~100 members.
- **UX feel**: Sending is instant (async-capable via swarm storage). Contact discovery is manual (Session ID exchange), which is intentional but adds friction.

### Blink-Text (This App)

- **DMs**: User opens "New Conversation" modal, types a username, and the app searches the user database. If found, `createConversation()` is called. A conversation entry is created on the server. Then:
  1. An ephemeral ECDH keypair is generated client-side
  2. The public key is published to the server via `storeKeyExchange()`
  3. A `key_exchange` socket event is emitted
  4. The app **waits for the peer's ephemeral public key** to arrive
  5. If the peer is offline or hasn't opened the conversation yet, the key exchange **stalls**
  6. Messages typed before key exchange completes are queued in-memory with a clock icon
  7. Once the peer publishes their key, ECDH derivation happens, a `key_confirm` handshake follows, and only then do queued messages flush
- **Groups**: User creates a group or room via the modal. Then:
  1. Each member must generate a sender key
  2. Each member must establish a **pairwise ECDH channel** with every other member
  3. Sender keys are encrypted and distributed via these pairwise channels
  4. If any member hasn't opened the conversation yet, their pairwise ECDH is incomplete
  5. The sender key distribution is incomplete until all pairwise exchanges finish
  6. `sender_key_request` events are used to ask lagging members to distribute keys
- **Rooms (invite links)**: A slug-based invite link is generated. Guests must solve a Proof-of-Work challenge (SHA-256, difficulty 18) before joining — can take several seconds of CPU time. Then guest crypto setup follows the same group flow.
- **UX feel**: **Noticeably slow and fragile**. The multi-step key exchange is visible to the user (pending messages, delays). If both peers aren't online, the conversation feels broken. Group setup has even more moving parts that can stall.

#### Key Differences

| Aspect | Signal / WhatsApp | Telegram | SimpleX | Session | Blink-Text |
|--------|-------------------|----------|---------|---------|------------|
| **Can send immediately?** | ✅ Yes (prekeys) | ✅ Cloud / ❌ Secret (needs peer online) | ❌ Needs OOB invite exchange | ✅ Yes (async via swarm) | ❌ Needs peer to be online for key exchange |
| **Key exchange visible?** | No — invisible | No (cloud) / Minimal (secret) | One-time invite exchange | No — invisible | Yes — pending messages, delays |
| **Group creation friction** | Low — instant | Low — instant | Medium — per-member invites | Medium — Session ID per member | High — multi-step pairwise + sender key setup |
| **Requires PoW to join?** | No | No | No | No | Yes (guest rooms) |

---

## 2. E2E Encryption Establishment

### Signal

- **Protocol**: X3DH for initial key agreement + Double Ratchet for ongoing.
- **Prekey bundles**: Each device uploads Identity Key + Signed Prekey + multiple One-Time Prekeys to the server. When someone starts a conversation, they fetch the recipient's prekey bundle and derive a shared secret **without needing the recipient to be online**. This is the critical UX advantage.
- **Double Ratchet**: After the first message, both sides engage in a symmetric + DH ratchet that rotates keys with every message, providing forward secrecy and post-compromise recovery.
- **Key verification**: Optional — users can compare Safety Numbers in person.
- **Failure mode**: Graceful. If a prekey is used up, the server falls back to Signed Prekey only. The sender can always encrypt and send.

### Telegram

- **Cloud chats**: MTProto protocol, server-client encryption only. Server has keys. No E2E.
- **Secret chats**: Standard Diffie-Hellman key exchange (not X3DH). Both parties must be online simultaneously. After exchange, messages are encrypted with AES-256 (MTProto 2.0 uses AES-256-CTR with SHA-256-based key derivation, replacing the older IGE mode). No Double Ratchet — forward secrecy is limited to periodic re-keying.
- **Failure mode**: Secret chat creation simply waits if the peer is offline. Clear status indicator.

### WhatsApp

- **Protocol**: Signal Protocol (X3DH + Double Ratchet) for DMs. Sender Keys protocol for groups.
- **Sender Keys (groups)**: Each member generates a symmetric Sender Key + signing keypair. The Sender Key is distributed to all group members via their pairwise X3DH channels. Messages are encrypted once with the Sender Key (O(1) encryption). Hash ratchet on the Sender Key provides per-message forward secrecy.
- **Key verification**: Optional — users can compare Security Code (QR or 60-digit number).
- **Failure mode**: Transparent. If a member's key changes (new device), the group re-distributes Sender Keys automatically. Users may see a "security code changed" notification.

### SimpleX

- **Protocol**: Custom X3DH variant (using Curve448) + Double Ratchet.
- **Double encryption**: Messages are encrypted twice — once by the conversation-level double ratchet (E2E), and again by the delivery queue layer (to protect metadata from the relay server).
- **No prekeys on server**: Keys are exchanged via the out-of-band invitation. No server-stored prekey bundles.
- **Post-quantum**: Integrating post-quantum key exchange (ML-KEM) as an additional layer.
- **Failure mode**: If the invitation is intercepted, a MITM is possible. Users are encouraged to verify keys in-person.

### Session

- **Protocol**: Modified Signal Protocol without the X3DH prekey system.
- **Key exchange**: Based on the recipient's public Session ID. The sender encrypts directly to the recipient's public key. No Signed Prekeys or One-Time Prekeys.
- **Network layer**: Messages routed through onion routing (3-hop) to hide sender IP and metadata.
- **Groups**: Pairwise E2E channels between all members (not Sender Keys). O(n) encryption per message. Limits group size.
- **Failure mode**: If the recipient's swarm nodes are unavailable, messages are queued until nodes are reachable.

### Blink-Text (This App)

- **Protocol**: Custom — ECDH P-256 ephemeral keypairs + HKDF-SHA-256 derivation + symmetric chain ratchet.
- **DM key exchange**: Interactive — requires both peers to publish ephemeral keys. **No prekey system**. The sender cannot encrypt until the recipient has also published their key and the ECDH derivation + key confirmation handshake complete.
- **Key confirmation**: HMAC-SHA256 token exchanged over socket. If mismatch, keys are wiped and re-negotiated (up to 3 retries).
- **Groups (Sender Key protocol)**: Each member generates a 256-bit AES sender key. Distribution requires pairwise ECDH with every other member. This is a **correct E2E design** (unlike the broken group crypto described in ISSUES.md §2.1, which has been replaced) but involves many round-trips:
  1. Generate sender key
  2. For each peer: generate pairwise ECDH keypair → publish → fetch peer's key → derive pairwise wrapping key
  3. Encrypt sender key with each pairwise wrapping key
  4. POST all encrypted copies to server
  5. Fetch and decrypt each peer's sender key
  6. Handle late-joiners via `sender_key_request` events
- **Chain ratchet**: Symmetric-only (HKDF-based). Advances a counter for each message. **No DH ratchet** — keys don't rotate with each exchange like Signal's Double Ratchet. This means there is **no post-compromise recovery**: if a root key is compromised, all future messages in that conversation are readable until the conversation is re-keyed.
- **Failure modes**:
  - Peer offline → key exchange stalls indefinitely, messages queue in memory
  - Key confirmation mismatch → wipe + retry (up to 3 times), then silently fail
  - Group pairwise exchange incomplete → sender key distribution stalls for that peer
  - Browser refresh → in-memory queued messages lost

#### Key Differences

| Property | Signal | Telegram (Secret) | WhatsApp | SimpleX | Session | Blink-Text |
|----------|--------|--------------------|----------|---------|---------|------------|
| **Async-capable?** | ✅ Yes (prekeys) | ❌ No | ✅ Yes (prekeys) | ❌ No (OOB invite) | ✅ Yes (swarm) | ❌ No (interactive) |
| **DH Ratchet?** | ✅ Double Ratchet | ❌ Periodic re-key | ✅ Double Ratchet | ✅ Double Ratchet | ✅ Modified | ❌ Symmetric only |
| **Forward secrecy** | ✅ Per-message | ⚠️ Periodic | ✅ Per-message | ✅ Per-message | ✅ Per-message | ✅ Per-message (chain) |
| **Post-compromise recovery** | ✅ DH ratchet | ❌ Limited | ✅ DH ratchet | ✅ DH ratchet | ⚠️ Modified | ❌ No DH ratchet |
| **Group E2E** | ✅ Sender Keys | ❌ None | ✅ Sender Keys | ✅ Double Ratchet | ✅ Pairwise | ✅ Sender Keys |
| **Key verification** | ✅ Safety Numbers | ✅ Fingerprint visual | ✅ Security Code | ✅ OOB verify | ⚠️ Session ID compare | ❌ None exposed to user |

---

## 3. Message Delivery & Reliability

### Signal

- Messages are delivered via the Signal server. If the recipient is offline, messages are stored encrypted on the server and delivered when they come online.
- **Delivery receipts**: Single check = sent to server, double check = delivered to device.
- **Read receipts**: Optional, blue checks.
- **Offline resilience**: Excellent. Messages never lost, even if offline for weeks. Server holds encrypted messages until delivered.
- **Multi-device**: Signal syncs across linked devices. Each device has its own session.

### Telegram

- **Cloud chats**: Messages stored on Telegram's servers indefinitely. Available on any device. Never lost.
- **Secret chats**: Device-specific. If the recipient is offline, messages queue on the server encrypted. Delivered when online. No multi-device sync for secret chats.
- **Delivery/read receipts**: ✓ (sent) / ✓✓ (read).
- **Offline resilience**: Excellent for cloud chats (server-stored). Good for secret chats (queued until online).

### WhatsApp

- Messages stored encrypted on server until delivered. After delivery, deleted from server.
- **Delivery/read receipts**: Single gray check = sent, double gray = delivered, blue = read.
- **Offline resilience**: Excellent. Messages queued server-side. Even if offline for weeks, messages arrive on reconnect.
- **Multi-device**: Up to 4 linked devices, each with independent sessions.

### SimpleX

- Messages are stored temporarily on relay servers (SMP protocol). Each queue is single-use and unidirectional.
- **Offline resilience**: Good. Messages queued on relay until recipient connects. Relay retention period varies.
- **Delivery receipts**: Supported but configurable.
- **Ephemeral by design**: Messages can be set to auto-delete. No permanent server storage.

### Session

- Messages are stored in the recipient's "swarm" (decentralized node cluster) for a limited time (~14 days).
- **Offline resilience**: Good within the retention window. If offline for more than ~14 days, messages may be lost.
- **Delivery receipts**: Supported.
- **Onion routing**: Adds latency (3 hops) but hides sender metadata.

### Blink-Text (This App)

- Messages are stored in SQLite on the server (encrypted blobs). Available on reconnect.
- **Delivery receipts**: Not implemented. No read/delivered indicators.
- **Offline resilience**: **Partial**.
  - If the user is offline when a message arrives, it's stored in the DB. On reconnect, messages are fetched via API.
  - However, **messages for non-active conversations** were previously silently dropped (ISSUES.md §1.3, now fixed). A global handler in `App.jsx` now caches these.
  - **In-memory queued messages** (pending key exchange) are **lost on page refresh** — there is no persistent queue.
- **Real-time delivery concerns**:
  - Messages are relayed via Socket.io. If the socket disconnects briefly, messages may be missed. Socket.io has auto-reconnect, but there's no explicit "catch up on missed messages" mechanism beyond refetching on reconnect.
  - In group chats, if a member's sender key is not yet available, **decryption fails** for messages from that sender. The message shows as "Unable to decrypt" or may not appear at all. The member must refresh or wait for sender key distribution to complete.
  - The app has no mechanism to **retry decryption** of previously undecryptable messages once keys arrive (except on full page refresh which reloads from server).

#### Key Differences

| Property | Signal | Telegram | WhatsApp | SimpleX | Session | Blink-Text |
|----------|--------|----------|----------|---------|---------|------------|
| **Server-side queuing** | ✅ Until delivered | ✅ Indefinite (cloud) | ✅ Until delivered | ✅ Temporary (relay) | ✅ ~14 days (swarm) | ✅ Indefinite (SQLite) |
| **Survives page refresh** | N/A (native app) | N/A (native app) | N/A (native app) | N/A (native/desktop) | N/A (native/desktop) | ⚠️ Mostly — but in-memory queue lost |
| **Pending message queue persisted** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ In-memory only |
| **Delivery receipts** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ None |
| **Retry undecryptable messages** | ✅ Automatic | N/A | ✅ Automatic | ✅ | ✅ | ❌ No retry mechanism |

---

## 4. State Persistence on Refresh / Restart

### Native Apps (Signal, Telegram, WhatsApp, Session)

Native apps store all state locally:
- **Conversation list**: Persisted in local database (SQLite, Realm, etc.)
- **Messages**: Cached locally, synced from server on reconnect
- **Crypto keys**: Stored in OS keychain or encrypted local database
- **Session state**: Persistent across app kills and device reboots
- **Result**: Opening the app = instant access to all conversations, messages, and crypto state. No re-setup needed.

### SimpleX (Desktop/Native)

- All state persisted in local encrypted database
- Keys stored locally
- Same resilience as native apps

### Blink-Text (This App — Web-Based)

Being a web app introduces unique challenges that native apps don't face:

- **Auth state**: JWT stored in `localStorage`. Survives refresh. Verified on load via `/api/auth/verify`.
- **Crypto keys (long-term)**: Identity key + ECDH key stored in IndexedDB (`blink-crypto` database). Survives refresh. ✅
- **Device ID**: Stored in `localStorage`. Survives refresh. ✅
- **Ephemeral conversation keys**: Stored in IndexedDB per conversation (`ephemeral-{convId}`). Survives refresh. ✅
- **Derived conversation keys (root key)**: Stored **in-memory only** (`conversationKeys` Map). **Lost on refresh**. Must be re-derived from stored ephemeral keypairs. ❌
- **Group sender keys (my key)**: Stored in IndexedDB (`group-sk-{convId}`). Survives refresh. ✅
- **Peer sender keys**: Stored in IndexedDB (`group-pk-{convId}-{userId}`). Survives refresh. ✅
- **Chain ratchet state (send/receive counters)**: Stored **in-memory only**. **Lost on refresh**. ❌
- **In-memory message queue**: **Lost on refresh**. ❌
- **Conversation list**: Refetched from API on refresh. ✅
- **Messages**: Refetched from API on refresh. Must be re-decrypted with re-derived keys. ✅ (if keys re-derive successfully)

**What goes wrong on refresh**:

1. **Key re-derivation race**: On refresh, `initializeIdentity()` loads keys from IndexedDB, then each active conversation calls `setupConversationKey()` to re-derive the root key. This involves checking the server for the peer's ephemeral key. If the server or network is slow, the conversation appears empty while waiting.

2. **Chain counter reset**: Because chain ratchet state is in-memory, after refresh the chain resets to 0. In practice this is handled gracefully — the app reads the `chainIdx` from each message payload and derives the key at that specific counter rather than relying on local state. However, if messages arrive out of order with large counter gaps after a refresh, the app must derive many intermediate keys, which can add latency.

3. **Group key re-setup**: Group crypto involves re-loading sender keys from IndexedDB and re-checking pairwise ECDH state. If any pairwise key is missing from IndexedDB (e.g., evicted, corrupted, or never stored), the entire group setup stalls until that pairwise exchange is re-done.

4. **Empty conversation on refresh**: If key re-derivation fails (peer's ephemeral key expired on server, network error during setup, IndexedDB read error), the conversation shows **zero messages** because the ciphertext from the server cannot be decrypted. There may not even be "unable to decrypt" placeholders — the conversation simply appears empty.

5. **Socket room re-join**: On refresh, the client must re-join socket rooms for all active conversations. There's a brief window where messages sent during refresh are missed entirely.

---

## 5. Group Chat Flows

### Signal

- **Member addition**: Admin adds members. Each new member gets the group state (signed by admin keys). Sender Keys are distributed transparently via pairwise sessions.
- **Member removal/key rotation**: When a member is removed, all remaining members rotate their Sender Keys. The removed member cannot decrypt future messages.
- **Message delivery**: Server fans out a single encrypted message to all members. O(1) encryption per message.
- **New member message history**: New members can see messages from before they joined (configurable by admin). History is sent by existing members, re-encrypted for the new member.
- **Cryptographic group state**: Group membership changes are signed by admin keys, preventing the server from silently adding members.

### Telegram

- **No group E2E**. Groups use server-client encryption only. Server sees all group messages in plaintext.
- **Member addition**: Instant, no key exchange.
- **Message history**: New members see full history (configurable).
- **Delivery**: Reliable — server stores everything.

### WhatsApp

- **Member addition**: Admin adds members. New Sender Keys are generated and distributed via pairwise E2E channels.
- **Member removal/key rotation**: Sender Keys are rotated for remaining members. Removed member loses access to future messages.
- **Message delivery**: Server fans out. Reliable with delivery receipts.
- **New member history**: New members do **not** see messages from before they joined (by design, for privacy).
- **Server trust**: Group membership is **not** cryptographically signed — the server is trusted to maintain the correct member list. This is a known limitation compared to Signal.

### SimpleX

- **Groups**: Each member has a pairwise double ratchet session with every other member. O(n) encryption per message. Limits practical group size.
- **No server-managed membership**: Group state is managed by participants, not the server.
- **UX**: More overhead for group management, but maximum privacy.

### Session

- **Closed groups**: Pairwise E2E channels between all members. O(n) encryption. Group limit ~100 members.
- **Open groups**: Public channels with reduced privacy (server-managed).
- **Member addition**: By Session ID. Each existing member establishes a new pairwise session.
- **Key rotation on removal**: Members rotate keys when someone leaves.

### Blink-Text (This App)

- **Sender Key protocol**: Each member generates a 256-bit AES sender key. Sender keys are wrapped with pairwise ECDH-derived keys and distributed to each member individually.
- **Member addition**:
  1. New member joins (via admin invite or room link)
  2. Server emits `user_joined` + `sender_key_request` to existing members
  3. Each existing member must:
     - Establish pairwise ECDH with the new member (publish key → wait for new member's key → complete ECDH)
     - Encrypt their sender key with the pairwise wrapping key
     - Send encrypted copy to server
  4. New member must do the same in reverse
  5. **If any existing member is offline during this process**, the new member cannot decrypt that member's messages until the offline member comes online and completes the pairwise exchange
- **Member removal/key rotation**: On kick, remaining members call `rotateMySenderKey()`:
  1. Generate new sender key with incremented generation
  2. Delete old sender key from server
  3. Encrypt new key for remaining members only
  4. Distribute via `sender_key_distributed` event
  5. **If any remaining member is offline**, they won't get the new sender key until they come online and the distribution is retried
- **New member history**: New members **cannot** see old messages (correct E2E behavior, same as WhatsApp).
- **Known UX issues**:
  - **Stalled decryption**: If a peer's sender key hasn't been received yet, their messages show as "Unable to decrypt" or don't appear. There is no automatic retry — the user must refresh.
  - **Refresh-triggered re-setup**: Refreshing the page forces full group crypto re-setup. If pairwise keys aren't in IndexedDB (edge case), the group becomes partially broken.
  - **No delivery confirmation**: No way to know if sender key distribution succeeded for all members.
  - **Race conditions**: Multiple members joining simultaneously can cause overlapping pairwise exchanges and sender key distributions, leading to missed keys.

#### Group Chat Comparison

| Property | Signal | Telegram | WhatsApp | SimpleX | Session | Blink-Text |
|----------|--------|----------|----------|---------|---------|------------|
| **Group E2E** | ✅ Sender Keys | ❌ None | ✅ Sender Keys | ✅ Pairwise | ✅ Pairwise | ✅ Sender Keys |
| **Encryption cost per message** | O(1) | O(1) | O(1) | O(n) | O(n) | O(1) |
| **Max group size** | ~1000 | 200,000 | 1024 | ~50 practical | ~100 | 200 |
| **Key rotation on member leave** | ✅ Auto | N/A | ✅ Auto | ✅ Manual | ✅ Auto | ✅ Auto |
| **Works if some members offline** | ✅ | ✅ | ✅ | ⚠️ Delayed | ⚠️ Delayed | ❌ Stalls |
| **Cryptographic membership** | ✅ Signed | ❌ Server trust | ❌ Server trust | ✅ | ⚠️ Partial | ❌ Server trust |
| **New member sees old messages** | ⚙️ Configurable | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 6. Identified Pain Points in Blink-Text

Based on the deep dive into the codebase and comparison with industry standards, here are the specific UX pain points:

### 6.1 — Conversation Start Feels Broken

**The problem**: Starting a new DM requires an interactive key exchange. Unlike Signal/WhatsApp (which use prekeys for async setup), Blink-Text requires both peers to be online and actively participate in the key exchange. Until the peer publishes their ephemeral key, the conversation is in a limbo state — messages queue in-memory with a clock icon.

**What users experience**: "I created a conversation but I can't send messages. It says pending. I have to wait for the other person to open the app."

**What Signal/WhatsApp do differently**: Prekey bundles are uploaded to the server in advance. The sender fetches the recipient's prekeys and derives a shared secret immediately, without the recipient being online. The recipient completes their side of the handshake when they eventually open the app, but the sender can already send encrypted messages.

### 6.2 — Conversations Go Empty on Refresh

**The problem**: On page refresh, the in-memory `conversationKeys` Map and chain ratchet state are lost. The app must re-derive keys from stored ephemeral keypairs in IndexedDB. If this re-derivation fails (network error, peer's key not on server, IndexedDB issue), the conversation shows as completely empty — no messages at all, not even "unable to decrypt" placeholders.

**What users experience**: "I refreshed the page and my entire conversation is gone. Not even the encrypted messages show. It's just empty."

**What native apps do differently**: Native apps (Signal, WhatsApp, Telegram) store derived keys and decrypted message plaintext in OS-protected encrypted local databases (e.g., SQLCipher). Refresh/restart instantly loads cached state from this encrypted store. There's no re-derivation step.

**What Blink-Text could do**: Store derived root keys in IndexedDB (alongside the ephemeral keypairs) so they don't need to be re-derived on refresh. Show encrypted message stubs (with sender, timestamp, "unable to decrypt" label) even when keys aren't available, so conversations never appear empty.

### 6.3 — Group Chat Members Must Refresh to See Messages

**The problem**: In group chats, if a member's sender key hasn't been received (because the pairwise ECDH wasn't complete when they sent messages), those messages are silently undecryptable. There is no automatic retry mechanism — the app doesn't re-attempt decryption when missing keys arrive later.

**What users experience**: "In the group chat, some members see the messages and others don't. They have to refresh to get them. Every new member who joins has this problem."

**What Signal/WhatsApp do differently**: Sender Keys are distributed via existing pairwise sessions (established during the initial conversation creation). If a Sender Key is missing, the app automatically requests it and retries decryption. The process is invisible to the user.

**What Blink-Text could do**:
- When a `sender_key_distributed` event arrives, automatically re-decrypt any previously failed messages from that sender.
- Add a "Messages may be delayed while encryption is being set up" indicator instead of silently dropping messages.
- Cache undecryptable ciphertexts and retry decryption when the missing key arrives.

### 6.4 — No Offline/Async Messaging Support for New Conversations

**The problem**: Unlike Signal/WhatsApp, there's no prekey system. You cannot start a conversation and send messages to someone who is offline. The key exchange requires real-time interaction.

**What users experience**: "I want to send a message to my friend, but they're offline. I can't send anything until they open the app."

### 6.5 — Proof-of-Work Barrier for Guest Room Joins

**The problem**: Guest users joining rooms must solve a SHA-256 proof-of-work challenge (difficulty 18). While this is a legitimate anti-spam measure, it adds visible latency (several seconds of CPU work) and can be confusing to users.

**What users experience**: "I clicked the invite link and it just spins for a while before I can join."

**What other apps do**: Rate limiting, CAPTCHAs, or phone number verification. None require client-side PoW for joining conversations.

### 6.6 — No Message Delivery/Read Receipts

**The problem**: There are no delivery or read receipts. Users have no way to know if their message was received, delivered, or read.

**What users experience**: "I sent a message but I don't know if it was delivered. There's no checkmark or anything."

### 6.7 — Chain Ratchet State Lost on Refresh

**The problem**: The symmetric chain ratchet state (send/receive counters) is in-memory only. On refresh, the chain resets. While the app handles this by using `chainIdx` from message payloads, there's a risk of key derivation mismatches if messages arrive out of order after a refresh.

---

## 7. Summary Matrix

| UX Flow | Signal | Telegram | WhatsApp | SimpleX | Session | Blink-Text |
|---------|--------|----------|----------|---------|---------|------------|
| **Instant conversation start** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ (cloud) ⭐⭐⭐ (secret) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Async messaging (peer offline)** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ (cloud) ⭐⭐ (secret) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ |
| **E2E encryption strength** | ⭐⭐⭐⭐⭐ | ⭐⭐ (cloud) ⭐⭐⭐⭐ (secret) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **State persistence (refresh/restart)** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **Group chat reliability** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Message delivery confidence** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Metadata privacy** | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Onboarding friction** | ⭐⭐⭐⭐ (phone req) | ⭐⭐⭐⭐ (phone req) | ⭐⭐⭐⭐ (phone req) | ⭐⭐⭐ (OOB invite) | ⭐⭐⭐⭐ (no phone) | ⭐⭐⭐ (username + PoW for rooms) |

---

## 8. Recommendations

These are not code changes — just observations on what the industry leaders do differently that Blink-Text could learn from:

### High Priority (Directly Causing Bad UX)

1. **Implement a prekey system (like Signal's X3DH)**: Each device uploads Signed Prekeys + One-Time Prekeys to the server. Senders can establish keys and send messages even when the recipient is offline. This single change would eliminate the "conversation feels broken until peer is online" problem.

2. **Persist derived keys in IndexedDB**: Store the derived `conversationKeys` root keys (and chain state) in IndexedDB so they survive page refresh. This eliminates the re-derivation step and prevents conversations from going empty on refresh.

3. **Implement undecryptable message retry**: When a sender key arrives via `sender_key_distributed`, automatically re-decrypt any messages that previously failed. Cache undecryptable ciphertexts in-memory with metadata, and retry when the missing key becomes available.

4. **Show message stubs for undecryptable messages**: Never show an empty conversation when messages exist on the server. Show stubs with sender name, timestamp, and "Encrypted message — key not yet available" so the user knows messages exist.

### Medium Priority (Improving Confidence)

5. **Add delivery receipts**: At minimum, acknowledge to the sender that the server received the message (single check). Ideally, confirm delivery to the recipient's device (double check).

6. **Add a "setting up encryption" indicator**: When key exchange is in progress, show a clear banner: "Setting up secure connection..." with a progress indicator. This is better than silently queuing messages with a clock icon.

7. **Persist the message send queue**: Store pending messages in IndexedDB instead of in-memory so they survive refresh.

### Lower Priority (Protocol Improvements)

8. **Add a DH ratchet (Double Ratchet)**: The current symmetric-only chain ratchet provides forward secrecy but no post-compromise recovery. Adding a DH ratchet step (new ephemeral DH exchange interspersed with messages) would bring Blink-Text's crypto closer to Signal's security properties.

9. **Expose key verification to users**: Allow users to compare fingerprints (like Signal's Safety Numbers) to detect MITM attacks.

10. **Consider removing PoW for room joins**: Replace with rate limiting + CAPTCHA for better UX while maintaining anti-spam protection. PoW is unusual for messaging apps and can confuse users.

---

*Document generated from codebase analysis of blink-text at commit HEAD, compared against publicly documented protocols of Signal, Telegram, WhatsApp, SimpleX, and Session.*
