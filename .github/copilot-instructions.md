# Copilot Instructions for AI Coding Agents

## Project Overview
- **blink-text** is a privacy-focused, end-to-end encrypted messaging platform.
- The server acts as a dumb relay: it never sees private keys, conversation keys, or plaintext messages.
- Major components:
  - `apps/server`: Node.js (Express, Socket.io, SQLite) — API, authentication, WebSocket relay
  - `apps/web-client`: React (Vite) — browser client, handles all encryption/decryption
  - `packages/crypto`: TypeScript crypto engine, platform-agnostic (browser & Node providers)
  - `packages/shared`: Wire-format schemas and validation helpers

## Key Architectural Patterns
- **End-to-end encryption**: All encryption/decryption is handled client-side (`cryptoService.js` in web-client, `packages/crypto`).
- **Key exchange**: ECDH P-256, ephemeral per device, with HKDF-SHA-256 for key derivation. Server only relays public keys.
- **Database**: SQLite, with tables for users, devices, conversations, messages, and key exchange data. See `db.js` and README for schema.
- **API**: REST endpoints for auth, users, conversations, devices, keys. All authenticated routes require JWT in `Authorization` header.
- **WebSocket**: Real-time message delivery via Socket.io. Server never sees decrypted content.

## Developer Workflows
- **Install dependencies**: `npm install` (from repo root, uses npm workspaces)
- **Build crypto package**: `npm run build:crypto` (required for Node usage)
- **Start server**: `npm run dev:server` (or `cd apps/server && node --watch app.js`)
- **Start client**: `npm run dev:client` (or `cd apps/web-client && npx vite`)
- **Environment**: Copy `apps/server/.env.example` to `.env` and set `JWT_SECRET`
- **Production build (client)**: `cd apps/web-client && npx vite build`
- **Windows note**: Use `npm.cmd` instead of `npm` when running commands in PowerShell terminals (e.g. `npm.cmd run dev:server`).

## Project-Specific Conventions
- **Never commit secrets**: `.env` is gitignored. Always set a strong `JWT_SECRET`.
- **Crypto engine**: All app code must use the `CryptoEngine` facade, not raw crypto APIs.
- **Web client**: Uses Vite aliases to resolve `packages/crypto` source directly.
- **API tokens**: JWTs expire after 24h. All API calls (except `/health`) require `Authorization: Bearer <token>`.
- **Component structure**: Web client components are in `src/components/`, hooks in `src/hooks/`, and services in `src/services/`.

## Integration Points
- **Socket.io**: Used for real-time messaging between client and server. See `websocket.js` (server) and `socket.js` (client).
- **REST API**: See `apps/server/routes/` for endpoints. Use `api.js` in the client for calls.
- **Crypto**: `packages/crypto` is used by both client and (potentially) server-side tools.

## Examples
- To add a new API route: create a file in `apps/server/routes/`, register it in `app.js`.
- To add a new client feature: add a component in `apps/web-client/src/components/`, hook up to services/hooks as needed.
- To extend crypto: implement a new provider in `packages/crypto/src/provider/` and update `engine.ts`.

## References
- See `README.md` for detailed architecture, workflows, and API reference.
- Key files: `apps/server/app.js`, `apps/web-client/src/services/cryptoService.js`, `packages/crypto/src/engine.ts`, `apps/server/db.js`.

---

For any unclear or missing conventions, consult the README or ask for clarification from maintainers.
