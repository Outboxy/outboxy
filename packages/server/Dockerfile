# Outboxy Unified Docker Image
# Build context: repo root (.), Dockerfile location: packages/server/Dockerfile
# Usage: docker build -t outboxy -f packages/server/Dockerfile . && docker run outboxy api | worker | migrate | help

# =============================================================================
# Stage 1: Base image with pnpm
# =============================================================================
FROM node:22-alpine AS base

LABEL org.opencontainers.image.title="Outboxy"
LABEL org.opencontainers.image.description="Transactional Outbox Pattern as a Service"
LABEL org.opencontainers.image.source="https://github.com/outboxy/outboxy"
LABEL org.opencontainers.image.licenses="MIT"

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# =============================================================================
# Stage 2: Install all dependencies (for building)
# =============================================================================
FROM base AS deps

# Copy workspace files from root (build context is repo root)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy package.json for all runtime packages
COPY packages/logging/package.json ./packages/logging/
COPY packages/migrations/package.json ./packages/migrations/
COPY packages/db-adapter-core/package.json ./packages/db-adapter-core/
COPY packages/db-adapter-postgres/package.json ./packages/db-adapter-postgres/
COPY packages/db-adapter-mysql/package.json ./packages/db-adapter-mysql/
COPY packages/publisher-core/package.json ./packages/publisher-core/
COPY packages/publisher-http/package.json ./packages/publisher-http/
COPY packages/publisher-kafka/package.json ./packages/publisher-kafka/
COPY packages/schema/package.json ./packages/schema/
COPY packages/api/package.json ./packages/api/
COPY packages/worker/package.json ./packages/worker/
COPY packages/tracing/package.json ./packages/tracing/
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile

# =============================================================================
# Stage 3: Build all packages
# =============================================================================
FROM deps AS builder

# Copy root tsconfig
COPY tsconfig.json ./

# Copy source code for all runtime packages
COPY packages/logging ./packages/logging
COPY packages/migrations ./packages/migrations
COPY packages/db-adapter-core ./packages/db-adapter-core
COPY packages/db-adapter-postgres ./packages/db-adapter-postgres
COPY packages/db-adapter-mysql ./packages/db-adapter-mysql
COPY packages/publisher-core ./packages/publisher-core
COPY packages/publisher-http ./packages/publisher-http
COPY packages/publisher-kafka ./packages/publisher-kafka
COPY packages/schema ./packages/schema
COPY packages/api ./packages/api
COPY packages/worker ./packages/worker
COPY packages/tracing ./packages/tracing
COPY packages/server ./packages/server

# Build in dependency order
RUN pnpm --filter @outboxy/logging build && \
    pnpm --filter @outboxy/schema build && \
    pnpm --filter @outboxy/migrations build && \
    pnpm --filter @outboxy/db-adapter-core build && \
    pnpm --filter @outboxy/publisher-core build && \
    pnpm --filter @outboxy/tracing build && \
    pnpm --filter @outboxy/db-adapter-postgres build && \
    pnpm --filter @outboxy/db-adapter-mysql build && \
    pnpm --filter @outboxy/publisher-http build && \
    pnpm --filter @outboxy/publisher-kafka build && \
    pnpm --filter @outboxy/api build && \
    pnpm --filter @outboxy/worker build && \
    pnpm --filter @outboxy/server build

# =============================================================================
# Stage 4: Production dependencies only
# =============================================================================
FROM base AS prod-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

COPY packages/logging/package.json ./packages/logging/
COPY packages/migrations/package.json ./packages/migrations/
COPY packages/db-adapter-core/package.json ./packages/db-adapter-core/
COPY packages/db-adapter-postgres/package.json ./packages/db-adapter-postgres/
COPY packages/db-adapter-mysql/package.json ./packages/db-adapter-mysql/
COPY packages/publisher-core/package.json ./packages/publisher-core/
COPY packages/publisher-http/package.json ./packages/publisher-http/
COPY packages/publisher-kafka/package.json ./packages/publisher-kafka/
COPY packages/schema/package.json ./packages/schema/
COPY packages/api/package.json ./packages/api/
COPY packages/worker/package.json ./packages/worker/
COPY packages/tracing/package.json ./packages/tracing/
COPY packages/server/package.json ./packages/server/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# =============================================================================
# Stage 5: Production image
# =============================================================================
FROM node:22-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S outboxy && \
    adduser -S outboxy -u 1001 -G outboxy

# Copy workspace configuration
COPY --chown=outboxy:outboxy package.json pnpm-workspace.yaml ./

# Copy production node_modules (root level)
COPY --chown=outboxy:outboxy --from=prod-deps /app/node_modules ./node_modules

# Copy each package: package.json + dist + node_modules
# Logging
COPY --chown=outboxy:outboxy packages/logging/package.json ./packages/logging/
COPY --chown=outboxy:outboxy --from=builder /app/packages/logging/dist ./packages/logging/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/logging/node_modules ./packages/logging/node_modules

