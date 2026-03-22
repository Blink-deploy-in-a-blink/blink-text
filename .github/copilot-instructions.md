# Copilot Instructions for AI Coding Agents

## Architecture

**blink-text** is an E2E-encrypted messaging platform. The server is a dumb relay — it never sees private keys, conversation keys, or plaintext.

| Component | Stack | Role |
|---|---|---|
| `apps/server` | Node.js, Express, Socket.io, better-sqlite3 | REST API, JWT auth, WebSocket relay, SQLite storage |
| `apps/web-client` | React (Vite), no router library | All encryption/decryption, hash-based routing in `App.jsx` |
| `packages/crypto` | TypeScript, tsup | Platform-agnostic `CryptoEngine` facade with `BrowserProvider` / `NodeProvider` |
| `packages/shared` | Plain JS | Wire-format validators (`validateEncryptedMessage`, `validateKeyExchange`) |

**Data flow**: Client encrypts (AES-256-GCM) → Socket.io emits ciphertext → Server stores/relays opaque blobs → Recipient decrypts client-side. Key exchange: ECDH P-256 ephemeral keypairs + HKDF-SHA-256 derivation. Group chats use Sender Key protocol (see `groupCrypto.js`).

## Developer Workflows

```bash
npm install                   # from repo root (npm workspaces)
npm run dev:server            # apps/server on :3001 (node --watch)
npm run dev:client            # apps/web-client on :5173 (Vite, proxies /api + /socket.io to :3001)
npm run build:crypto          # required only for Node usage (tsup build); Vite resolves TS source directly
```

- **Windows PowerShell**: use `npm.cmd` instead of `npm` (e.g. `npm.cmd run dev:server`).
- **Environment**: Copy `apps/server/.env.example` → `.env`, set `JWT_SECRET` (≥32 chars). Server exits on startup if missing.
- **No test suite exists** — verify changes by running two browser windows and chatting. See `ISSUES.md` for known flow issues.
- **Admin CLI only** (no API endpoint): `node apps/server/admin-cli.js promote <username>`.

## Server Conventions

- **Route pattern**: One file per resource in `apps/server/routes/`. Each exports an Express `Router`, registered in `app.js` under `/api/<resource>`. All routes (except `/health` and `/api/conversations/join/:slug`) use `authenticateToken` middleware from `auth.js`.
- **Auth**: `auth.js` exports `authenticateToken`, `signToken` (30-day JWT), `signGuestToken` (24h). Single-session enforcement via `session_nonce` column — logging in elsewhere immediately invalidates prior session.
- **Database**: `db.js` is a singleton `better-sqlite3` instance (WAL mode, foreign keys ON). Schema is created inline via `CREATE TABLE IF NOT EXISTS` + safe `ALTER TABLE` migrations that check column existence before adding. **Never use a migration framework** — follow the existing `if (!columns.includes('col'))` pattern.
- **Validation**: All route inputs validated with `express-validator`. WebSocket payloads validated with `@blink-text/shared` validators.
- **Rate limiting**: Global 200 req/min (`app.js`), 20/15min on auth routes, per-user WebSocket limiter (30 events/10s) in `websocket.js`.
- **Disappearing messages**: `expires_at` on messages, `disappear_after` on conversations. A `setInterval` in `websocket.js` cleans expired rows every 30s and emits `messages_expired` / `conversation_expired` events.

## Client Conventions

- **Routing**: Hash-based routing in `App.jsx` (`#/login`, `#/chat/:convId`, `#/r/:slug`, etc.) — no React Router. Use `navigate()` / `navigateReplace()` helpers.
- **State management**: No Redux/Zustand — local React state + custom hooks (`useAuth`, `useMessages`, `useBackgroundPreloader`).
- **Service layer** (`src/services/`): `api.js` (Axios wrapper, auto-attaches JWT from `localStorage`/`sessionStorage`), `socket.js` (Socket.io), `cryptoService.js` (DM encryption), `groupCrypto.js` (group Sender Key encryption), `guestSession.js` (burner room sessions in `sessionStorage`).
- **Crypto rule**: Always use `CryptoEngine` + `BrowserProvider` from `@blink-text/crypto`. Never call `crypto.subtle` directly. Private keys stored in IndexedDB (`blink-crypto` database), never `localStorage`.
- **Vite aliases** (in `vite.config.js`): `@blink-text/crypto` → `packages/crypto/src/index.ts` (source, not dist), `@blink-text/shared` → `packages/shared/src/index.js`. This means changes to `packages/crypto` are picked up without rebuilding during dev.
- **Key lifecycle**: On explicit logout, all crypto keys are wiped (IndexedDB + localStorage). On session expiry (token timeout), only session data is cleared — crypto keys are preserved so old messages remain decryptable on re-login.

## Adding Features — Patterns to Follow

- **New API route**: Create `apps/server/routes/yourroute.js`, export a `Router`, register in `app.js` as `app.use('/api/yourroute', yourRoutes)`.
- **New DB column**: In `db.js`, add a `if (!columns.includes('new_col'))` block after the relevant table's existing migrations.
- **New Socket event**: Add handler in `registerSocketHandlers()` in `websocket.js` (server), export emit function from `socket.js` (client).
- **New client page**: Add component in `src/components/`, add hash route case in `App.jsx`'s `parseHashRoute()` and rendering logic.
- **Extend crypto**: Add method to `CryptoProvider` interface in `packages/crypto/src/types.ts`, implement in both `browser.ts` and `node.ts`, expose via `CryptoEngine` in `engine.ts`.

## Critical Invariants

1. **Server must never see plaintext or private keys.** All encryption happens in the client.
2. **Guest sessions** use `sessionStorage` (ephemeral by design) and have relaxed FK constraints — `conversation_participants.user_id` and `messages.sender_id` no longer reference `users(id)`.
3. **PoW anti-spam**: Registration requires solving a SHA-256 proof-of-work challenge (difficulty 18). Challenge issued by `GET /api/auth/pow-challenge`, solved in `pow-worker.js` (Web Worker).
4. **No formal test suite** — the project relies on manual two-browser testing. `ISSUES.md` documents known bugs and their fixes.
