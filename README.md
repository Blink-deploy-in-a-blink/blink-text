# blink-text

> **Privacy-focused, end-to-end encrypted messaging.**  
> The server is a dumb relay — it never sees your private keys, conversation keys, or plaintext messages.

---

## Table of Contents

1. [How it works](#how-it-works)
2. [Features](#features)
3. [Architecture](#architecture)
4. [Prerequisites](#prerequisites)
5. [Repo structure](#repo-structure)
6. [Quick start — local development](#quick-start--local-development)
7. [Admin setup](#admin-setup)
8. [Deploying on your LAN](#deploying-on-your-lan)
9. [Deploying to AWS EC2 (production)](#deploying-to-aws-ec2-production)
10. [Environment variables](#environment-variables)
11. [Scripts reference](#scripts-reference)
12. [API reference](#api-reference)
13. [WebSocket events](#websocket-events)
14. [Manual testing walkthrough](#manual-testing-walkthrough)
15. [Running with Docker](#running-with-docker)
16. [Security notes](#security-notes)

---

## How it works

```
Alice types a message
        │
        ▼
  cryptoService.js  ← Web Crypto API (AES-256-GCM)
  encryptForConversation()
        │
        ▼
  Socket.io  ──────►  Server (sees only ciphertext + iv)
                             │
                             ▼
                      Bob's browser
                      decryptConversationMessage()
                             │
                             ▼
                     Bob reads plaintext
```

**Key exchange** happens once per conversation using ECDH P-256. Each device generates an ephemeral keypair, shares the public half via the server, and derives a shared `AES-256-GCM` key locally using HKDF-SHA-256. The server never touches the private keys or the derived key.

---

## Features

### Core Messaging
- **End-to-end encrypted messaging** — AES-256-GCM, ECDH P-256 key exchange, HKDF-SHA-256 key derivation
- **Direct messages & group chats** — create conversations with one or multiple users
- **Real-time delivery** — Socket.io WebSocket transport with instant message relay
- **Message editing** — edit sent messages (re-encrypted, relayed to all participants)
- **Message deletion** — delete for yourself or delete for everyone
- **Message forwarding** — forward text or media messages to other conversations
- **Reply-to / quoting** — reply to specific messages with inline context

### Media
- **Encrypted media sharing** — send images and files, encrypted client-side before upload
- **Media preview modal** — full-screen lightbox with zoom for images
- **Download original** — download decrypted media files to disk

### Trust & Safety
- **Proof-of-Work anti-spam** — SHA-256 puzzle (difficulty 18) required at registration to block bots
- **Terms of Service & Privacy Policy** — users must accept ToS before creating an account
- **User reporting** — report users with reason, linked to specific messages/conversations
- **Admin dashboard** — full moderation panel (see [Admin setup](#admin-setup))
- **Ban / unban users** — banned users are blocked from API and WebSocket access immediately
- **Registration IP logging** — stored for abuse investigation (admin-visible only)
- **WebSocket rate limiting** — per-event rate limits to prevent message flooding
- **REST API rate limiting** — 20 auth requests / 15 min; 200 general requests / min

### Account Management
- **Secure registration** — bcrypt password hashing, PoW challenge, ToS acceptance
- **Token refresh** — 30-day JWT with auto-refresh on app open
- **Password change** — change password while logged in
- **Account deletion** — permanently delete your account and optionally all conversations
- **Session management** — automatic logout on token expiry, tab-close detection

### Admin & Moderation
- **Admin CLI** — promote/demote users via server-side command line (no API endpoint for security)
- **Admin panel** — browser-based dashboard with platform stats, user management, and report queue
- **Report review queue** — review, resolve, or dismiss user reports
- **User search & filtering** — search users, filter by active/banned/deleted status
- **Ban enforcement** — bans checked on every authenticated request and WebSocket connection

---

## Architecture

```
apps/
  server/          Node.js · Express · Socket.io · SQLite
  web-client/      React · Vite

packages/
  crypto/          Standalone TypeScript crypto engine (no framework deps)
  shared/          Wire-format schemas & validation helpers
```

### `packages/crypto` — platform-agnostic crypto engine

| Layer | Description |
|---|---|
| `CryptoProvider` interface | Contract every runtime must implement |
| `BrowserProvider` | Web Crypto API (`window.crypto.subtle`) |
| `NodeProvider` | Node.js built-in `node:crypto` |
| `CryptoEngine` | Facade — all app code talks to this, never raw APIs |

The same engine can be plugged into a React app (browser provider), a CLI tool (node provider), or a future mobile app.

### Database tables

| Table | Purpose |
|---|---|
| `users` | Username, bcrypt password hash, admin/banned flags, registration IP, soft-delete |
| `devices` | Per-device ECDSA identity key + ECDH public key |
| `conversations` | `direct_message` or `group_chat` |
| `conversation_participants` | Many-to-many user ↔ conversation |
| `messages` | Encrypted payloads only (`ciphertext`, `iv`, `version`), message type, media references |
| `message_deletions` | Tracks per-user "delete for me" soft deletes |
| `key_exchange_data` | Ephemeral ECDH public keys used to bootstrap conversation keys |
| `media` | Metadata for encrypted media uploads (file path, IV, size) |
| `reports` | User reports with reason, linked message/conversation, review status |

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 18 | 20+ recommended; 24 tested |
| npm | 9 | Workspaces support required |
| Git | any | — |

No database server needed — SQLite is embedded.

---

## Repo structure

```
.
├── apps/
│   ├── server/
│   │   ├── app.js              Express app (helmet, CORS, rate-limit, routes)
│   │   ├── auth.js             JWT middleware + token signing
│   │   ├── db.js               SQLite setup + schema migration
│   │   ├── websocket.js        Socket.io handlers (messages, key exchange, edit, delete)
│   │   ├── admin-cli.js        CLI tool to promote/demote admin users
│   │   ├── routes/
│   │   │   ├── auth.js         POST /api/auth/register|login|refresh + PoW challenge
│   │   │   ├── conversations.js GET/POST /api/conversations + messages
│   │   │   ├── devices.js      GET/POST /api/devices
│   │   │   ├── keys.js         GET/POST /api/keys/exchange
│   │   │   ├── media.js        POST /api/media/upload + GET /api/media/:id
│   │   │   ├── reports.js      POST /api/reports (user reporting)
│   │   │   ├── admin.js        /api/admin/* (stats, users, reports, ban/unban)
│   │   │   └── users.js        GET /api/users/search
│   │   └── .env.example
│   └── web-client/
│       ├── public/
│       │   └── pow-worker.js   Web Worker for Proof-of-Work solving
│       ├── src/
│       │   ├── App.jsx
│       │   ├── components/
│       │   │   ├── Login.jsx
│       │   │   ├── Register.jsx          Registration with ToS + PoW
│       │   │   ├── ChatWindow.jsx        Message display, context menus
│       │   │   ├── ConversationList.jsx
│       │   │   ├── MessageInput.jsx      Text + media input with reply/edit
│       │   │   ├── NewConversationModal.jsx
│       │   │   ├── ForwardModal.jsx      Forward messages to conversations
│       │   │   ├── MediaPreviewModal.jsx Fullscreen image lightbox
│       │   │   ├── ReportModal.jsx       Report users with reason
│       │   │   ├── AdminPanel.jsx        Admin dashboard UI
│       │   │   ├── TermsOfService.jsx    Terms of Service page
│       │   │   └── PrivacyPolicy.jsx     Privacy Policy page
│       │   ├── hooks/
│       │   │   ├── useAuth.js            Auth state + PoW registration flow
│       │   │   ├── useMessages.js        Message state + WebSocket listeners
│       │   │   └── useBackgroundPreloader.js
│       │   └── services/
│       │       ├── api.js                Axios REST calls
│       │       ├── socket.js             Socket.io client
│       │       ├── cryptoService.js      Browser-side E2E crypto
│       │       ├── messageCache.js       Local message cache + unread counts
│       │       ├── forwardService.js     Forward message logic
│       │       └── powService.js         PoW solver (wraps Web Worker)
│       └── vite.config.js
├── packages/
│   ├── crypto/
│   │   ├── src/
│   │   │   ├── types.ts        CryptoProvider interface + message types
│   │   │   ├── engine.ts       CryptoEngine facade
│   │   │   └── provider/
│   │   │       ├── browser.ts  Web Crypto API provider
│   │   │       └── node.ts     Node.js crypto provider
│   │   └── tsup.config.ts
│   └── shared/
│       └── src/index.js        Wire-format validation helpers
├── docker-compose.yml
└── package.json                npm workspace root
```

---

## Quick start — local development

### 1. Clone and install

```bash
git clone https://github.com/Blink-deploy-in-a-blink/blink-text.git
cd blink-text
npm install          # installs all workspace packages at once
```

### 2. Build the crypto package

```bash
npm run build:crypto
```

This compiles `packages/crypto/src/*.ts` → `packages/crypto/dist/` (CJS + ESM + `.d.ts`).  
The web client resolves the crypto package via Vite aliases to the TypeScript source directly, so you only **need** this step when using the built package from Node.js.

### 3. Configure the server

```bash
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env` and set a strong, random `JWT_SECRET`:

```env
JWT_SECRET=replace-with-a-long-random-string-at-least-32-chars
PORT=3001
DATABASE_PATH=./blink.db
```

> **Never commit `.env`.** It is already in `.gitignore`.

### 4. Start the server

```bash
# Option A — from the root (uses npm workspaces)
npm run dev:server

# Option B — directly
cd apps/server
node --watch app.js
```

The server starts on `http://localhost:3001`. You should see:

```
[auth] WARNING: JWT_SECRET is not set. Using an insecure default. ...   ← only if .env is missing
Blink-Text server listening on port 3001
```

### 5. Start the web client

Open a **second terminal**:

```bash
# Option A — from the root
npm run dev:client

# Option B — directly
cd apps/web-client
npx vite
```

The client starts on `http://localhost:5173`.

### 6. Use the app

Open **two separate browser windows** (or one normal + one incognito tab):

1. In **Window 1** → Register as `alice` / `alice_password`
2. In **Window 2** → Register as `bob` / `bob_password`
3. In **Window 1** → Click **New conversation**, search for `bob`, select Direct Message, click Create
4. Type a message and press **Enter** or click **Send**
5. Switch to **Window 2** — Bob's window will receive and decrypt the message in real time

---

## Admin setup

Admin users can access the **Admin Panel** in the web client, which provides platform statistics, user management (search, ban/unban), and a report review queue.

### Why CLI-only?

There is **no API endpoint** to grant admin access. This is intentional — only the server operator with direct shell access should be able to promote users. This eliminates privilege escalation attacks via the API.

### Promote a user to admin

After a user has registered through the web client, SSH into your server and run:

```bash
cd apps/server
node admin-cli.js promote <username>
```

Example:
```bash
node admin-cli.js promote alice
# ✅ User "alice" has been promoted to admin.
```

### Demote an admin

```bash
node admin-cli.js demote <username>
```

### List all admins

```bash
node admin-cli.js list
# Admin users (1):
#   • alice (registered 2026-03-15)
```

### Using the Admin Panel

Once promoted, refresh the web client. An **⚙️ Admin** button appears in the sidebar. The panel includes:

| Tab | What it shows |
|---|---|
| **Overview** | Total users, conversations, messages, reports, active sessions |
| **Reports** | Pending user reports with reason, reporter, reported user, timestamps. Resolve or dismiss reports. |
| **Users** | Searchable user list with status (active/banned/deleted), registration IP, report count. Ban or unban users. |

> **Note on Windows:** Use `node admin-cli.js` (not `npm` scripts) to run the CLI directly. On PowerShell, `npm.cmd` works but is not required for this tool.

---

## Deploying on your LAN

Want to use blink-text with friends/devices on the same Wi-Fi network? You can run the server on one machine and access it from phones, laptops, etc.

> **Important:** The Web Crypto API (`crypto.subtle`) requires a **secure context**. This means the app must be served over HTTPS or from `localhost`. If you access it via a plain `http://192.168.x.x` URL, encryption will not work. Use one of the options below.

### Option A — Access from the same machine (easiest)

Just follow the [Quick start](#quick-start--local-development) steps above. Open `http://localhost:5173` in two browser windows.

### Option B — Access from other devices on the LAN

#### 1. Start the server and client as normal

```bash
npm run dev:server   # terminal 1
npm run dev:client   # terminal 2
```

The Vite dev server already listens on `0.0.0.0` (all interfaces).

#### 2. Find your machine's LAN IP

```bash
# macOS / Linux
ip addr show | grep "inet 192"

# Windows (PowerShell)
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' }
```

#### 3. Open on other devices

On your phone or other laptop, open:

```
https://<your-lan-ip>:5173
```

> **Note:** You need HTTPS for `crypto.subtle` to work on non-localhost origins. You can use a self-signed certificate or a tool like [mkcert](https://github.com/FiloSottile/mkcert) to generate trusted local certs. Alternatively, skip straight to the [AWS deployment](#deploying-to-aws-ec2-production) for a proper HTTPS setup via Cloudflare.

#### 4. Update CORS (if needed)

The server already accepts connections from private-network IPs (`192.168.*`, `10.*`, `172.16-31.*`). No changes needed.

---

## Deploying to AWS EC2 (production)

This guide deploys blink-text on an EC2 instance with nginx as a reverse proxy and Cloudflare for free HTTPS.

### Architecture

```
Browser ──HTTPS──► Cloudflare ──HTTP──► nginx:80 ──► node:3001
                   (TLS termination)    (reverse     (Express serves
                                         proxy)       API + static files
                                                      + WebSocket)
```

In production, you do **not** run the Vite dev server. Instead:
- `vite build` compiles the client into static HTML/JS/CSS files
- The Express server (`app.js`) serves those files AND handles the API + WebSocket
- nginx sits in front on port 80 as a reverse proxy
- Cloudflare handles TLS termination (Flexible SSL mode)

### 1. Provision an EC2 instance

- **AMI:** Ubuntu 22.04+ (or Amazon Linux 2023)
- **Instance type:** `t3.micro` (free tier) is fine for small groups
- **Security group:** Open ports **80** (HTTP) and **22** (SSH). Do **not** expose port 3001 — nginx handles routing.
- **Elastic IP:** Attach one so the IP doesn't change on restart

### 2. Install dependencies on EC2

```bash
# SSH into your instance
ssh -i your-key.pem ubuntu@<ec2-public-ip>

# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install nginx
sudo apt update && sudo apt install -y nginx

# Verify
node -v    # v20.x or higher
npm -v     # 9.x or higher
nginx -v
```

### 3. Clone and build

```bash
git clone https://github.com/Blink-deploy-in-a-blink/blink-text.git
cd blink-text

# Install all workspace dependencies
npm install

# Build the web client (produces apps/web-client/dist/)
cd apps/web-client
npx vite build
cd ../..
```

### 4. Configure the server

```bash
cd apps/server
cp .env.example .env
nano .env
```

Set these values:

```env
JWT_SECRET=replace-with-a-long-random-string-at-least-32-chars
PORT=3001
CLIENT_ORIGIN=https://yourdomain.com
```

> Replace `yourdomain.com` with your actual Cloudflare domain.

### 5. Set up nginx

An nginx config file is included in the repo root (`nginx.conf`). Copy it into place:

```bash
cd ~/blink-text
sudo cp nginx.conf /etc/nginx/sites-available/blink
sudo ln -sf /etc/nginx/sites-available/blink /etc/nginx/sites-enabled/blink
sudo rm -f /etc/nginx/sites-enabled/default

# Edit to set your domain (optional but recommended)
sudo nano /etc/nginx/sites-available/blink
# Change: server_name _; → server_name yourdomain.com;

# Test and restart
sudo nginx -t
sudo systemctl restart nginx
```

The nginx config handles:
- Proxying all HTTP traffic to Node.js on port 3001
- WebSocket upgrades for Socket.io (`/socket.io/`)
- 24-hour WebSocket timeout to prevent idle disconnects

### 6. Start the server

```bash
cd ~/blink-text/apps/server

# Quick test
node app.js

# For production — use pm2 to keep it running
sudo npm install -g pm2
pm2 start app.js --name blink
pm2 save
pm2 startup    # follow the printed command to enable auto-start on reboot
```

### 7. Set up Cloudflare

1. **Add your domain** to Cloudflare (free plan works)
2. **DNS:** Create an `A` record pointing to your EC2 Elastic IP, with **Proxy enabled** (orange cloud)
3. **SSL/TLS:** Set encryption mode to **Flexible** (Cloudflare terminates TLS, connects to your server on HTTP)
4. **WebSockets:** Enabled by default on all Cloudflare plans

### 8. Verify

Open `https://yourdomain.com` in a browser. You should see the blink-text login page. Register two accounts and test messaging.

### Updating the deployment

```bash
cd ~/blink-text
git pull

# Rebuild the client
cd apps/web-client && npx vite build && cd ../..

# Restart the server
pm2 restart blink
```

---

## Environment variables

### Server (`apps/server/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **Yes** | `change-me-in-production` | Secret used to sign/verify JWTs. Must be ≥ 32 chars in production. |
| `PORT` | No | `3001` | HTTP port the server listens on. |
| `DATABASE_PATH` | No | `./blink.db` | Path to the SQLite database file. |
| `CLIENT_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin for the web client. |

### Web client (`apps/web-client`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001` | Base URL of the server. Set in a `.env.local` file inside `apps/web-client/`. |

---

## Scripts reference

Run from the **repo root** unless otherwise noted.

| Command | What it does |
|---|---|
| `npm install` | Install all workspace dependencies |
| `npm run build:crypto` | Compile `packages/crypto` TypeScript → `dist/` |
| `npm run dev:server` | Start server with `--watch` (auto-restart on changes) |
| `npm run dev:client` | Start Vite dev server for the web client |
| `cd packages/crypto && npm run build` | Same as `build:crypto` but run from the package dir |
| `cd apps/web-client && npx vite build` | Production build of the web client |

---

## API reference

All endpoints (except `/health`) return JSON. Authenticated routes require the header:

```
Authorization: Bearer <token>
```

Tokens are returned by `/api/auth/register` and `/api/auth/login` and expire after **30 days** (auto-refreshed on app open).

---

### Authentication

#### `GET /api/auth/pow-challenge`

Get a Proof-of-Work challenge for registration. Must be solved before the registration request.

**Response `200`:**
```json
{
  "challenge": "<random-hex-string>",
  "difficulty": 18
}
```

The client must find a `nonce` such that `SHA-256(challenge + nonce)` has at least `difficulty` leading zero bits. Challenges expire after 5 minutes and can only be used once.

---

#### `POST /api/auth/register`

Register a new user. Requires a solved PoW challenge and ToS acceptance.

**Request body:**
```json
{
  "username": "alice",
  "password": "hunter2hunter",
  "powChallenge": "<challenge from /pow-challenge>",
  "powNonce": 12345,
  "acceptedTerms": true
}
```
- `username`: 3–32 characters, alphanumeric + underscores only
- `password`: minimum 8 characters
- `powChallenge`: the challenge string from `/api/auth/pow-challenge`
- `powNonce`: the nonce that solves the PoW puzzle
- `acceptedTerms`: must be `true`

**Response `201`:**
```json
{
  "token": "<jwt>",
  "user": { "id": "<uuid>", "username": "alice" }
}
```

---

#### `POST /api/auth/login`

Log in with an existing account.

**Request body:**
```json
{ "username": "alice", "password": "hunter2hunter" }
```

**Response `200`:**
```json
{
  "token": "<jwt>",
  "user": { "id": "<uuid>", "username": "alice" }
}
```

---

### Devices

#### `POST /api/devices` 🔒

Register a new device with its cryptographic public keys.

**Request body:**
```json
{
  "identityPublicKey": { "kty": "EC", "crv": "P-256", … },
  "ecdhPublicKey":     { "kty": "EC", "crv": "P-256", … },
  "deviceName": "Firefox on macOS"
}
```

**Response `201`:**
```json
{ "device": { "id": "<uuid>", "userId": "<uuid>", "deviceName": "Firefox on macOS" } }
```

---

#### `GET /api/devices/:userId` 🔒

Get all registered devices for a user.

**Response `200`:**
```json
{
  "devices": [
    {
      "id": "<uuid>",
      "userId": "<uuid>",
      "deviceName": "Firefox on macOS",
      "identityPublicKey": { … },
      "ecdhPublicKey": { … },
      "createdAt": 1234567890
    }
  ]
}
```

---

### Conversations

#### `GET /api/conversations` 🔒

List all conversations the current user belongs to.

**Response `200`:**
```json
{
  "conversations": [
    {
      "id": "<uuid>",
      "type": "direct_message",
      "name": null,
      "participant_usernames": "alice,bob",
      "participant_ids": "<uuid>,<uuid>",
      "created_at": 1234567890
    }
  ]
}
```

---

#### `POST /api/conversations` 🔒

Create a new conversation.

**Request body:**
```json
{
  "type": "direct_message",
  "participants": ["<bob-user-uuid>"]
}
```
- `type`: `"direct_message"` | `"group_chat"`
- `participants`: array of user UUIDs to invite (the creator is automatically included)
- `name` (optional, group chats only): string up to 64 chars

**Response `201`:**
```json
{ "conversation": { "id": "<uuid>", "type": "direct_message", "name": null, "created_at": 1234567890 } }
```

---

#### `GET /api/conversations/:id/messages` 🔒

Fetch the last 200 messages in a conversation. Returns encrypted payloads — decryption happens in the client.

**Response `200`:**
```json
{
  "messages": [
    {
      "id": "<uuid>",
      "conversationId": "<uuid>",
      "senderId": "<uuid>",
      "timestamp": 1700000000000,
      "payload": {
        "ciphertext": "<base64>",
        "iv": "<base64>",
        "version": "v1"
      }
    }
  ]
}
```

---

#### `GET /api/conversations/:id/participants` 🔒

List participants in a conversation.

---

### Key exchange

#### `GET /api/keys/exchange/:conversationId` 🔒

Retrieve all ephemeral public keys submitted for a conversation (used during key exchange).

---

#### `POST /api/keys/exchange` 🔒

Submit your device's ephemeral ECDH public key for a conversation.

**Request body:**
```json
{
  "conversationId": "<uuid>",
  "deviceId": "<uuid>",
  "ephemeralPublicKey": { "kty": "EC", "crv": "P-256", … }
}
```

---

### Users

#### `GET /api/users/search?q=<query>` 🔒

Search for users by username (partial match, up to 20 results, excludes yourself).

**Response `200`:**
```json
{ "users": [{ "id": "<uuid>", "username": "bob" }] }
```

---

### Account Management

#### `POST /api/auth/refresh` 🔒

Refresh the current JWT token. Returns a new token with a fresh 30-day expiry.

**Response `200`:**
```json
{ "token": "<new-jwt>" }
```

---

#### `PUT /api/auth/password` 🔒

Change the current user's password.

**Request body:**
```json
{ "currentPassword": "old_password", "newPassword": "new_password" }
```

---

#### `DELETE /api/auth/account` 🔒

Delete the current user's account. Soft-deletes the user (sets `deleted_at`).

**Request body:**
```json
{ "password": "current_password", "deleteConversations": false }
```

---

### Media

#### `POST /api/media/upload` 🔒

Upload an encrypted media file. Uses `multipart/form-data`.

**Form fields:**
- `file`: the encrypted binary data
- `conversationId`: UUID of the conversation
- `iv`: base64-encoded IV used for encryption

**Response `201`:**
```json
{ "mediaId": "<uuid>", "fileSize": 1234567 }
```

---

#### `GET /api/media/:id` 🔒

Download an encrypted media file. Returns the raw binary data with metadata headers.

**Response headers:**
- `X-Media-IV`: base64-encoded IV
- `X-Media-Version`: encryption version (e.g. `v1`)

---

### Reports

#### `POST /api/reports` 🔒

Report a user for abuse.

**Request body:**
```json
{
  "reportedUserId": "<uuid>",
  "reason": "spam",
  "conversationId": "<uuid>",
  "messageId": "<uuid>",
  "details": "Optional additional context"
}
```
- `reason`: one of `spam`, `harassment`, `illegal_content`, `other`
- `conversationId`, `messageId`, `details`: optional context

---

### Admin (requires admin privileges)

All admin endpoints require `is_admin = 1` on the authenticated user.

#### `GET /api/admin/verify` 🔒🛡️

Check if the current user is an admin.

**Response `200`:** `{ "admin": true }`  
**Response `403`:** Not an admin.

---

#### `GET /api/admin/stats` 🔒🛡️

Platform statistics.

**Response `200`:**
```json
{
  "totalUsers": 42,
  "totalConversations": 15,
  "totalMessages": 1337,
  "totalReports": 3,
  "pendingReports": 1
}
```

---

#### `GET /api/admin/users?search=&filter=&page=&limit=` 🔒🛡️

Paginated user list with search and filter.

- `filter`: `all` | `active` | `banned` | `deleted`

---

#### `GET /api/admin/reports?status=&page=&limit=` 🔒🛡️

Paginated report list. Filter by `status`: `pending` | `reviewed` | `dismissed`.

---

#### `PUT /api/admin/reports/:reportId` 🔒🛡️

Update report status.

**Request body:**
```json
{ "status": "reviewed" }
```

---

#### `POST /api/admin/ban/:userId` 🔒🛡️

Ban a user. Immediately blocks all API and WebSocket access.

---

#### `POST /api/admin/unban/:userId` 🔒🛡️

Unban a user.

---

### Health

#### `GET /health`

```json
{ "status": "ok" }
```

---

## WebSocket events

Connect with a valid JWT in the auth handshake:

```javascript
import { io } from 'socket.io-client';
const socket = io('http://localhost:3001', { auth: { token: '<jwt>' } });
```

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `join_conversation` | `{ conversationId }` | Subscribe to a conversation room to receive messages |
| `leave_conversation` | `{ conversationId }` | Unsubscribe from a conversation room |
| `send_message` | `EncryptedMessage` (see below) | Send an encrypted message; server validates, persists, and relays |
| `edit_message` | `{ conversationId, messageId, payload }` | Edit a sent message (re-encrypted payload); server verifies ownership |
| `delete_message` | `{ conversationId, messageId, mode }` | Delete a message. `mode`: `"for_me"` or `"for_everyone"` (sender only) |
| `key_exchange` | `KeyExchangePayload` | Relay an ephemeral public key to other participants |
| `key_confirm` | `KeyConfirmPayload` | Confirm key exchange completion to peers |

**`EncryptedMessage` shape** (what you send to `send_message`):
```json
{
  "id": "<uuid>",
  "conversationId": "<uuid>",
  "senderId": "<uuid>",
  "timestamp": 1700000000000,
  "payload": {
    "ciphertext": "<base64>",
    "iv": "<base64>",
    "version": "v1"
  }
}
```
> `senderId` in the server-stored message is always overridden from the authenticated socket user — the client-provided value is ignored.

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `message` | `EncryptedMessage` | A new encrypted message was relayed to this conversation room |
| `message_edited` | `{ conversationId, messageId, payload, editedAt }` | A message was edited by its sender |
| `message_deleted` | `{ conversationId, messageId, deletedBy }` | A message was deleted for everyone |
| `key_exchange` | `KeyExchangePayload` | A peer's ephemeral public key arrived |
| `key_confirm` | `KeyConfirmPayload` | A peer confirmed key exchange |
| `user_connected` | `{ userId, username }` | A user connected |
| `user_disconnected` | `{ userId, username }` | A user disconnected |
| `error` | `{ message }` | A server-side error (e.g., not a participant, rate limited) |

---

## Manual testing walkthrough

### Test the REST API with curl

> **Note:** Registration now requires a Proof-of-Work solution and ToS acceptance. For quick API testing, you can temporarily comment out the PoW check in `apps/server/routes/auth.js`, or use the web client which handles PoW automatically.

```bash
# 1. Get a PoW challenge
curl -s http://localhost:3001/api/auth/pow-challenge | jq .
# Returns: { "challenge": "...", "difficulty": 18 }

# 2. Register Alice (via web client is easiest — PoW is solved automatically)
#    Or temporarily disable PoW in routes/auth.js for curl testing.

# 3. Login (no PoW required)
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alicepass1"}' | jq .

# Save the token
ALICE_TOKEN="<token from above>"
ALICE_ID="<id from above>"

# 4. Create a direct message conversation (as Alice)
curl -s -X POST http://localhost:3001/api/conversations \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d "{\"type\":\"direct_message\",\"participants\":[\"$BOB_ID\"]}" | jq .

CONV_ID="<id from above>"

# 5. Check health
curl -s http://localhost:3001/health

# 6. Promote Alice to admin (from server shell)
cd apps/server
node admin-cli.js promote alice
```

### Test the crypto engine from Node.js

```bash
node - <<'EOF'
const { CryptoEngine, NodeProvider } = require('./packages/crypto/dist/index.js');
const engine = new CryptoEngine(new NodeProvider());

(async () => {
  // Simulate Alice and Bob exchanging keys and messages
  const alice = await engine.generateECDHKey();
  const bob   = await engine.generateECDHKey();

  const aliceKey = await engine.deriveConversationKeyFromExchange(
    alice.privateKey, bob.publicKey, 'test-conversation-id'
  );
  const bobKey = await engine.deriveConversationKeyFromExchange(
    bob.privateKey, alice.publicKey, 'test-conversation-id'
  );

  const payload   = await engine.encryptMessage(aliceKey, 'Hello Bob! 🔒');
  const plaintext = await engine.decryptMessage(bobKey, payload);

  console.log('Encrypted:', JSON.stringify(payload, null, 2));
  console.log('Decrypted:', plaintext);
  console.log('Keys match:', Buffer.from(aliceKey).equals(Buffer.from(bobKey)));
})();
EOF
```

Expected output:
```
Encrypted: {
  "ciphertext": "<base64>",
  "iv": "<base64>",
  "version": "v1"
}
Decrypted: Hello Bob! 🔒
Keys match: true
```

### Test signing and verification

```bash
node - <<'EOF'
const { CryptoEngine, NodeProvider } = require('./packages/crypto/dist/index.js');
const engine = new CryptoEngine(new NodeProvider());

(async () => {
  const identity  = await engine.generateIdentityKey();
  const signature = await engine.signData(identity.privateKey, 'test payload');
  const valid     = await engine.verifySignature(identity.publicKey, 'test payload', signature);
  console.log('Signature valid:', valid);      // true
  const tampered  = await engine.verifySignature(identity.publicKey, 'tampered!', signature);
  console.log('Tampered valid:', tampered);    // false
})();
EOF
```

### Browser developer tools test

Open the web client at `http://localhost:5173`, open DevTools → Console, and run:

```javascript
// Inspect the stored device keys after login
console.log('Identity key:', JSON.parse(localStorage.getItem('blink-identity-key')));
console.log('ECDH key:',     JSON.parse(localStorage.getItem('blink-ecdh-key')));
console.log('Device ID:',    JSON.parse(localStorage.getItem('blink-device-id')));
```

---

## Running with Docker

> **Note:** The Docker setup requires Dockerfiles that are not included in this repo by default. The instructions below describe the intended setup for deploying a production build.

```bash
# Copy and edit the environment file first
cp apps/server/.env.example .env
# Set a strong JWT_SECRET in .env

docker compose up --build
```

- Server → `http://localhost:3001`
- Client  → `http://localhost:5173`

The database is persisted in a named Docker volume (`db_data`).

---

## Security notes

| Feature | Implementation |
|---|---|
| Password hashing | `bcrypt` with 12 salt rounds |
| Authentication | JWT (HS256), 30-day expiry with auto-refresh |
| Message encryption | AES-256-GCM with a random 12-byte IV per message |
| Key exchange | ECDH P-256 + HKDF-SHA-256 (conversation ID as salt) |
| Identity signing | ECDSA P-256 |
| Anti-spam | Proof-of-Work (SHA-256, difficulty 18) required at registration |
| Transport security | HTTPS/WSS via Cloudflare or reverse proxy (see [deployment guide](#deploying-to-aws-ec2-production)) |
| Security headers | `helmet` (CSP, HSTS, X-Frame-Options, …) |
| REST rate limiting | 20 auth requests / 15 min; 200 general requests / min |
| WebSocket rate limiting | Per-event throttling (messages, key exchange) |
| Input validation | `express-validator` on all endpoints |
| CORS | Restricted to `CLIENT_ORIGIN` environment variable |
| Ban enforcement | Checked on every authenticated API request and WebSocket connection |
| Admin access | CLI-only promotion — no API endpoint can grant admin privileges |
| IP logging | Registration IP stored for abuse investigation (admin-visible only) |
| Terms of Service | Required acceptance at registration; server validates |

**Private keys never leave the client.** The server stores only encrypted message payloads, public keys, and bcrypt hashes.

---

## License

MIT
