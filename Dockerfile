# ==============================================================================
# 1. Build Stage: Frontend Web PWA
# ==============================================================================
FROM node:22-bookworm-slim AS web-builder
WORKDIR /app

COPY package*.json ./
COPY web/package*.json ./web/
COPY server/package*.json ./server/
RUN npm ci

COPY web/ ./web/
RUN npm run build --workspace=web

# ==============================================================================
# 2. Build Stage: Server TypeScript compilation
# ==============================================================================
FROM node:22-bookworm-slim AS server-builder
WORKDIR /app

# Install build tools for native addons (better-sqlite3, argon2)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY web/package*.json ./web/
COPY server/package*.json ./server/
RUN npm ci

COPY server/ ./server/
RUN npm run build --workspace=server

# Install production-only dependencies for runner
WORKDIR /app/server
RUN npm prune --production

# ==============================================================================
# 3. Final Production Runner
# ==============================================================================
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Install runtime dependencies: ffmpeg for MMS video compression & ca-certificates
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    PUBLIC_DIR=/app/public

# Create data directory for SQLite DB, encryption keys, and MMS media
RUN mkdir -p /data/media && chmod 700 /data

# Copy built server and node_modules
COPY --from=server-builder /app/server/dist /app/dist
COPY --from=server-builder /app/node_modules /app/node_modules
COPY --from=server-builder /app/server/package.json /app/package.json

# Copy compiled frontend PWA into static asset location
COPY --from=web-builder /app/web/dist /app/public

EXPOSE 8080

VOLUME ["/data"]

CMD ["node", "dist/index.js"]
