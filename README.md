# blink-text

> **Privacy-focused, end-to-end encrypted messaging.**  
> The server is a dumb relay — it never sees your private keys, conversation keys, or plaintext messages.

---

## Table of Contents

1. [How it works](#how-it-works)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Repo structure](#repo-structure)
5. [Quick start — local development](#quick-start--local-development)
6. [Environment variables](#environment-variables)
7. [Scripts reference](#scripts-reference)
8. [API reference](#api-reference)
9. [WebSocket events](#websocket-events)
10. [Manual testing walkthrough](#manual-testing-walkthrough)
11. [Running with Docker](#running-with-docker)
12. [Security notes](#security-notes)

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
| `users` | Username + bcrypt password hash |
| `devices` | Per-device ECDSA identity key + ECDH public key |
| `conversations` | `direct_message` or `group_chat` |
| `conversation_participants` | Many-to-many user ↔ conversation |
| `messages` | Encrypted payloads only (`ciphertext`, `iv`, `version`) |
| `key_exchange_data` | Ephemeral ECDH public keys used to bootstrap conversation keys |

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
│   │   ├── websocket.js        Socket.io handlers
│   │   ├── routes/
│   │   │   ├── auth.js         POST /api/auth/register|login
│   │   │   ├── conversations.js GET/POST /api/conversations
│   │   │   ├── devices.js      GET/POST /api/devices
│   │   │   ├── keys.js         GET/POST /api/keys/exchange
│   │   │   └── users.js        GET /api/users/search
│   │   └── .env.example
│   └── web-client/
│       ├── src/
│       │   ├── App.jsx
│       │   ├── components/     Login, Register, ChatWindow, ConversationList, …
│       │   ├── hooks/          useAuth, useMessages
│       │   └── services/
│       │       ├── api.js      Axios REST calls
│       │       ├── socket.js   Socket.io client
│       │       └── cryptoService.js  Browser-side E2E crypto
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

Tokens are returned by `/api/auth/register` and `/api/auth/login` and expire after **24 hours**.

---

### Authentication

#### `POST /api/auth/register`

Register a new user.

**Request body:**
```json
{ "username": "alice", "password": "hunter2hunter" }
```
- `username`: 3–32 characters, alphanumeric + underscores only
- `password`: minimum 8 characters

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
| `send_message` | `EncryptedMessage` (see below) | Send an encrypted message; server validates, persists, and relays |
| `key_exchange` | `KeyExchangePayload` | Relay an ephemeral public key to other participants |

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
| `key_exchange` | `KeyExchangePayload` | A peer's ephemeral public key arrived |
| `user_connected` | `{ userId, username }` | A user connected |
| `user_disconnected` | `{ userId, username }` | A user disconnected |
| `error` | `{ message }` | A server-side error (e.g., not a participant) |

---

## Manual testing walkthrough

### Test the REST API with curl

```bash
# 1. Register Alice
curl -s -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alicepass1"}' | jq .

# Save the token
ALICE_TOKEN="<token from above>"
ALICE_ID="<id from above>"

# 2. Register Bob
curl -s -X POST http://localhost:3001/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"bob","password":"bobpassword1"}' | jq .

BOB_TOKEN="<token from above>"
BOB_ID="<id from above>"

# 3. Create a direct message conversation (as Alice)
curl -s -X POST http://localhost:3001/api/conversations \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -d "{\"type\":\"direct_message\",\"participants\":[\"$BOB_ID\"]}" | jq .

CONV_ID="<id from above>"

# 4. Check health
curl -s http://localhost:3001/health
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
| Authentication | JWT (HS256), 24-hour expiry |
| Message encryption | AES-256-GCM with a random 12-byte IV per message |
| Key exchange | ECDH P-256 + HKDF-SHA-256 (conversation ID as salt) |
| Identity signing | ECDSA P-256 |
| Transport security | HTTPS/WSS in production (not configured here — add a reverse proxy) |
| Security headers | `helmet` (CSP, HSTS, X-Frame-Options, …) |
| Rate limiting | 20 auth requests / 15 min; 200 general requests / min |
| Input validation | `express-validator` on all endpoints |
| CORS | Restricted to `CLIENT_ORIGIN` environment variable |

**Private keys never leave the client.** The server stores only encrypted message payloads, public keys, and bcrypt hashes.

---

## License

MIT