# Migrations (includes drizzle folder in dist)
COPY --chown=outboxy:outboxy packages/migrations/package.json ./packages/migrations/
COPY --chown=outboxy:outboxy --from=builder /app/packages/migrations/dist ./packages/migrations/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/migrations/node_modules ./packages/migrations/node_modules

# DB Adapter Core
COPY --chown=outboxy:outboxy packages/db-adapter-core/package.json ./packages/db-adapter-core/
COPY --chown=outboxy:outboxy --from=builder /app/packages/db-adapter-core/dist ./packages/db-adapter-core/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/db-adapter-core/node_modules ./packages/db-adapter-core/node_modules

# DB Adapter Postgres
COPY --chown=outboxy:outboxy packages/db-adapter-postgres/package.json ./packages/db-adapter-postgres/
COPY --chown=outboxy:outboxy --from=builder /app/packages/db-adapter-postgres/dist ./packages/db-adapter-postgres/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/db-adapter-postgres/node_modules ./packages/db-adapter-postgres/node_modules

# DB Adapter MySQL
COPY --chown=outboxy:outboxy packages/db-adapter-mysql/package.json ./packages/db-adapter-mysql/
COPY --chown=outboxy:outboxy --from=builder /app/packages/db-adapter-mysql/dist ./packages/db-adapter-mysql/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/db-adapter-mysql/node_modules ./packages/db-adapter-mysql/node_modules

# Schema
COPY --chown=outboxy:outboxy packages/schema/package.json ./packages/schema/
COPY --chown=outboxy:outboxy --from=builder /app/packages/schema/dist ./packages/schema/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/schema/node_modules ./packages/schema/node_modules

# Publisher Core
COPY --chown=outboxy:outboxy packages/publisher-core/package.json ./packages/publisher-core/
COPY --chown=outboxy:outboxy --from=builder /app/packages/publisher-core/dist ./packages/publisher-core/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/publisher-core/node_modules ./packages/publisher-core/node_modules

# Publisher HTTP
COPY --chown=outboxy:outboxy packages/publisher-http/package.json ./packages/publisher-http/
COPY --chown=outboxy:outboxy --from=builder /app/packages/publisher-http/dist ./packages/publisher-http/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/publisher-http/node_modules ./packages/publisher-http/node_modules

# Publisher Kafka
COPY --chown=outboxy:outboxy packages/publisher-kafka/package.json ./packages/publisher-kafka/
COPY --chown=outboxy:outboxy --from=builder /app/packages/publisher-kafka/dist ./packages/publisher-kafka/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/publisher-kafka/node_modules ./packages/publisher-kafka/node_modules

# Tracing
COPY --chown=outboxy:outboxy packages/tracing/package.json ./packages/tracing/
COPY --chown=outboxy:outboxy --from=builder /app/packages/tracing/dist ./packages/tracing/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/tracing/node_modules ./packages/tracing/node_modules

# API
COPY --chown=outboxy:outboxy packages/api/package.json ./packages/api/
COPY --chown=outboxy:outboxy --from=builder /app/packages/api/dist ./packages/api/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/api/node_modules ./packages/api/node_modules

# Worker
COPY --chown=outboxy:outboxy packages/worker/package.json ./packages/worker/
COPY --chown=outboxy:outboxy --from=builder /app/packages/worker/dist ./packages/worker/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/worker/node_modules ./packages/worker/node_modules

# Server (CLI entry point)
COPY --chown=outboxy:outboxy packages/server/package.json ./packages/server/
COPY --chown=outboxy:outboxy --from=builder /app/packages/server/dist ./packages/server/dist
COPY --chown=outboxy:outboxy --from=prod-deps /app/packages/server/node_modules ./packages/server/node_modules

# Create workspace symlinks for @outboxy packages
RUN mkdir -p node_modules/@outboxy && \
    ln -sf /app/packages/logging node_modules/@outboxy/logging && \
    ln -sf /app/packages/migrations node_modules/@outboxy/migrations && \
    ln -sf /app/packages/db-adapter-core node_modules/@outboxy/db-adapter-core && \
    ln -sf /app/packages/db-adapter-postgres node_modules/@outboxy/db-adapter-postgres && \
    ln -sf /app/packages/db-adapter-mysql node_modules/@outboxy/db-adapter-mysql && \
    ln -sf /app/packages/schema node_modules/@outboxy/schema && \
    ln -sf /app/packages/publisher-core node_modules/@outboxy/publisher-core && \
    ln -sf /app/packages/publisher-http node_modules/@outboxy/publisher-http && \
    ln -sf /app/packages/publisher-kafka node_modules/@outboxy/publisher-kafka && \
    ln -sf /app/packages/tracing node_modules/@outboxy/tracing && \
    ln -sf /app/packages/api node_modules/@outboxy/api && \
    ln -sf /app/packages/worker node_modules/@outboxy/worker && \
    ln -sf /app/packages/server node_modules/@outboxy/server

USER outboxy

# API port
EXPOSE 3000
# Worker Prometheus metrics port
EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use server CLI as entrypoint
ENTRYPOINT ["node", "packages/server/dist/cli/index.js"]
CMD ["help"]
