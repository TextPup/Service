# ==============================================================================
# 1. Base Stage: Install build tools and compile dependencies (better-sqlite3, argon2)
# ==============================================================================
FROM node:22-bookworm-slim AS build-base
WORKDIR /app

# Install build tools for native addons
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY web/package*.json ./web/
COPY server/package*.json ./server/
RUN npm ci

# ==============================================================================
# 2. Build Stage: Frontend Web PWA
# ==============================================================================
FROM build-base AS web-builder
COPY web/ ./web/
RUN npm run build --workspace=web

# ==============================================================================
# 3. Build Stage: Server TypeScript compilation
# ==============================================================================
FROM build-base AS server-builder
COPY server/ ./server/
RUN npm run build --workspace=server

# ==============================================================================
# 4. Production Dependencies: Clean production node_modules
# ==============================================================================
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY web/package*.json ./web/
COPY server/package*.json ./server/
RUN npm ci --omit=dev

# ==============================================================================
# 5. Final Production Runner
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

# Copy production node_modules from prod-deps
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=server-builder /app/server/dist /app/dist
COPY --from=server-builder /app/server/package.json /app/package.json

# Copy compiled frontend PWA into static asset location
COPY --from=web-builder /app/web/dist /app/public

EXPOSE 8080

VOLUME ["/data"]

CMD ["node", "dist/index.js"]
