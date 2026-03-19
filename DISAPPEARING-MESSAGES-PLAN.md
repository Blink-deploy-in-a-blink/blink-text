# Disappearing Messages + Nuke Chat — Implementation Plan

## 1. What Is It?

### 1A. Disappearing Messages
Disappearing messages is a **per-conversation timer** that automatically deletes messages after a set duration. Once enabled, every message sent in that conversation self-destructs after the timer expires.

### 1B. Nuke Chat 💥
Nuke Chat **permanently deletes ALL messages + media from the server for BOTH participants**. Irreversible. Think of it as a "delete for everyone" but for the entire conversation history. Shows an explosion animation when triggered.

| Feature | Scope | Reversible? | Who sees the effect? |
|---------|-------|-------------|---------------------|
| **Clear Chat** | Hides messages for YOU only | Yes (data still on server) | Only you |
| **Nuke Chat** 💥 | Deletes ALL messages + media from server | ❌ No | Both participants |
| **Disappearing Messages** | Auto-deletes after timer | ❌ No | Both participants |

### How It Works (User Perspective)

1. **When creating a new conversation**: A "Message Timer" dropdown lets you pick a duration (default: Off = messages persist forever)
2. **Inside an existing conversation**: Click the ⏱ timer icon in the chat header → change the timer. Both participants see a system message: *"Alice set messages to disappear after 24 hours"*
3. **Countdown**: Each message shows a subtle countdown indicator (small fading circle or timer text) as it approaches expiry
4. **Deletion**: When the timer fires, the message vanishes from both sides — server deletes it from DB + any associated media from disk
5. **Media**: Same timer applies. Encrypted `.enc` files are deleted from disk when messages expire

### Timer Options

| Duration | Label |
|----------|-------|
| Off | Messages persist forever (default) |
| 5 minutes | 5m |
| 1 hour | 1h |
| 24 hours | 24h |
| 7 days | 7d |
| 30 days | 30d |

> **No monetization gating for now** — all timers are free. We can gate shorter timers (5s, 30s) to Pro later.

---

## 2. Why Is It Helpful?

- **Privacy**: Messages don't persist forever — reduces risk if server or device is compromised
- **Storage**: Self-cleaning conversations save server disk space (especially for media)
- **Expectation**: Signal, WhatsApp, Telegram all have this — users expect it
- **Compliance**: Some users need conversations that don't leave a trail

---

## 3. Architecture

### 3.1 Database Changes

```
conversations table:
  + disappear_after  INTEGER DEFAULT NULL
    -- Duration in milliseconds. NULL = off (persist forever).
    -- When set, every NEW message in this conversation gets:
    --   expires_at = message.timestamp + conversation.disappear_after

messages table:
  + expires_at  INTEGER DEFAULT NULL
    -- Unix timestamp (ms) when this message should be deleted.
    -- NULL = never expires.
    -- Set at send time based on conversation.disappear_after.
```

**Why on the conversation, not per-message?**
- Simpler UX: one toggle for the whole conversation (like Signal)
- No confusing "this message disappears in 5m but that one is forever"
- The timer applies to all NEW messages after it's set (old messages are NOT retroactively changed)

### 3.2 Server Changes

#### 3.2.1 `db.js` — Schema migration
- Add `disappear_after` column to `conversations` (safe ALTER TABLE migration)
- Add `expires_at` column to `messages` (safe ALTER TABLE migration)
- Add index: `CREATE INDEX idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL`

#### 3.2.2 `websocket.js` — Message send
- On `send_message`: look up `conversation.disappear_after`
- If set, compute `expires_at = Date.now() + disappear_after` and store it on the message row
- Include `expiresAt` in the emitted message object so clients know the deadline

#### 3.2.3 `websocket.js` — Cleanup interval
- New background interval (runs every 30 seconds):
  ```
  1. SELECT expired messages WHERE expires_at IS NOT NULL AND expires_at < Date.now()
  2. For each: delete associated media file from disk (if media_id exists)
  3. DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?
  4. Emit 'messages_expired' event to affected conversation rooms with list of deleted message IDs
  ```

#### 3.2.4 `routes/conversations.js` — Update timer endpoint
- New endpoint: `PUT /api/conversations/:id/disappear`
  - Body: `{ disappearAfter: 86400000 }` (ms) or `{ disappearAfter: null }` to disable
  - Only participants can change it
  - Emits a socket event `conversation_timer_changed` to the room so all clients update in real-time
  - Creates a system message visible to all participants: "Alice set messages to disappear after 24h"

