# Blink-Text — Remaining Feature Implementation Plan

> Generated: 2026-03-16
> Status: **Planning** — not yet implemented
> Features covered: Large File Uploads (10 GB), WebRTC Calling, Group E2E Encryption

---

## Table of Contents

1. [Feature 4: Large File Uploads (up to 10 GB)](#feature-4-large-file-uploads-up-to-10-gb)
2. [Feature 5: Voice/Video Calling with WebRTC](#feature-5-voicevideo-calling-with-webrtc)
3. [Feature 6: Group End-to-End Encryption](#feature-6-group-end-to-end-encryption)
4. [Priority & Dependencies](#priority--dependencies)

---

## Feature 4: Large File Uploads (up to 10 GB)

### Difficulty: 🔴 Hard | Estimate: 20–30 hours

### Problem Statement

Current limits:
| Component | Current Limit | Required |
|-----------|---------------|----------|
| Multer `fileSize` | 100 MB | 10 GB |
| Axios `maxBodyLength` | 110 MB | 10 GB |
| **Web Crypto AES-GCM** | **~2 GB** (NIST spec hard limit: 2³⁹ − 256 bits per single encrypt call) | 10 GB |
| Browser memory | In-memory `Uint8Array` | Streaming needed |

The **critical blocker** is the Web Crypto API's AES-GCM limit of ~2 GB per operation. For 10 GB, **chunked encryption** is mandatory.

### Architecture

#### 4.1 Chunked Upload Protocol

```
Client                              Server
──────                              ──────
POST /api/media/upload-init    →    Creates media record, returns mediaId
  { conversationId, totalChunks,    State: "uploading"
    totalSize, fileName }

For each 16 MB chunk:
  File.slice(start, end)
  → AES-GCM encrypt (chunk + unique IV)
  POST /api/media/upload-chunk →    Stores chunk file as {mediaId}_chunk_{n}.enc
    { mediaId, chunkIndex, iv }     Tracks received chunks
    + binary body

POST /api/media/upload-complete →   Validates all chunks received
  { mediaId }                       State: "complete"
                                    Returns { mediaId, fileSize }
```

#### 4.2 New Server Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/media/upload-init` | POST | Initialize chunked upload, return `mediaId` |
| `/api/media/upload-chunk` | POST | Upload one encrypted chunk (multipart) |
| `/api/media/upload-complete` | POST | Finalize upload, validate all chunks |
| `/api/media/:id/info` | GET | Return chunk count + per-chunk IVs |
| `/api/media/:id/chunk/:n` | GET | Stream one encrypted chunk |

#### 4.3 New Database Table

```sql
CREATE TABLE media_chunks (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  iv TEXT NOT NULL,
  chunk_size INTEGER NOT NULL,
  PRIMARY KEY (media_id, chunk_index)
);

-- Also add to media table:
ALTER TABLE media ADD COLUMN total_chunks INTEGER DEFAULT 1;
ALTER TABLE media ADD COLUMN upload_status TEXT DEFAULT 'complete';
  -- 'uploading' | 'complete' | 'failed'
```

#### 4.4 Client-Side Changes

**New file: `services/chunkedUpload.js`**
```
export async function uploadLargeFile(conversationId, file, onProgress, abortSignal)
```
- Reads file in 16 MB slices using `File.slice(start, end)`
- Encrypts each chunk independently with AES-GCM + unique random IV
- Uploads via Axios with `onUploadProgress` for per-chunk progress
- Retry logic: 3 retries per chunk with exponential backoff (1s, 2s, 4s)
- `AbortController` integration for user cancellation
- Tracks total progress: `(completedChunks / totalChunks) * 100`

**New file: `services/chunkedDownload.js`**
```
export async function downloadLargeFile(mediaId, conversationId, onProgress)
```
- Fetches chunk info (count + IVs)
- Downloads each chunk sequentially
- Decrypts each chunk with its IV
- For files > 500 MB: use File System Access API (`showSaveFilePicker`) to write directly to disk (avoids OOM)
- For smaller files: concatenate via `new Blob([...chunks])` and create object URL

**UI changes in `MessageInput.jsx`:**
- Show upload progress bar during chunked upload
- Cancel button to abort mid-upload
- File size display with upload speed estimate

**UI changes in `ChatWindow.jsx` / `MediaBubble`:**
- Download progress bar for large files
- Streaming playback for large videos (progressive download)

#### 4.5 Error Handling Matrix

| Error | Handling |
|-------|----------|
| Network timeout on chunk | Retry same chunk (3 attempts, exponential backoff) |
| Server 5xx | Retry with backoff, show error after 3 failures |
| User navigates away | Persist upload state in IndexedDB, resume on return |
| Browser tab crash | Server keeps partial chunks for 24h, client can resume |
| Disk full (server) | Return 507, client shows "server storage full" |
| AbortController signal | Clean up partial upload on server via DELETE endpoint |

#### 4.6 Phased Approach

- **Phase 1** (~8 hrs): Increase limit to 500 MB (no chunking needed, just raise multer/axios limits)
- **Phase 2** (~12 hrs): Chunked upload/download with progress UI
- **Phase 3** (~8 hrs): Resume support, File System Access API for huge files, error resilience

#### 4.7 Files to Create/Modify

| File | Action |
|------|--------|
| `server/routes/media-chunked.js` | **New** — chunked upload endpoints |
| `server/db.js` | Add `media_chunks` table, alter `media` table |
| `server/app.js` | Register new route |
| `client/services/chunkedUpload.js` | **New** — chunked upload logic |
| `client/services/chunkedDownload.js` | **New** — chunked download logic |
| `client/hooks/useMessages.js` | Use chunked upload for large files |
| `client/components/MessageInput.jsx` | Progress bar UI |
| `client/components/ChatWindow.jsx` | Download progress in MediaBubble |

---

## Feature 5: Voice/Video Calling with WebRTC

### Difficulty: 🔴🔴 Very Hard | Estimate: 60–100+ hours

### Problem Statement

No calling infrastructure exists. Need: signaling server (Socket.io already available), STUN/TURN servers, peer connection management, call state machine, and full UI for in-call experience.

### Architecture

#### 5.1 Signaling via Socket.io

WebRTC requires exchanging SDP offers/answers and ICE candidates. The existing Socket.io infrastructure is perfect for this.

**New socket events (server relay only — no processing):**

| Event | Direction | Payload |
|-------|-----------|---------|
| `call_initiate` | Caller → Server → Callee | `{ conversationId, callId, callType: 'audio'\|'video', sdpOffer }` |
| `call_answer` | Callee → Server → Caller | `{ conversationId, callId, sdpAnswer }` |
| `call_ice` | Bidirectional | `{ conversationId, callId, candidate }` |
| `call_reject` | Callee → Server → Caller | `{ conversationId, callId, reason? }` |
| `call_end` | Either → Server → Other | `{ conversationId, callId }` |
| `call_busy` | Callee → Server → Caller | `{ conversationId, callId }` |

#### 5.2 Call Flow

```
Alice (Caller)                Server (relay)              Bob (Callee)
──────────────                ──────────────              ────────────
Click 📞
getUserMedia()
new RTCPeerConnection()
createOffer()
  → call_initiate ──────────────────────────→ Show IncomingCallModal
                                              getUserMedia()
                                              new RTCPeerConnection()
                                              setRemoteDescription(offer)
                                              createAnswer()
  ← call_answer ←────────────────────────────
setRemoteDescription(answer)

ICE candidates ←────────────────────────────→ ICE candidates
  (trickle ICE via call_ice events)

═══════ Media flows P2P (or via TURN) ═══════

Click End
  → call_end ──────────────────────────────→ Close call UI
                                              Release media streams
```

#### 5.3 STUN/TURN Servers

```javascript
const iceServers = [
  // Free public STUN servers
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Self-hosted TURN server (required for ~15% of users behind symmetric NATs)
  {
    urls: 'turn:turn.yourdomain.com:3478',
    username: '<dynamic>',
    credential: '<dynamic>',
  },
];
```

**TURN server options:**
- Self-hosted: `coturn` (add to `docker-compose.yml`)
- Managed: Twilio Network Traversal, Xirsys, Cloudflare Calls
- Without TURN: ~85% of calls will work, ~15% will fail (symmetric NAT)

#### 5.4 Client Architecture

**New file: `services/webrtc.js`**

Call state machine:
```
idle → outgoing_ringing → connecting → connected → ended
idle → incoming_ringing → connecting → connected → ended
idle → incoming_ringing → rejected → idle
Any state → ended → idle
```

Core class:
```typescript
class CallManager {
  state: CallState
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  peerConnection: RTCPeerConnection | null

  async initiateCall(conversationId, callType)
  async answerCall(conversationId, callId, sdpOffer)
  async rejectCall(conversationId, callId)
  async endCall()
  toggleMute()
  toggleCamera()
  switchCamera()  // mobile
}
```

**New components:**

| Component | Purpose |
|-----------|---------|
| `CallOverlay.jsx` | Full-screen in-call UI: remote video, local video (PiP), controls |
| `IncomingCallModal.jsx` | Accept/Reject UI with ringtone |
| `CallButton.jsx` | 📞 📹 buttons in the chat header |

**State management:**
Call state must be global (persists across conversation switches):
```jsx
// In App.jsx or via React Context
const [callState, setCallState] = useState({
  status: 'idle',      // idle | outgoing_ringing | incoming_ringing | connecting | connected
  callId: null,
  conversationId: null,
  callType: null,       // 'audio' | 'video'
  peerUserId: null,
});
```

#### 5.5 Server Changes

```javascript
// In websocket.js — add these handlers (pure relay, ~50 lines)
socket.on('call_initiate', (payload) => {
  // Validate participant, relay to conversationId room (exclude sender)
  socket.to(payload.conversationId).emit('call_initiate', { ...payload, callerId: userId });
});

socket.on('call_answer', (payload) => {
  socket.to(payload.conversationId).emit('call_answer', { ...payload, answererId: userId });
});

socket.on('call_ice', (payload) => {
  socket.to(payload.conversationId).emit('call_ice', { ...payload, userId });
});

socket.on('call_reject', (payload) => {
  socket.to(payload.conversationId).emit('call_reject', { ...payload, userId });
});

socket.on('call_end', (payload) => {
  socket.to(payload.conversationId).emit('call_end', { ...payload, userId });
});
```

#### 5.6 E2E Encryption for Calls

WebRTC uses DTLS-SRTP by default (encrypted in transit). For true E2E:
- Use **Insertable Streams API** (Chrome/Edge) to encrypt/decrypt RTP frames
- Encrypt each frame with the conversation's AES-GCM key
- This prevents TURN servers from inspecting media
- **Optional enhancement** — DTLS-SRTP is sufficient for most threat models

#### 5.7 Known Challenges

| Challenge | Mitigation |
|-----------|------------|
| iOS Safari WebRTC quirks | Test thoroughly, use adapter.js polyfill |
| Multiple tabs | Lock call state in `BroadcastChannel`, only one tab can be in a call |
| Group calls (3+ users) | Requires SFU (mediasoup/Janus) — out of scope for v1, limit to 1:1 |
| Network changes (WiFi→4G) | `RTCPeerConnection.oniceconnectionstatechange` → reconnect |
| Permissions | Graceful fallback if mic/camera denied |

#### 5.8 Docker-Compose Addition (TURN Server)

```yaml
  coturn:
    image: coturn/coturn:latest
    network_mode: host
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf
    restart: unless-stopped
```

#### 5.9 Phased Approach

- **Phase 1** (~20 hrs): Audio-only 1:1 calls with STUN only
- **Phase 2** (~15 hrs): Video calling + camera switching
- **Phase 3** (~15 hrs): TURN server integration + docker-compose setup
- **Phase 4** (~10 hrs): E2E encryption via Insertable Streams
- **Phase 5** (~10 hrs): Polish — ringtones, call history, reconnection, mobile UX

#### 5.10 Files to Create/Modify

| File | Action |
|------|--------|
| `client/services/webrtc.js` | **New** — CallManager class |
| `client/components/CallOverlay.jsx` | **New** — in-call UI |
| `client/components/IncomingCallModal.jsx` | **New** — incoming call alert |
| `client/components/CallButton.jsx` | **New** — call trigger buttons |
| `client/App.jsx` | Add call state, render overlays, socket listeners |
| `client/components/ChatWindow.jsx` | Add call buttons to header |
| `server/websocket.js` | Add 5 call signaling event handlers |
| `docker-compose.yml` | Add coturn service |
| `turnserver.conf` | **New** — coturn configuration |

---

## Feature 6: Group End-to-End Encryption

### Difficulty: 🔴🔴 Very Hard | Estimate: 40–80 hours

### Problem Statement

The current crypto model uses **pairwise ECDH** — fundamentally a 2-party protocol. The code in `cryptoService.js` assumes exactly one peer per conversation:

```javascript
// _findLatestPeerEntry() — picks ONE peer, ignores the rest
exchangeData.filter((e) => e.userId !== myUserId)
```

With 3+ users, ECDH cannot produce a single shared secret for all parties. **The entire crypto layer needs an alternative key distribution model for groups.**

### Current State: What Already Works for Groups

| Component | Status |
|-----------|--------|
| `conversations.type = 'group_chat'` | ✅ DB supports it |
| `conversation_participants` (N users) | ✅ Many-to-many |
| `POST /api/conversations` with multiple participants | ✅ API works |
| `NewConversationModal` — group creation UI | ✅ Works |
| Socket.io rooms for groups | ✅ All participants joined |
| **Encryption for groups** | ❌ **Completely broken** |

### Recommended Approach: Sender Keys Protocol (WhatsApp-style)

Each sender has their own symmetric "sender key." They distribute it to all group members via existing pairwise ECDH channels.

#### 6.1 How Sender Keys Work

```
Group: Alice, Bob, Carol

1. Alice generates random sender key: SK_alice (256-bit AES key)
2. Alice distributes SK_alice to each member via their pairwise channel:
   - encrypt(pairwiseKey_alice_bob, SK_alice) → send to Bob via server
   - encrypt(pairwiseKey_alice_carol, SK_alice) → send to Carol via server
3. When Alice sends a group message:
   - encrypt(SK_alice, "hello") → broadcast to group room
   - Bob decrypts with SK_alice ✓
   - Carol decrypts with SK_alice ✓
4. Bob has his own SK_bob, Carol has SK_carol — same process.
```

**Key advantages:**
- 1 encryption per message (vs N for pairwise fan-out)
- Leverages existing pairwise ECDH for key distribution
- Server remains a dumb relay (E2E preserved)

#### 6.2 New Database Tables

```sql
-- Sender key distribution records (encrypted blobs relayed by server)
CREATE TABLE group_sender_keys (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_sender_key TEXT NOT NULL,  -- encrypted with pairwise key
  iv TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'v1',
  key_generation INTEGER NOT NULL DEFAULT 0,  -- increments on rotation
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_gsk_conv_recipient
  ON group_sender_keys(conversation_id, recipient_user_id);

CREATE INDEX idx_gsk_conv_sender
  ON group_sender_keys(conversation_id, sender_user_id);
```

#### 6.3 New Server Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/keys/sender-key` | POST | Store encrypted sender key for a recipient |
| `/api/keys/sender-keys/:conversationId` | GET | Fetch all sender keys for this conversation (filtered to current user as recipient) |
| `/api/conversations/:id/members` | POST | Add member to group (triggers key rotation) |
| `/api/conversations/:id/members/:userId` | DELETE | Remove member (triggers key rotation) |

#### 6.4 New Socket Events

| Event | Purpose |
|-------|---------|
| `sender_key_distribution` | Relay encrypted sender key blob to recipient |
| `sender_key_rotation` | Notify group that keys have been rotated (member added/removed) |
| `member_added` | Notify group of new member |
| `member_removed` | Notify group of removed member |

#### 6.5 Client Crypto Changes

**In `cryptoService.js` — major additions:**

```javascript
// New in-memory store:
// conversationId → Map<senderUserId, { senderKey: Uint8Array, generation: number }>
const groupSenderKeys = new Map();

// My sender key per group:
// conversationId → { senderKey: Uint8Array, generation: number }
const mySenderKeys = new Map();

// New exported functions:
export async function setupGroupKey(conversationId, myUserId, memberUserIds)
export async function distributeSenderKey(conversationId, myUserId, recipientUserIds)
export async function rotateSenderKey(conversationId, myUserId, memberUserIds)
export async function encryptForGroup(conversationId, plaintext)
export async function decryptGroupMessage(conversationId, senderId, payload)
```

**Modified encrypt/decrypt dispatch:**
```javascript
export async function encryptForConversation(conversationId, plaintext) {
  const convType = getConversationType(conversationId); // new helper
  if (convType === 'group_chat') {
    return encryptForGroup(conversationId, plaintext);
  }
  // ... existing pairwise logic
}

export async function decryptConversationMessage(conversationId, senderId, encryptedPayload) {
  const convType = getConversationType(conversationId);
  if (convType === 'group_chat') {
    return decryptGroupMessage(conversationId, senderId, encryptedPayload);
  }
  // ... existing pairwise logic
}
```

#### 6.6 Key Rotation Rules

| Event | Action |
|-------|--------|
| Member removed | ALL remaining members generate new sender keys and redistribute |
| Member added | New member receives existing sender keys; existing members send their current keys to new member |
| Periodic (optional) | Rotate every N messages or every 24h for forward secrecy |

**Critical edge case — offline members:**
When a member is removed and keys are rotated, some members may be offline. Solution:
- Server stores the latest sender key distribution records persistently
- When a member comes online, they fetch and decrypt the latest sender keys
- Include `key_generation` counter so clients know when they have stale keys

#### 6.7 UI Changes

| Component | Change |
|-----------|--------|
| `ChatWindow.jsx` | Group header: member count, group name, settings icon |
| `NewConversationModal.jsx` | Already works — minor polish for multi-select |
| **New: `GroupSettingsModal.jsx`** | Member list, add/remove members, leave group, change group name |
| `ConversationList.jsx` | Group icon (👥) vs DM icon (💬) in sidebar |

#### 6.8 Message Format Change

Group messages need to include `senderId` in the message payload lookup, since different senders use different keys:

```javascript
// Current: decrypt using single conversation key
decrypt(conversationKey, payload)

// Group: decrypt using sender-specific key
const senderKey = groupSenderKeys.get(conversationId).get(msg.senderId);
decrypt(senderKey, payload)
```

The existing message format already includes `senderId` — no wire format changes needed.

#### 6.9 Phased Approach

- **Phase 1** (~15 hrs): Sender key generation, distribution, and storage (crypto + server)
- **Phase 2** (~15 hrs): Group encrypt/decrypt dispatch, integration with existing message flow
- **Phase 3** (~10 hrs): Key rotation on member add/remove
- **Phase 4** (~10 hrs): Group settings UI (member management, leave group)
- **Phase 5** (~10 hrs): Edge cases — offline members, multi-device, key recovery
- **Phase 6** (~5 hrs): Testing with 3+ simultaneous clients

#### 6.10 Files to Create/Modify

| File | Action |
|------|--------|
| `server/db.js` | Add `group_sender_keys` table |
| `server/routes/keys.js` | Add sender key endpoints |
| `server/routes/conversations.js` | Add member management endpoints |
| `server/websocket.js` | Add sender key + member events |
| `client/services/cryptoService.js` | Major: add group key functions, modify encrypt/decrypt dispatch |
| `client/hooks/useMessages.js` | Pass `senderId` to decrypt for groups |
| `client/components/GroupSettingsModal.jsx` | **New** — group management UI |
| `client/components/ChatWindow.jsx` | Group header, settings button |
| `client/components/ConversationList.jsx` | Group vs DM icons |

---

## Priority & Dependencies

```
                    ┌─────────────────┐
                    │  Feature 4      │
                    │  Large Uploads  │
                    │  (independent)  │
                    └────────┬────────┘
                             │ (no deps)
┌─────────────────┐         │         ┌─────────────────┐
│  Feature 5      │         │         │  Feature 6      │
│  WebRTC Calling │         │         │  Group E2E      │
│  (independent)  │         │         │  (independent)  │
└─────────────────┘         │         └─────────────────┘
                             │
                    ┌────────▼────────┐
                    │  All features   │
                    │  are independent│
                    │  can be done in │
                    │  any order      │
                    └─────────────────┘
```

### Recommended Order

| Order | Feature | Rationale |
|-------|---------|-----------|
| 1st | **Feature 4: Large Uploads (Phase 1)** | Quick win: just raise limits to 500 MB. 8 hours. |
| 2nd | **Feature 6: Group E2E** | Core functionality gap — groups exist in UI but encryption is broken. |
| 3rd | **Feature 4: Large Uploads (Phase 2–3)** | Full chunked architecture for 10 GB. |
| 4th | **Feature 5: WebRTC Calling** | Largest effort, entirely new subsystem, can be last. |

### Risk Summary

| Feature | Biggest Risk | Mitigation |
|---------|-------------|------------|
| Large Uploads | Browser OOM at 10 GB | File System Access API for streaming write |
| WebRTC Calling | TURN server cost + NAT issues | Start with STUN-only, add TURN later |
| Group E2E | Key rotation race conditions | Sequence numbers, generation counters, server-side ordering |
