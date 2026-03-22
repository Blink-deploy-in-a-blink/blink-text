<h1 align="center">Cypher</h1>

<p align="center">
  <strong>Open-source, end-to-end encrypted messaging.</strong><br>
  The server is a dumb relay — it never sees your private keys, conversation keys, or plaintext messages.
</p>

<p align="center">
  <a href="https://cypher.opsenq.com">Live Demo</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#deploying-to-aws-ec2">Deploy</a> ·
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js" />
  <img src="https://img.shields.io/badge/encryption-AES--256--GCM-blueviolet.svg" alt="Encryption" />
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome" />
</p>

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

**Key exchange** happens once per conversation using ECDH P-256. Each device generates an ephemeral keypair, shares the public half via the server, and derives a shared `AES-256-GCM` key locally using HKDF-SHA-256. The server never touches the private keys or the derived shared key.

---

## Features

| Category | Features |
|---|---|
| **Encryption** | AES-256-GCM messages, ECDH P-256 key exchange, HKDF-SHA-256 key derivation, ECDSA P-256 identity signing |
| **Messaging** | Real-time delivery, edit, delete (for me / for everyone), reply-to, forwarding |
| **Media** | Client-side encrypted file/image upload, full-screen preview, download |
| **Groups** | Encrypted group chats with sender-key distribution |
| **Guest rooms** | Shareable invite links — join without an account |
| **Trust & Safety** | PoW anti-spam at registration, user reporting, admin moderation panel |
| **Accounts** | Password change, account deletion, 30-day JWT with auto-refresh |
| **Admin** | CLI-only promotion (no API endpoint), ban/unban, report review queue |

---

## Architecture

```
apps/
  server/          Node.js · Express · Socket.io · SQLite
  web-client/      React · Vite

packages/
  crypto/          Standalone TypeScript crypto engine (browser + Node providers)
  shared/          Wire-format schemas & validation helpers
```

### Database schema

| Table | Purpose |
|---|---|
| `users` | Username, bcrypt hash, admin/banned flags, registration IP, soft-delete |
| `devices` | Per-device ECDSA identity key + ECDH public key |
| `conversations` | `direct_message` or `group_chat` |
| `conversation_participants` | Many-to-many user ↔ conversation |
| `messages` | Encrypted payloads only (`ciphertext`, `iv`, `version`) |
| `message_deletions` | Per-user "delete for me" soft deletes |
| `key_exchange_data` | Ephemeral ECDH public keys for conversation bootstrap |
| `media` | Metadata for encrypted media uploads |
| `reports` | User reports with reason, linked message/conversation |

---

## Prerequisites

| Tool | Minimum |
|---|---|
| Node.js | 18 (20+ recommended) |
| npm | 9 (workspaces required) |

No database server needed — SQLite is embedded.

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Blink-deploy-in-a-blink/blink-text.git
cd blink-text
npm install
```

### 2. Configure the server

```bash
cp apps/server/.env.example apps/server/.env
```

Edit `apps/server/.env`:

```env
JWT_SECRET=replace-with-a-long-random-string-at-least-32-chars
PORT=3001
DATABASE_PATH=./blink.db
```

### 3. Start

```bash
# Terminal 1 — server
npm run dev:server

# Terminal 2 — web client
npm run dev:client
```

Open `http://localhost:5173` in two browser windows, register two users, and start chatting.

---

## Admin Setup

There is **no API endpoint** to grant admin access — only the server operator with shell access can promote users. This prevents privilege escalation via the API.

```bash
cd apps/server

# Promote
node admin-cli.js promote <username>

# Demote
node admin-cli.js demote <username>

# List admins
node admin-cli.js list
```

Once promoted, an **⚙ Admin** button appears in the sidebar with platform stats, user management, and a report review queue.

---

## Deploying to AWS EC2

### Architecture

```
Browser ──HTTPS──► Cloudflare ──HTTP──► nginx:80 ──► node:3001
                   (TLS termination)    (reverse proxy)
```

### Steps

**1. Install dependencies**

```bash
# Node.js 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs nginx

# PM2 process manager
sudo npm install -g pm2
```

**2. Deploy the app**