#### 3.2.5 `routes/conversations.js` — Return timer in conversation data
- The `GET /api/conversations` and `POST /api/conversations` responses include `disappear_after` field
- Conversation creation accepts optional `disappearAfter` parameter

### 3.3 Client Changes

#### 3.3.1 `NewConversationModal.jsx` — Timer on creation
- Add a "Message Timer" dropdown below the type selector
- Options: Off, 5m, 1h, 24h, 7d, 30d
- Passed to `createConversation()` API call

#### 3.3.2 `ChatWindow.jsx` — Header timer indicator + settings
- Timer icon (⏱) in the chat header, next to the conversation name
- Click opens a small dropdown to change the timer
- When a timer is active, show a subtle badge: "⏱ 24h" next to the name
- When timer changes, show a system message inline

#### 3.3.3 `ChatWindow.jsx` — Message expiry indicator
- Messages with `expiresAt` show a small countdown or "disappearing" icon
- As the message approaches expiry (< 1 minute left), the bubble slightly fades
- When `messages_expired` socket event arrives, remove those messages from the UI

#### 3.3.4 `useMessages.js` — Handle expiry events
- Listen for `messages_expired` socket event
- Remove expired messages from the local message list
- Also run a client-side interval that removes messages past their `expiresAt` (in case the socket event is missed)

#### 3.3.5 `api.js` — New API call
- `updateConversationTimer(conversationId, disappearAfter)` → `PUT /api/conversations/:id/disappear`

#### 3.3.6 `ConversationList.jsx` — Timer badge
- Show a small ⏱ icon next to conversations that have disappearing messages enabled

### 3.4 Socket Events (New)

| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `conversation_timer_changed` | Server → Clients | `{ conversationId, disappearAfter, changedBy, systemMessage }` | Timer was changed |
| `messages_expired` | Server → Clients | `{ conversationId, messageIds: [...] }` | Messages were deleted by server |

---

## 4. User Flow Walkthrough

### Flow A: Setting timer on new conversation
```
1. User clicks "New Conversation"
2. Enters recipient username
3. Selects "Message Timer: 24 hours" from dropdown
4. Clicks "Create"
5. Conversation is created with disappear_after = 86400000
6. Both users see: "⏱ Messages disappear after 24h" in the chat header
7. Every message sent now has expires_at = timestamp + 86400000
```

### Flow B: Changing timer in existing conversation
```
1. User opens an existing conversation
2. Clicks the ⏱ icon in the chat header
3. Selects "7 days" from the dropdown
4. Server updates conversation.disappear_after = 604800000
5. System message appears: "Alice set messages to disappear after 7 days"
6. All NEW messages from this point get expires_at set
7. Old messages are NOT affected (they keep their original expiry or no expiry)
```

### Flow C: Message expires
```
1. Message was sent with expires_at = 1710850000000
2. Server cleanup interval runs, finds it's past the deadline
3. Server deletes the message row (+ media file if it was an image/video)
4. Server emits 'messages_expired' to the conversation room
5. All connected clients remove the message from their UI
6. Disconnected clients will simply not see it when they fetch history
```

### Flow D: Turning timer off
```
1. User clicks ⏱ → selects "Off"
2. Server sets disappear_after = NULL
3. System message: "Alice turned off disappearing messages"
4. New messages from this point persist forever
5. Already-expiring messages still expire on schedule (not retroactive)
```

---

## 5. UI Mockup (Text)

### Chat Header (timer active)
```
┌──────────────────────────────────────┐
│ ← Bob                    ⏱ 24h  ⋮   │
├──────────────────────────────────────┤
```

### Timer Dropdown (on click of ⏱)
```
┌──────────────────┐
│ Disappearing      │
│ Messages          │
├──────────────────┤
│ ○ Off             │
│ ○ 5 minutes       │
│ ○ 1 hour          │
│ ● 24 hours   ✓    │
│ ○ 7 days          │
│ ○ 30 days         │
└──────────────────┘
```

### Message Bubble (with expiry)
```
┌────────────────────────────┐
│ Hey, did you see the news? │
│                   10:42 AM │
│                      ⏱ 23h │  ← subtle countdown
└────────────────────────────┘
```

