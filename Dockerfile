# ──────────────────────────────────────────────────────────────────────
# Stage 1 — builder
# Install ALL deps (dev + prod), build crypto package, build web client.
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# better-sqlite3 is a native C++ addon — needs build tools
RUN apk add --no-cache python3 make g++

WORKDIR /build

# 1. Copy workspace root + package manifests first (cache-friendly layer)
COPY package.json package-lock.json* ./
COPY apps/server/package.json          apps/server/
COPY apps/web-client/package.json      apps/web-client/
COPY packages/crypto/package.json      packages/crypto/
COPY packages/shared/package.json      packages/shared/

# 2. Install all workspace dependencies (dev + prod, we need Vite + tsup here)
RUN npm ci

# 3. Copy the rest of the source tree
COPY packages/ packages/
COPY apps/     apps/

# 4. Build the crypto package (TypeScript → dist/)
RUN npm run build:crypto

# 5. Build the web client (Vite → apps/web-client/dist/)
RUN cd apps/web-client && npx vite build

# 6. Prune dev dependencies so only production deps remain
RUN npm prune --production


# ──────────────────────────────────────────────────────────────────────
# Stage 2 — production
# Slim image with only the runtime bits.
# ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# better-sqlite3 needs libstdc++ at runtime
RUN apk add --no-cache libstdc++

WORKDIR /app

# Copy production node_modules (already pruned in builder)
COPY --from=builder /build/node_modules       ./node_modules

# Copy workspace package.json (npm workspaces need it to resolve packages)
COPY --from=builder /build/package.json        ./package.json

# Copy server application code
COPY --from=builder /build/apps/server         ./apps/server

# Copy built web client (static HTML/JS/CSS served by Express in production)
COPY --from=builder /build/apps/web-client/dist ./apps/web-client/dist

# Copy shared package (runtime dependency of the server)
COPY --from=builder /build/packages/shared     ./packages/shared

# Copy crypto package dist (in case server or shared imports it at runtime)
COPY --from=builder /build/packages/crypto/package.json ./packages/crypto/package.json
COPY --from=builder /build/packages/crypto/dist         ./packages/crypto/dist

# Create directories for persistent data
RUN mkdir -p /data /app/apps/server/uploads

# Default environment — can be overridden in docker-compose.yml or .env
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_PATH=/data/blink.db \
    TRUST_PROXY=1

EXPOSE 3001

# Health check — uses the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "apps/server/app.js"]