```bash
git clone https://github.com/Blink-deploy-in-a-blink/blink-text.git
cd blink-text
npm install

# Build the web client
cd apps/web-client && npm run build && cd ../..

# Configure environment
cp apps/server/.env.example apps/server/.env
# Set JWT_SECRET, PORT=3001, CLIENT_ORIGIN=https://yourdomain.com
```

**3. Configure nginx**

```bash
sudo cp nginx.conf /etc/nginx/conf.d/blink.conf
# Edit server_name to your domain
sudo nginx -t && sudo systemctl enable --now nginx
```

**4. Start with PM2**

```bash
cd apps/server
pm2 start app.js --name blink-server
pm2 save
pm2 startup  # follow the printed command
```

**5. Cloudflare DNS**

- Create an `A` record → your EC2 IP, proxy **enabled** (orange cloud)
- SSL/TLS mode → **Flexible**

### Updating

```bash
cd ~/blink-text
git pull
cd apps/web-client && npm run build && cd ../..
pm2 restart blink-server
```

---

## Running with Docker

```bash
cp .env.docker.example .env
# Edit .env — set JWT_SECRET

docker compose up --build -d
```

Open `http://localhost`. Admin CLI via Docker:

```bash
docker compose exec app node apps/server/admin-cli.js promote <username>
```

### Docker environment variables

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | — | **Required.** ≥ 32 chars. |
| `CLIENT_ORIGIN` | `http://localhost` | Allowed CORS origin. |
| `HTTP_PORT` | `80` | Host port nginx listens on. |
| `ALLOW_LAN` | `false` | Allow CORS from LAN IPs. |
| `MAX_STORAGE_PER_USER` | `524288000` | Per-user media quota (bytes). |

---

## Maintenance Mode

To put the app into maintenance mode without a redeployment, set the environment variable before building:

```bash
# apps/web-client/.env.local
VITE_MAINTENANCE_MODE=true
```

Then rebuild the client — all visitors will see the maintenance page instead of the app.

---

## Environment Variables

### Server (`apps/server/.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **Yes** | `change-me-in-production` | JWT signing secret (≥ 32 chars). |
| `PORT` | No | `3001` | HTTP port. |
| `DATABASE_PATH` | No | `./blink.db` | SQLite file path. |
| `CLIENT_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin. |
| `ALLOW_LAN` | No | `false` | Allow private-network CORS origins. |

### Web client (`apps/web-client/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001` | Server base URL. |
| `VITE_MAINTENANCE_MODE` | `false` | Show maintenance page when `true`. |

---

## Security

| Feature | Implementation |
|---|---|
| Password hashing | `bcrypt` — 12 salt rounds |
| Authentication | JWT HS256, 30-day expiry with auto-refresh |
| Message encryption | AES-256-GCM, random 12-byte IV per message |
| Key exchange | ECDH P-256 + HKDF-SHA-256 |
| Identity signing | ECDSA P-256 |
| Anti-spam | Proof-of-Work (SHA-256, difficulty 18) at registration |
| Transport | HTTPS/WSS via Cloudflare or reverse proxy |
| Security headers | `helmet` (CSP, HSTS, X-Frame-Options, …) |
| Rate limiting | 20 auth req/15 min · 200 general req/min · per-event WebSocket limits |
| Input validation | `express-validator` on all endpoints |
| Ban enforcement | Checked on every authenticated request and WebSocket connection |
| Admin access | CLI-only — no API endpoint can grant admin privileges |

**Private keys never leave the client.** The server stores only encrypted payloads, public keys, and bcrypt hashes.

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository and create a feature branch:
   ```bash
   git checkout -b feat/your-feature
   ```
2. **Make your changes** — keep PRs focused and small.
3. **Test** manually using two browser windows (see [Quick Start](#quick-start)).
4. **Open a pull request** against `main` with a clear description of what and why.

For significant changes, open an issue first to discuss the approach.

### Project structure

```
apps/server/routes/      REST API route handlers
apps/server/websocket.js Socket.io event handlers
apps/web-client/src/
  components/            React UI components
  hooks/                 useAuth, useMessages, useBackgroundPreloader
  services/              API client, crypto, socket, cache
packages/crypto/src/     Platform-agnostic crypto engine (TypeScript)
packages/shared/src/     Wire-format validation
```

---

## License

[MIT](LICENSE) © [Blink-deploy-in-a-blink](https://github.com/Blink-deploy-in-a-blink)