### System Message (timer changed)
```
         ── ⏱ Alice set messages to ──
         ── disappear after 24 hours ──
```

### New Conversation Modal
```
┌──────────────────────────────┐
│ New Conversation             │
│                              │
│ Type: [Direct          ▼]   │
│                              │
│ Recipient: [username...   ]  │
│                              │
│ Message Timer: [24 hours ▼]  │
│                              │
│         [Cancel] [Create]    │
└──────────────────────────────┘
```

### Conversation List (timer badge)
```
┌──────────────────────────────┐
│ 🔍 Search conversations...   │
├──────────────────────────────┤
│ Bob                    ⏱ 3:42│
│ Hey, did you see...          │
├──────────────────────────────┤
│ Alice                   10:30│
│ Sure, I'll send it over     │
└──────────────────────────────┘
```

---

## 6. Files to Modify

| File | Changes |
|------|---------|
| `apps/server/db.js` | Add `disappear_after` to conversations, `expires_at` to messages, add index |
| `apps/server/websocket.js` | Set `expires_at` on send, add cleanup interval, emit `messages_expired` |
| `apps/server/routes/conversations.js` | `PUT /:id/disappear` endpoint, include `disappear_after` in responses, accept on creation |
| `apps/web-client/src/services/api.js` | Add `updateConversationTimer()` function |
| `apps/web-client/src/components/NewConversationModal.jsx` | Timer dropdown on conversation creation |
| `apps/web-client/src/components/ChatWindow.jsx` | Header timer icon + dropdown, message expiry badge, system messages |
| `apps/web-client/src/hooks/useMessages.js` | Handle `messages_expired` event, client-side expiry sweep |
| `apps/web-client/src/components/ConversationList.jsx` | Timer badge on conversation rows |
| `apps/web-client/src/App.jsx` | Handle `conversation_timer_changed` socket event globally |

---

## 7. Implementation Order

### Phase 1: Backend (Server)
1. `db.js` — schema migration (columns + index)
2. `routes/conversations.js` — `PUT /:id/disappear` endpoint + include in responses + accept on creation
3. `websocket.js` — set `expires_at` on `send_message` + cleanup interval + `messages_expired` event

### Phase 2: Frontend (Client)
4. `api.js` — `updateConversationTimer()` API call
5. `NewConversationModal.jsx` — timer dropdown
6. `ChatWindow.jsx` — header timer icon + dropdown + message expiry badge
7. `useMessages.js` — handle `messages_expired` socket event + client-side sweep
8. `ConversationList.jsx` — timer badge
9. `App.jsx` — global `conversation_timer_changed` handler

### Phase 3: Polish
10. System messages for timer changes
11. Countdown animations on expiring messages
12. Edge cases (offline users, message cache cleanup)

---

## 8. Edge Cases to Handle

| Scenario | Behavior |
|----------|----------|
| User sends message while offline | Message queued locally, `expires_at` set when actually sent |
| User was offline when messages expired | They simply don't appear in history fetch (already deleted server-side) |
| Timer changed while composing | New timer applies to the next sent message only |
| Media message expires | Server deletes both the message row AND the `.enc` file from disk |
| Message edit on expiring message | Editing doesn't extend the timer |
| Forwarded message | Forwarded copy gets the destination conversation's timer (not the original's) |
| Reply to expired message | The reply persists but shows "Original message deleted" |

---

## 9. Security Notes

- **Server-side enforcement**: The server is the authority on deletion. Clients cannot prevent expiry.
- **No client-side-only timers**: We don't rely on clients to delete messages. Even if a client ignores the `messages_expired` event, the messages are gone from the DB.
- **Media cleanup**: The cleanup interval also deletes encrypted media files from disk, preventing orphaned `.enc` blobs.
- **Not retroactive**: Changing the timer only affects NEW messages. This prevents a malicious participant from setting a 5-second timer to wipe conversation history.
- **Both participants can change**: Either participant in a DM can change the timer (like Signal). This is a trust-based model.

---

## 10. Estimated Time

| Phase | Hours |
|-------|-------|
| Phase 1: Backend | ~4-5h |
| Phase 2: Frontend | ~6-8h |
| Phase 3: Polish | ~2-3h |
| **Total** | **~12-16h** |
