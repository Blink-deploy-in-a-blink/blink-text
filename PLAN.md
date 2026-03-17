# Blink-Text -- Product Strategy & Feature Plan

> Last updated: 2026-03-17
> Status: **Planning** -- not yet implemented

---

## Table of Contents

1. [Competitive Analysis: Blink vs Signal](#competitive-analysis-blink-vs-signal)
2. [Our Actual Moat](#our-actual-moat)
3. [Monetization Strategy](#monetization-strategy)
4. [Trust & Safety: Anti-Spam + Legal Compliance](#trust--safety-anti-spam--legal-compliance)
5. [Feature Roadmap (Revenue-First Order)](#feature-roadmap-revenue-first-order)
6. [Tier 0: Critical Fixes](#tier-0-critical-fixes)
7. [Tier 1: Revenue-Generating Features](#tier-1-revenue-generating-features)
8. [Tier 2: Engagement & Polish](#tier-2-engagement--polish)
9. [Tier 3: Infrastructure Features](#tier-3-infrastructure-features)
10. [Infrastructure Note: SQLite vs PostgreSQL](#infrastructure-note-sqlite-vs-postgresql)
11. [Build Order: The Actual Implementation Plan](#build-order-the-actual-implementation-plan)

---

## Competitive Analysis: Blink vs Signal

Let's be brutally honest about where we stand.

### What Signal Does Better (Can't Compete On)

| Aspect | Signal | Blink |
|--------|--------|-------|
| **Protocol** | Double Ratchet (gold standard, peer-reviewed, academic papers) | ECDH + HKDF chain ratchet (solid, but not formally audited) |
| **Trust** | Non-profit, endorsed by Snowden, 10+ years of track record | New, unknown, zero brand recognition |
| **Mobile apps** | Native iOS + Android (fast, push notifications, background) | Web-only (PWA at best), no native mobile |
| **User base** | 40M+ monthly active users | 0 |
| **Funding** | $50M+ from Signal Foundation, donations | $0 |
| **Security audits** | Multiple independent audits | None |
| **Metadata protection** | Sealed sender, no IP logging, SGX enclaves | Server sees IP, user IDs, conversation graph |
| **Key verification** | Safety numbers, QR code verification | Key confirm handshake (no manual verification) |

**Bottom line**: We cannot and should not try to out-Signal Signal on privacy. They are a non-profit with a decade head-start, formal audits, and Moxie Marlinspike's reputation. Competing on "we're more private than Signal" is a losing strategy.

### What Signal Does Poorly (Our Opportunity)

| Pain Point | Signal | Blink Opportunity |
|------------|--------|-------------------|
| **Requires phone number** | Yes -- forces real identity, kills anonymity | Username-only, no PII required |
| **No web client** | Signal Desktop is Electron, no browser access | Pure web -- works anywhere with a browser |
| **Media compression** | Aggressively compresses photos/videos | Original quality, zero compression |
| **Not self-hostable** | Signal's server is open-source but nearly impossible to self-host (they actively discourage it) | `npm install && node app.js` -- runs on any VPS in 2 minutes |
| **No anonymous/temporary conversations** | Not possible | Burner rooms with shareable links |
| **No business model** | Donation-dependent, unclear long-term funding | Freemium with clear value tiers |
| **Can't customize** | Take it or leave it | Self-hosted = full control |
| **Sealed sender hides metadata but requires phone** | Paradox: protects metadata but your phone number IS your identity | True anonymity -- we don't even know who you are |

---

## Our Actual Moat

**We are NOT "Signal but worse." We are a different product for a different user.**

### Target Users (Who Will Pay)

| Persona | Why Signal Fails Them | Why Blink Wins |
|---------|----------------------|----------------|
| **Journalists** covering sensitive stories | Signal requires a phone number -- source's real identity is compromised if phone seized | Blink: create a burner room, share link, source never registers |
| **Corporate teams** needing private comms | Signal is consumer-focused, no admin controls, can't self-host | Blink: self-host on company infra, full control |
| **Online communities** (Discord/Telegram refugees) | Signal has no concept of public/semi-public rooms | Blink: shareable room links with expiry |
| **Privacy enthusiasts who won't give a phone number** | Signal REQUIRES one. Full stop. | Blink: username only |
| **Developers / sysadmins** | Want to run their own infra, inspect the code | Blink: simple Node.js + SQLite, `npm install && node app.js` |
| **Activists in hostile countries** | App stores can be blocked; Signal's Electron app is detectable | Blink: any browser, any VPN, looks like a normal webpage |
| **Photographers / videographers** | Signal compresses media -- ruins original quality | Blink: zero compression, original files |

### The Pitch (Updated)

> **Blink** -- Anonymous encrypted messaging. No phone. No email. No trace.
>
> - Create a private room in 2 seconds. Share the link. No signup needed.
> - Self-host on your own server -- we literally can't spy on you.
> - Original quality photos & videos -- no compression ever.
> - Messages self-destruct. You choose when.
> - Open source. MIT licensed. Audit it yourself.

**We're not competing with Signal on protocol security. We're competing on anonymity, accessibility, and self-sovereignty.**

---

## Monetization Strategy

### Model: Freemium SaaS (Hosted) + Open Source (Self-Hosted)

| Tier | Price | What You Get |
|------|-------|-------------|
| **Free** | $0 | Username-based accounts, 500 MB storage, messages auto-delete after 30 days, 3 burner rooms/month, basic timers (24h, 7d) |
| **Pro** | $4/mo | 10 GB storage, messages persist forever, unlimited burner rooms, all self-destruct timers (5s-custom), screenshot alerts, relay-only mode, priority support |
| **Team** | $10/user/mo | Everything in Pro + self-hosted deployment support, admin dashboard, audit logs, custom branding, SSO |

### Revenue Math

- 10,000 free users -> ~3% convert to Pro = 300 paying users x $4/mo = **$1,200/mo**
- 100,000 free users -> 3% = 3,000 x $4 = **$12,000/mo**
- Enterprise/Team deals: even 10 companies at $10/user x 20 users = **$2,000/mo**

### Cost Structure

- Hosting: $20-50/mo (single VPS for the hosted instance)
- Storage: S3 at ~$0.023/GB/mo (1 TB = $23/mo)
- TURN server (if calling is added): ~$50/mo
- Domain + Cloudflare: free

**Break-even: ~15 Pro users.**

---

## Trust & Safety: Anti-Spam + Legal Compliance

### The Hard Truth

Running an anonymous, encrypted messaging platform without ANY verification creates two existential risks:

1. **Spam / Bot Abuse**: Without verification, a script can register 10,000 accounts in an hour
2. **Illegal Content**: You are the platform operator. In most jurisdictions, you have legal obligations even if content is encrypted.

**Signal gets away with minimal moderation because**: they're a US non-profit with massive legal resources, 10+ years of legal precedent, and they require a phone number (which acts as a spam gate). You have none of those shields.

### Risk 1: Spam & Malicious Actors

#### Current Vulnerability

```bash
# An attacker can do this right now:
for i in $(seq 1 1000); do
  curl -X POST /api/auth/register -d "{\"username\":\"bot_$i\",\"password\":\"x\"}"
done
# Result: 1000 accounts, limited only by your 20 req/15min rate limit per IP
# With 10 proxy IPs = 200 accounts in 15 minutes = unlimited bots
```

#### Solution: Layered Anti-Spam (No Email/Phone Required)

| Layer | What It Does | Stops | Effort |
|-------|-------------|-------|--------|
| **1. Proof of Work (PoW)** | Client must solve a CPU puzzle before registration | Bulk bot registration | ~8 hrs |
| **2. CAPTCHA on registration** | hCaptcha (privacy-respecting, free tier) | Automated scripts | ~4 hrs |
| **3. Rate limiting (IP + fingerprint)** | Max 3 accounts per IP per day, browser fingerprint tracking | Casual abuse | ~4 hrs |
| **4. Reputation system** | New accounts are "untrusted" for 24h -- can only message people who message them first | Spam DMs | ~6 hrs |
| **5. Report + Ban** | Users can report accounts; admin can ban by username or IP range | Ongoing abuse | ~8 hrs |

#### Recommended: Proof of Work (Best Privacy-Preserving Option)

This is what **Tor** and **Hashcash** use. No PII required, but makes mass registration expensive.

```javascript
// Client-side: solve a SHA-256 puzzle before registration
// Server sends: { challenge: "random_string", difficulty: 18 }
// Client must find a nonce where:
//   SHA-256(challenge + nonce) starts with 18 zero bits
// Takes ~0.5-2 seconds on a normal device, but 500-2000 seconds for 1000 accounts

// Registration request must include the solution:
POST /api/auth/register
{
  "username": "alice",
  "password": "...",
  "powChallenge": "abc123...",
  "powNonce": "847291"    // <-- proof that client did the work
}
```

**Server-side validation** (~10 lines):
```javascript
const crypto = require('crypto');
function verifyPoW(challenge, nonce, difficulty) {
  const hash = crypto.createHash('sha256')
    .update(challenge + nonce)
    .digest();
  // Check first `difficulty` bits are zero
  const required = Math.floor(difficulty / 8);
  for (let i = 0; i < required; i++) {
    if (hash[i] !== 0) return false;
  }
  const remaining = difficulty % 8;
  if (remaining > 0 && (hash[required] >> (8 - remaining)) !== 0) return false;
  return true;
}
```

**Why this works**: A legitimate user waits 1-2 seconds (barely noticeable). A spammer trying to create 1000 accounts needs ~1000 seconds (16 minutes) of CPU time. With difficulty=20, it's ~8 seconds per registration = 2+ hours for 1000 accounts.

#### Recommended: Reputation / Trust Levels

```
Account age < 24h  -> "New" -- cannot initiate DMs, can only join conversations invited to
Account age 1-7d   -> "Basic" -- can DM up to 5 new users per day
Account age > 7d   -> "Trusted" -- no restrictions
Reported 3+ times  -> "Flagged" -- rate-limited, reviewed by admin
```

This doesn't require any PII but makes spam economically unviable.

### Risk 2: Illegal Activity & Legal Liability

#### Legal Landscape (As of 2026)

| Jurisdiction | Law | Your Obligation | Penalty for Non-Compliance |
|-------------|-----|-----------------|---------------------------|
| **US** | 18 U.S.C. 2258A (CSAM) | If you have "actual knowledge" of CSAM, you MUST report to NCMEC within 24 hours | Federal felony, up to $300K fine per violation |
| **US** | Section 230 | Protects from liability for user content EXCEPT for CSAM, federal crimes, IP violations | N/A |
| **EU** | Digital Services Act (DSA) | Must have reporting mechanism, act on reports, transparency reports | Up to 6% of global revenue |
| **EU** | CSAM Regulation (proposed) | May require client-side scanning (controversial, possibly unconstitutional) | TBD |
| **UK** | Online Safety Act 2023 | Platforms must prevent children from accessing harmful content; can compel backdoors | Criminal liability for executives |
| **Germany** | NetzDG | Must remove "clearly illegal" content within 24h of report | Up to EUR 50M fine |
| **India** | IT Act 2000 + Rules 2021 | Must have grievance officer, takedown within 36h | Platform loses safe harbor |
| **Australia** | Online Safety Act 2021 | eSafety Commissioner can issue removal notices | A$555K per day for non-compliance |

#### The E2E Encryption Defense (And Its Limits)

**What protects you:**
- "We literally cannot see the content -- it's end-to-end encrypted"
- This is a STRONG defense in the US (Section 230 + First Amendment)
- Signal uses this defense successfully

**What does NOT protect you:**
- If a user reports content to you with a screenshot/evidence -> you now have "actual knowledge"
- If law enforcement serves you with a warrant for metadata (IP, user IDs, timestamps, who talked to whom) -> you MUST comply
- If you host unencrypted metadata (conversation graph, user registration IPs) -> that's discoverable
- CSAM reporting obligation exists even for encrypted platforms in many jurisdictions if you gain knowledge by any means

#### What You MUST Have (Legal Minimums)

| Requirement | Why | Implementation |
|------------|-----|----------------|
| **Terms of Service** | Legal shield -- users agree to not use for illegal purposes | Static page, legal boilerplate |
| **Report mechanism** | Required by DSA, Online Safety Act, and most frameworks | "Report" button in UI -> admin queue |
| **Admin ban capability** | You must be able to act on reports | Admin dashboard: ban user, delete account |
| **Log retention policy** | Know what you store and for how long, be transparent | Privacy policy page |
| **NCMEC reporting process** | US federal law if you gain knowledge of CSAM | Register with NCMEC as an ESP |
| **Law enforcement contact** | Most jurisdictions require a designated contact | abuse@yourdomain.com, published in ToS |
| **Data preservation capability** | If you receive a legal preservation request, you must freeze metadata | Script to export user metadata on warrant |

#### What You Should NOT Do

| Bad Idea | Why |
|----------|-----|
| Client-side scanning (hash matching) | Destroys your privacy USP, false positives, slippery slope, may violate user trust |
| Logging message content | Defeats E2E encryption, massive liability if breached |
| Requiring real identity | Kills your core differentiator vs Signal |
| Ignoring reports | Loses safe harbor, criminal liability |
| Operating without ToS | No legal shield at all |

#### Recommended Architecture: Privacy-Preserving Trust & Safety

```
                   User reports abuse
                        |
                        v
              +-------------------+
              |  Report Queue     |  <-- Stores: reporter ID, reported user ID,
              |  (server-side)    |      report reason, timestamp, screenshot (optional)
              +--------+----------+
                       |
                       v
              +-------------------+
              |  Admin Dashboard  |  <-- Self-hosted admin reviews reports
              |  (authenticated)  |      Can: ban user, delete account, dismiss
              +--------+----------+
                       |
            +----------+----------+
            |                     |
            v                     v
    +-------+------+    +--------+--------+
    | Ban user     |    | NCMEC report    |
    | (delete data,|    | (if CSAM, legal |
    |  block IP)   |    |  obligation)    |
    +--------------+    +-----------------+

What you CAN see (metadata):
  - Username, registration IP, registration date
  - Conversation IDs, participant IDs
  - Message timestamps, message IDs
  - Media file sizes (but not content)

What you CANNOT see (E2E encrypted):
  - Message content
  - Media content
  - File names (encrypted)
```

#### Implementation Priority

| # | Item | Time | Priority |
|---|------|------|----------|
| 1 | Terms of Service + Privacy Policy pages | 4 hrs | **CRITICAL -- do before launch** |
| 2 | Proof of Work on registration | 8 hrs | **HIGH** |
| 3 | Report button + admin queue | 8 hrs | **HIGH** |
| 4 | Admin dashboard (ban/review) | 10 hrs | **HIGH** |
| 5 | IP logging on registration (opt-in for hosted, off for self-hosted) | 2 hrs | **MEDIUM** |
| 6 | Trust/reputation levels for new accounts | 6 hrs | **MEDIUM** |
| 7 | CAPTCHA integration (hCaptcha) | 4 hrs | **MEDIUM** |
| 8 | NCMEC ESP registration | 2 hrs | **REQUIRED (US hosting)** |

#### The Bottom Line on Legal Risk

**If you self-host for personal/company use**: Minimal risk. You control the users.

**If you host publicly (free + pro tiers)**: You NEED at minimum:
1. Terms of Service (legal shield)
2. Report mechanism (legal requirement in EU/UK/most places)
3. Ability to ban users (to act on reports)
4. NCMEC registration (US federal law if you learn of CSAM)
5. Law enforcement contact (abuse@ email)

**The privacy-preserving approach**: You never scan content. You never break E2E. But when users report abuse to you, you act on the metadata you have (ban the account, preserve data if legally required, report to NCMEC if applicable). This is exactly what Signal does.

**Cost of doing nothing**: Platform seizure, personal criminal liability (UK Online Safety Act), fines up to 6% of revenue (DSA). Not worth it.

---

## Feature Roadmap (Revenue-First Order)

---

## Tier 0: Critical Fixes

### 0.1 WebSocket Rate Limiting

**Problem**: Socket.io `send_message` has ZERO rate limiting. Anyone can flood a conversation.

**Difficulty**: Easy | **Time**: ~2 hours

**Implementation**:
- Per-user in-memory counter: max 30 messages per 10 seconds per user
- If exceeded: drop the message, emit an error, and temporarily mute the user (30s cooldown)
- Log abuse attempts

**Files to modify**:
- `server/websocket.js` -- add throttle check before processing `send_message`

```javascript
// Rate limiter state (per userId)
const messageLimits = new Map(); // userId -> { count, windowStart }
const MSG_LIMIT = 30;
const MSG_WINDOW_MS = 10_000;
const MSG_COOLDOWN_MS = 30_000;

function isRateLimited(userId) {
  const now = Date.now();
  let entry = messageLimits.get(userId);
  if (!entry || now - entry.windowStart > MSG_WINDOW_MS) {
    entry = { count: 0, windowStart: now, cooldownUntil: 0 };
    messageLimits.set(userId, entry);
  }
  if (now < entry.cooldownUntil) return true;
  entry.count++;
  if (entry.count > MSG_LIMIT) {
    entry.cooldownUntil = now + MSG_COOLDOWN_MS;
    return true;
  }
  return false;
}
```

---

## Tier 1: Revenue-Generating Features

### 1.1 Disappearing / Self-Destructing Messages

**Why it makes money**: THE killer feature for privacy users. Signal has it, but locked to their ecosystem. We offer it with full anonymity + self-hosting.

**Monetization**: Free = 24h/7d timers. **Pro** = 5s, 30s, 1m, 5m, custom timers + "View Once" for media.

**Difficulty**: Medium | **Time**: ~12-15 hours

#### Architecture

**Database changes:**
```sql
ALTER TABLE messages ADD COLUMN expires_at INTEGER DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN default_ttl INTEGER DEFAULT NULL;
  -- TTL in milliseconds, NULL = no auto-expire
```

**Server changes:**
- On `send_message`: if conversation has `default_ttl`, set `expires_at = timestamp + ttl`
- Background interval (every 60s): `DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?`
- Also delete associated media files from disk when expired messages are cleaned up
- New socket event: `messages_expired` -> notify clients to remove from UI

**Client changes:**
- New: timer selector UI in `MessageInput.jsx` (timer icon -> dropdown: 5s, 30s, 1m, 5m, 1h, 24h, 7d, off)
- Per-conversation setting stored on conversation record
- Client-side countdown badge on messages with expiry
- "View Once" mode for media: after first load, emit `message_viewed` -> server deletes

**Files to create/modify:**
| File | Action |
|------|--------|
| `server/db.js` | Add `expires_at` column, `default_ttl` on conversations |
| `server/websocket.js` | Set expiry on send, add expiry cleanup interval |
| `server/routes/conversations.js` | Endpoint to update conversation TTL |
| `client/components/MessageInput.jsx` | Timer selector UI |
| `client/components/ChatWindow.jsx` | Expiry countdown badge on messages |
| `client/App.jsx` | Handle `messages_expired` socket event |

---

### 1.2 Burner Rooms (Anonymous, No Registration)

**Why it makes money**: This is our BIGGEST differentiator over Signal. Create a link, share it, anyone can join without creating an account. The conversation auto-expires.

**Monetization**: Free = 3 rooms/month, 1 hour max duration. **Pro** = unlimited rooms, up to 30 days, password-protected rooms.

**Difficulty**: Medium | **Time**: ~15-20 hours

#### Architecture

**New database table:**
```sql
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,           -- short URL-friendly string (e.g. "abc123")
  conversation_id TEXT REFERENCES conversations(id),
  created_by TEXT REFERENCES users(id),
  password_hash TEXT DEFAULT NULL,     -- optional bcrypt hash
  max_participants INTEGER DEFAULT 10,
  expires_at INTEGER NOT NULL,         -- auto-delete time
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE anonymous_tokens (
  token TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,          -- self-chosen, not verified
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**New server endpoints:**
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `POST /api/rooms` | POST | Create a room (auth required or anonymous with captcha) |
| `GET /api/rooms/:slug` | GET | Get room info (public -- no auth needed) |
| `POST /api/rooms/:slug/join` | POST | Join room -> returns anonymous token + conversation ID |
| `DELETE /api/rooms/:slug` | DELETE | Delete room (creator only) |

**Client flow:**
1. User clicks "Create Burner Room" -> chooses duration, optional password
2. Server creates room + conversation, returns shareable link: `https://blink.app/r/abc123`
3. Anyone opening the link sees a "Join Room" page -- enter display name, optional password
4. Server issues a temporary anonymous JWT (no user record, scoped to room)
5. Anonymous user joins the Socket.io room + key exchange
6. When room expires: server deletes conversation, all messages, all media, all tokens

**Key design decisions:**
- Anonymous tokens are NOT stored in `users` table -- separate `anonymous_tokens` table
- Room key exchange: room creator generates a room key and embeds it in the URL fragment (`#key=...`) -- server never sees it
- Alternatively: use the same ECDH exchange, treating anonymous users like regular users

**Files to create/modify:**
| File | Action |
|------|--------|
| `server/db.js` | Add `rooms` and `anonymous_tokens` tables |
| `server/routes/rooms.js` | **New** -- room CRUD + join endpoint |
| `server/app.js` | Register rooms route |
| `server/websocket.js` | Support anonymous token auth for room sockets |
| `server/cleanup.js` | **New** -- background job to purge expired rooms |
| `client/components/CreateRoomModal.jsx` | **New** -- room creation UI |
| `client/components/JoinRoomPage.jsx` | **New** -- public landing page for room links |
| `client/App.jsx` | Route handling for `/r/:slug` URLs |

---

### 1.3 Paid Storage Tiers (Stripe Integration)

**Why it makes money**: Direct SaaS revenue. Users pay for more storage and message persistence.

**Monetization**: Free = 500 MB / 30-day auto-delete. Pro = 10 GB / persist forever.

**Difficulty**: Medium | **Time**: ~15 hours

#### Architecture

**Database changes:**
```sql
CREATE TABLE subscriptions (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tier TEXT NOT NULL DEFAULT 'free',        -- 'free', 'pro', 'team'
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  storage_limit_bytes INTEGER NOT NULL DEFAULT 524288000,  -- 500 MB
  message_retention_days INTEGER DEFAULT 30,               -- NULL = forever
  current_storage_bytes INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Server changes:**
- On media upload: check `current_storage_bytes + file_size <= storage_limit_bytes`
- Reject if over quota with clear error: `{ error: 'Storage limit reached', current: X, limit: Y }`
- Stripe webhook handler: on subscription change -> update `subscriptions` table
- Background job: for free-tier users, delete messages older than `message_retention_days`

**Client changes:**
- Settings page: show storage usage bar (X / 500 MB used)
- "Upgrade to Pro" button -> Stripe Checkout redirect
- Upload error handling: show "Storage full" modal with upgrade CTA

**Files to create/modify:**
| File | Action |
|------|--------|
| `server/db.js` | Add `subscriptions` table |
| `server/routes/billing.js` | **New** -- Stripe checkout + webhook |
| `server/routes/media.js` | Enforce storage quota on upload |
| `server/cleanup.js` | Purge expired messages for free-tier users |
| `client/components/SettingsPage.jsx` | **New** -- storage usage + upgrade |

---

### 1.4 Relay-Only Mode (Zero Data at Rest)

**Why it makes money**: Ultra-paranoid users want messages that exist ONLY in transit. If the recipient is offline, the message is gone forever. No server storage at all.

**Monetization**: Pro feature -- "Zero-Trace Messaging."

**Difficulty**: Easy | **Time**: ~5 hours

#### Architecture

**Database changes:**
```sql
ALTER TABLE conversations ADD COLUMN storage_mode TEXT DEFAULT 'persistent';
  -- 'persistent' (normal) | 'relay_only' (no storage)
```

**Server changes (`websocket.js`):**
- In `send_message`: if conversation `storage_mode === 'relay_only'`:
  - Emit via Socket.io to the room as normal
  - Do NOT `INSERT INTO messages` -- skip the database entirely
  - Ack with `{ success: true, relayOnly: true }`

**Client changes:**
- Conversation settings: toggle "Relay-Only Mode" (with warning: "Messages won't be stored. If the recipient is offline, they're gone.")
- In `useMessages`: skip `getMessages()` API call for relay-only conversations (there's nothing to fetch)
- Show a banner: "Relay-only -- messages are not stored"

---

### 1.5 Screenshot Detection & Notification

**Why it makes money**: Privacy-conscious users pay for knowing when someone screenshots their conversation.

**Monetization**: Pro feature.

**Difficulty**: Easy (client-side) | **Time**: ~5-8 hours

#### Architecture

**Detection methods (client-side):**
```javascript
// 1. Keyboard shortcut detection (PrintScreen, Cmd+Shift+3/4)
document.addEventListener('keyup', (e) => {
  if (e.key === 'PrintScreen' ||
      (e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4'))) {
    notifyScreenshot();
  }
});

// 2. Visibility change (not reliable alone, but helps)
document.addEventListener('visibilitychange', () => { /* correlate with other signals */ });

// Note: These are deterrents, not guarantees. A user can always
// photograph the screen with another device. The value is in the
// social pressure / notification, not absolute prevention.
```

**Socket event:** `screenshot_detected` -> `{ conversationId, userId, timestamp }`

**Server**: pure relay -- broadcast to conversation room.

**Client UI**: Show "Warning: Alice may have taken a screenshot" as a system message in the chat.

---

## Tier 2: Engagement & Polish

### 2.1 Read Receipts

**Time**: ~5 hours

**Architecture:**
- New socket events: `message_delivered` (message reached client), `message_read` (conversation opened and message visible in viewport)
- Client: use `IntersectionObserver` to detect when a message scrolls into view -> emit `message_read`
- UI: Single check = sent, Double check = delivered, Blue double check = read
- Per-conversation toggle: "Send read receipts" on/off (privacy-respecting)

**Files:** `websocket.js` (relay events), `ChatWindow.jsx` (UI ticks + observer), `useMessages.js` (track status)

---

### 2.2 Typing Indicators

**Time**: ~3 hours

**Architecture:**
- Socket event: `typing` -> `{ conversationId, userId }`
- Client: emit on keystroke (debounced, max 1 per 3 seconds), auto-stop after 5 seconds of no input
- UI: "Alice is typing..." in chat header, with animated dots

**Files:** `websocket.js`, `MessageInput.jsx` (emit), `ChatWindow.jsx` (display)

---

### 2.3 Message Reactions (Emoji)

**Time**: ~6 hours

**Architecture:**
```sql
CREATE TABLE reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (message_id, user_id, emoji)
);
```
- Socket events: `reaction_add`, `reaction_remove` -> relay to conversation room
- Client: double-tap or hover -> reaction picker (6 emojis)
- Display: small emoji badges below the message bubble with count

**Files:** `db.js`, `websocket.js`, `ChatWindow.jsx`, new `ReactionPicker.jsx`

---

### 2.4 Message Search (Client-Side Encrypted Search)

**Time**: ~8 hours

**Architecture:**
- Server cannot search ciphertext -- search must be client-side
- Search across the decrypted messages already in the message cache
- For full history: paginate through all messages, decrypt, filter
- UI: search bar at the top of ChatWindow -> filter messages -> highlight matches
- Index: build an in-memory inverted index from cached plaintext for fast lookup

**Files:** `ChatWindow.jsx` (search bar + highlight), `messageCache.js` (search API)

---

### 2.5 PWA + Push Notifications

**Time**: ~10 hours

**Architecture:**
- `manifest.json` + Service Worker for "install as app" on mobile/desktop
- Push notifications via Web Push API (VAPID keys)
- Server: store push subscription endpoints per device
- When a message arrives and user is not connected via Socket.io -> send web push
- Notification content: "New message from Alice" (never include plaintext -- E2E)

**Files:** `public/manifest.json`, `public/sw.js`, `server/routes/push.js`, `client/services/pushService.js`

---

## Tier 3: Infrastructure Features

### 3.1 Large File Uploads (up to 10 GB)

**Difficulty**: Hard | **Estimate**: 20-30 hours

#### Problem Statement

Current limits:
| Component | Current Limit | Required |
|-----------|---------------|----------|
| Multer `fileSize` | 100 MB | 10 GB |
| Axios `maxBodyLength` | 110 MB | 10 GB |
| **Web Crypto AES-GCM** | **~2 GB** (NIST spec hard limit) | 10 GB |
| Browser memory | In-memory `Uint8Array` | Streaming needed |

The **critical blocker** is the Web Crypto API's AES-GCM limit of ~2 GB per operation. For 10 GB, **chunked encryption** is mandatory.

#### Architecture

**Chunked Upload Protocol:**
```
Client                              Server
------                              ------
POST /api/media/upload-init    ->   Creates media record, returns mediaId
  { conversationId, totalChunks,    State: "uploading"
    totalSize, fileName }

For each 16 MB chunk:
  File.slice(start, end)
  -> AES-GCM encrypt (chunk + unique IV)
  POST /api/media/upload-chunk ->   Stores chunk file as {mediaId}_chunk_{n}.enc
    { mediaId, chunkIndex, iv }     Tracks received chunks
    + binary body

POST /api/media/upload-complete ->  Validates all chunks received
  { mediaId }                       State: "complete"
```

**New DB table:**
```sql
CREATE TABLE media_chunks (
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  iv TEXT NOT NULL,
  chunk_size INTEGER NOT NULL,
  PRIMARY KEY (media_id, chunk_index)
);
```

**Error handling:**
| Error | Handling |
|-------|----------|
| Network timeout on chunk | Retry same chunk (3 attempts, exponential backoff) |
| Server 5xx | Retry with backoff, show error after 3 failures |
| User navigates away | Persist upload state in IndexedDB, resume on return |
| AbortController signal | Clean up partial upload on server |

**Phased approach:**
- Phase 1 (~8 hrs): Raise limit to 500 MB (no chunking)
- Phase 2 (~12 hrs): Chunked upload/download with progress UI
- Phase 3 (~8 hrs): Resume support, File System Access API for huge downloads

---

### 3.2 Voice/Video Calling with WebRTC

**Difficulty**: Very Hard | **Estimate**: 60-100+ hours

#### Architecture

**Signaling via existing Socket.io:**
| Event | Direction | Payload |
|-------|-----------|---------|
| `call_initiate` | Caller -> Callee | `{ conversationId, callId, callType, sdpOffer }` |
| `call_answer` | Callee -> Caller | `{ conversationId, callId, sdpAnswer }` |
| `call_ice` | Bidirectional | `{ conversationId, callId, candidate }` |
| `call_reject` | Callee -> Caller | `{ conversationId, callId }` |
| `call_end` | Either -> Other | `{ conversationId, callId }` |

**STUN/TURN:**
- STUN: Google's public servers (free)
- TURN: Self-host `coturn` or use Twilio/Xirsys (~$50/mo)
- Without TURN: ~85% of calls work, ~15% fail (symmetric NAT)

**Client components:** `CallOverlay.jsx`, `IncomingCallModal.jsx`, `CallButton.jsx`

**Call state machine:** `idle -> outgoing_ringing -> connecting -> connected -> ended`

**Phased approach:**
- Phase 1 (~20 hrs): Audio-only 1:1 calls with STUN
- Phase 2 (~15 hrs): Video + camera switching
- Phase 3 (~15 hrs): TURN server integration
- Phase 4 (~10 hrs): E2E encryption via Insertable Streams API

---

### 3.3 Group End-to-End Encryption

**Difficulty**: Very Hard | **Estimate**: 40-80 hours

#### Problem

Current ECDH is 2-party only. `_findLatestPeerEntry()` picks ONE peer -- groups are fundamentally broken.

#### Recommended Approach: Sender Keys (WhatsApp-style)

Each sender generates their own symmetric key, distributes it to all group members via existing pairwise ECDH channels.

```
Alice generates SK_alice (256-bit AES key)
Alice encrypts SK_alice with pairwise key with Bob -> sends to Bob
Alice encrypts SK_alice with pairwise key with Carol -> sends to Carol
Alice sends group message: encrypt(SK_alice, "hello") -> broadcast
Bob/Carol decrypt with SK_alice
```

**New DB table:**
```sql
CREATE TABLE group_sender_keys (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  encrypted_sender_key TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_generation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

**Key rotation:** On member add/remove, all remaining members generate new sender keys.

**Phased approach:**
- Phase 1 (~15 hrs): Sender key generation + distribution
- Phase 2 (~15 hrs): Group encrypt/decrypt integration
- Phase 3 (~10 hrs): Key rotation on member changes
- Phase 4 (~10 hrs): Group settings UI
- Phase 5 (~10 hrs): Edge cases, multi-device, testing

---

## Infrastructure Note: SQLite vs PostgreSQL

### Current State

We use **SQLite** via `better-sqlite3` with WAL mode. No Docker in development -- just `node app.js` on bare metal.

### Should We Switch to PostgreSQL?

| Factor | SQLite | PostgreSQL |
|--------|--------|------------|
| **Concurrent writes** | Single-writer lock (WAL helps for reads, but 1 writer at a time) | Fully concurrent multi-writer MVCC |
| **Users before trouble** | ~500-2,000 concurrent (depends on write frequency) | 50,000+ concurrent no problem |
| **Setup complexity** | Zero -- just a file | Needs a running server process |
| **Deployment** | Copy one file, done | Docker or managed service (Supabase, Neon, RDS) |
| **Backups** | `cp blink.db blink.db.bak` | `pg_dump` or streaming replication |
| **Full-text search** | FTS5 extension (built-in, good enough) | `tsvector`/`tsquery` (much more powerful) |
| **JSON queries** | `json_extract()` (limited) | `jsonb` (world-class) |
| **Cost** | Free, zero infra | Free (self-hosted) or $0-25/mo (managed) |

### Verdict: Stay on SQLite for Now, Plan the Migration

**SQLite is fine up to ~1,000 concurrent users.** That's your entire free tier growth phase. Switching to Postgres before you have users is premature optimization.

**When to migrate:**
- When you consistently see `SQLITE_BUSY` errors under load
- When you need horizontal scaling (multiple server instances)
- When you deploy to a managed platform (Railway, Fly.io, Render) where file-based DB is awkward

**Migration plan (when the time comes, ~8-12 hrs):**
1. Replace `better-sqlite3` with `pg` or `postgres` (npm package)
2. Convert `CREATE TABLE` DDL (mostly identical, change `unixepoch()` -> `EXTRACT(EPOCH FROM NOW())`)
3. Replace `.prepare().run()` / `.get()` / `.all()` with `pool.query()`
4. Use Supabase (free tier) or Neon (free tier) for managed Postgres -- zero ops
5. Environment variable: `DATABASE_URL=postgres://...`

**Keep SQLite for self-hosted/single-user deployments** -- it's a genuine feature, not a limitation.

---

## Build Order: The Actual Implementation Plan

### PHASE 1: Pre-Launch Checklist (MUST complete before going public)

These are not optional. Launching publicly without these = getting shut down, flooded by bots, or facing legal liability.

| # | Feature | Time | Why It's Mandatory | Category |
|---|---------|------|--------------------|----------|
| P1 | **Terms of Service + Privacy Policy** | 4 hrs | No legal shield = personal liability. DSA/Online Safety Act require it. You can be sued on day 1 without this. | Legal |
| P2 | **WebSocket rate limiting** | 2 hrs | Anyone can flood every conversation right now. One script = platform down. | Security |
| P3 | **Proof of Work on registration** | 8 hrs | Without it, 10,000 bot accounts in an hour. Your DB fills up, real users get spammed. | Anti-spam |
| P4 | **Report button + admin queue** | 8 hrs | EU (DSA), UK (Online Safety Act), India (IT Rules) all REQUIRE a user-facing report mechanism. | Legal |
| P5 | **Admin dashboard (ban/review)** | 10 hrs | If someone reports illegal content and you can't act on it, you lose safe harbor protection. | Legal |
| P6 | **Registration IP logging** | 2 hrs | When (not if) law enforcement asks "who registered this account?", you need an answer. Log IP on registration only. | Legal |
| P7 | **NCMEC ESP registration** | 2 hrs | US federal law. If you host in the US and gain knowledge of CSAM, you MUST be registered to report it. Paperwork, not code. | Legal |
| | | **~36 hrs total** | | |

**Do NOT launch publicly until all P1-P7 are done.**

---

### PHASE 2: Revenue Features (Build the premium tier)

These are what make people pay. Build in this exact order -- each one unlocks the next.

| # | Feature | Time | Revenue Impact | Why This Order |
|---|---------|------|---------------|----------------|
| R1 | **Disappearing messages** | 12 hrs | Unlocks Pro tier -- the #1 feature privacy users expect | Must exist before you can sell "Pro" |
| R2 | **Burner rooms (no-account)** | 18 hrs | Viral growth engine + paid room upgrades | Your biggest USP over Signal. Drives signups. |
| R3 | **Paid storage tiers (Stripe)** | 15 hrs | **Direct recurring revenue** | Can't charge until R1/R2 give people a reason to pay |
| R4 | **Relay-only mode** | 5 hrs | Pro upsell -- "Zero-Trace" messaging | Quick win, high perceived value, low effort |
| R5 | **Screenshot detection** | 6 hrs | Pro upsell -- privacy power users | Easy to build, visible differentiator |
| R6 | **Reputation/trust levels** | 6 hrs | Spam prevention at scale (needed as users grow) | Growth creates spam; this handles it without PII |
| | | **~62 hrs total** | | |

---

### PHASE 3: Engagement & Polish (Keep users coming back)

These don't directly make money, but without them the product feels "unfinished" and users churn.

| # | Feature | Time | Impact | Notes |
|---|---------|------|--------|-------|
| E1 | **Read receipts** | 5 hrs | Users expect this. Without it, the app feels broken. | Single/double/blue checks |
| E2 | **Typing indicators** | 3 hrs | "Alice is typing..." -- 3 hours for a big UX upgrade | Always bundle with E1 |
| E3 | **Message reactions** | 6 hrs | Engagement. Replaces "lol"/"ok" messages. | 6 emoji picker |
| E4 | **hCaptcha integration** | 4 hrs | Extra anti-bot layer on top of PoW | Privacy-respecting, free tier available |
| E5 | **Message search** | 8 hrs | Power users need it. Client-side only (E2E = can't search server-side). | In-memory index of decrypted messages |
| E6 | **PWA + Push notifications** | 10 hrs | Mobile users need notifications or they forget the app exists | Web Push API, no app store needed |
| | | **~36 hrs total** | | |

---

### PHASE 4: Infrastructure (Scale & advanced features)

Only build these when you have paying users and actual demand. Each one is a big investment.

| # | Feature | Time | When To Build | Notes |
|---|---------|------|---------------|-------|
| I1 | **PostgreSQL migration** | 10 hrs | When you hit ~500 concurrent users or deploy to cloud | SQLite is fine until then |
| I2 | **Large file uploads (10 GB)** | 25 hrs | When paid storage tier exists and users request it | Needs chunked encryption (AES-GCM 2GB limit) |
| I3 | **Group E2E encryption** | 50 hrs | When group chat is actually requested by users | Current groups are broken (ECDH = 2-party only) |
| I4 | **WebRTC voice/video** | 80 hrs | Last priority -- commoditized, high effort | Needs TURN server ($50/mo) |
| | | **~165 hrs total** | | |

---

### Complete Ranked List (All Features, Final Order)

| Rank | Feature | Time | Phase | Category |
|------|---------|------|-------|----------|
| 1 | Terms of Service + Privacy Policy | 4 hrs | Pre-Launch | Legal |
| 2 | WebSocket rate limiting | 2 hrs | Pre-Launch | Security |
| 3 | Proof of Work on registration | 8 hrs | Pre-Launch | Anti-spam |
| 4 | Report button + admin queue | 8 hrs | Pre-Launch | Legal |
| 5 | Admin dashboard (ban/review) | 10 hrs | Pre-Launch | Legal |
| 6 | Registration IP logging | 2 hrs | Pre-Launch | Legal |
| 7 | NCMEC ESP registration | 2 hrs | Pre-Launch | Legal |
| 8 | Disappearing messages | 12 hrs | Revenue | Feature |
| 9 | Burner rooms (no-account) | 18 hrs | Revenue | Feature |
| 10 | Paid storage + Stripe | 15 hrs | Revenue | Monetization |
| 11 | Relay-only mode | 5 hrs | Revenue | Feature |
| 12 | Screenshot detection | 6 hrs | Revenue | Feature |
| 13 | Reputation/trust levels | 6 hrs | Revenue | Anti-spam |
| 14 | Read receipts | 5 hrs | Engagement | Polish |
| 15 | Typing indicators | 3 hrs | Engagement | Polish |
| 16 | Message reactions | 6 hrs | Engagement | Polish |
| 17 | hCaptcha on registration | 4 hrs | Engagement | Anti-spam |
| 18 | Message search | 8 hrs | Engagement | Feature |
| 19 | PWA + Push notifications | 10 hrs | Engagement | Feature |
| 20 | PostgreSQL migration | 10 hrs | Infra | Scaling |
| 21 | Large file uploads (10 GB) | 25 hrs | Infra | Feature |
| 22 | Group E2E encryption | 50 hrs | Infra | Feature |
| 23 | WebRTC calling | 80 hrs | Infra | Feature |
| | **TOTAL** | **~299 hrs** | | |

---

### Dependency Graph

```
  PHASE 1: PRE-LAUNCH (do all before going public)
  ================================================
  P1 ToS ----+
  P2 WS Rate-+---> P3 PoW ---> P4 Report ---> P5 Admin Dashboard
  P6 IP Log--+                                       |
  P7 NCMEC --+                                       |
                                                      |
  PHASE 2: REVENUE (build premium tier)               |
  =============================================       |
  R1 Disappearing msgs  <----------------------------+
  R2 Burner rooms       <----------------------------+
       |        |
       v        v
  R3 Stripe (paid tiers)
       |
       +---> R4 Relay-only mode
       +---> R5 Screenshot detection
       +---> R6 Trust levels
  
  PHASE 3: ENGAGEMENT (polish)
  ============================
  E1 Read receipts  \
  E2 Typing         |--- Can be done in any order
  E3 Reactions      |
  E4 hCaptcha       |
  E5 Search         |
  E6 PWA + Push     /
  
  PHASE 4: INFRA (scale when needed)
  ==================================
  I1 PostgreSQL migration  (when >500 concurrent users)
  I2 Large uploads         (after R3 Stripe exists)
  I3 Group E2E             (after user demand)
  I4 WebRTC                (last -- highest effort, lowest ROI)
```

---

### Signal vs Blink -- Feature Comparison (Post-Roadmap)

| Feature | Signal | Blink (after roadmap) |
|---------|--------|-----------------------|
| E2E Encryption | Double Ratchet | ECDH + HKDF chain ratchet |
| No phone number required | No | **Yes** |
| No registration option (burner rooms) | No | **Yes** |
| Self-hostable (easy) | No | **Yes** |
| Web-only (no install) | No | **Yes** |
| Original quality media | No | **Yes** |
| Disappearing messages | Yes | Yes |
| Relay-only mode | No | **Yes** |
| Screenshot alerts | No | **Yes** |
| Read receipts | Yes | Yes |
| Typing indicators | Yes | Yes |
| Reactions | Yes | Yes |
| Anti-spam (no PII required) | Phone # = spam gate | PoW + reputation |
| Voice/Video calls | Yes | Planned |
| Group encryption | Yes | Planned |
| Mobile app (native) | Yes | No (PWA only) |
| Security audit | Yes | No |
| User base | 40M+ | TBD |

**TL;DR: We don't beat Signal at security. We beat them at anonymity, accessibility, and self-sovereignty -- and we have a business model.**
