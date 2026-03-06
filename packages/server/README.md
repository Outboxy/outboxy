# @outboxy/server

Deployment package that combines `@outboxy/api` and `@outboxy/worker` into a single Docker image with a unified CLI. Handles database adapter creation (PostgreSQL or MySQL, auto-detected from the connection string) and publisher creation (HTTP or Kafka) from environment variables.

## Installation

```bash
npm install @outboxy/server
```

---

## CLI Commands

```bash
node dist/cli/index.js <command>
```

| Command   | Description                                       |
| --------- | ------------------------------------------------- |
| `api`     | Start the REST API server                         |
| `worker`  | Start the event processing worker                 |
| `migrate` | Run database migrations (requires `DATABASE_URL`) |
| `help`    | Show usage information                            |

The package also exposes two standalone binaries via the `bin` field in `package.json`:

- `outboxy-api` — runs `dist/cli/api.js`
- `outboxy-worker` — runs `dist/cli/worker.js`

---

## Configuration

The server package loads its own configuration for database and publisher setup, then delegates to `@outboxy/api` and `@outboxy/worker` for their respective settings.

| Variable                   | Default     | Description                                 |
| -------------------------- | ----------- | ------------------------------------------- |
| `DATABASE_URL`             | required    | PostgreSQL or MySQL connection string       |
| `DATABASE_TYPE`            | auto-detect | Force `postgresql` or `mysql`               |
| `DB_POOL_MAX`              | `20`        | Max database connections                    |
| `DB_POOL_MIN`              | `2`         | Min database connections                    |
| `DB_CONNECTION_TIMEOUT_MS` | `5000`      | Connection timeout (ms)                     |
| `DB_STATEMENT_TIMEOUT_MS`  | `10000`     | Statement timeout (ms)                      |
| `PUBLISHER_TYPE`           | `http`      | `http` or `kafka`                           |
| `HTTP_TIMEOUT_MS`          | —           | HTTP publisher timeout (ms)                 |
| `KAFKA_BROKERS`            | —           | Kafka broker addresses (required for Kafka) |
| `KAFKA_CLIENT_ID`          | —           | Kafka client ID                             |

See [docs/deployment/.env.example](../../docs/deployment/.env.example) for the full environment variable reference.

---

## Docker

The Dockerfile (`packages/server/Dockerfile`) must be built from the repository root:

```bash
docker build -t outboxy -f packages/server/Dockerfile .
```

The image uses a multi-stage build (Node 22 Alpine):

1. Install dependencies with pnpm.
2. Build all workspace packages in dependency order.
3. Copy only production dependencies and compiled output.
4. Run as non-root user `outboxy` (UID 1001).

Run the image with a command argument:

```bash
# Run database migrations
docker run --rm -e DATABASE_URL=postgresql://... outboxy migrate

# Start the API server
docker run -d -p 3000:3000 -e DATABASE_URL=postgresql://... outboxy api

# Start the worker
docker run -d -p 9090:9090 -e DATABASE_URL=postgresql://... outboxy worker
```

Exposed ports: `3000` (API), `9090` (worker metrics).

The image includes a health check that probes `http://localhost:3000/health` every 30 seconds.

---

## Database Auto-Detection

The adapter factory detects the database type from the URL scheme of `DATABASE_URL`. Set `DATABASE_TYPE=postgresql` or `DATABASE_TYPE=mysql` to override auto-detection.

For the worker, the pool size is automatically calculated as `(WORKER_COUNT * 2) + 1`.

---

## Deployment Guide

See [docs/deployment.md](../../docs/deployment.md) for full deployment instructions, including Docker Compose, Kubernetes manifests, and production configuration.

---

## Load Testing

The package includes built-in load testing utilities:

```bash
pnpm --filter @outboxy/server load-test           # Default
pnpm --filter @outboxy/server load-test:10k        # 10,000 outbox events
pnpm --filter @outboxy/server load-test:100k       # 100,000 outbox events
pnpm --filter @outboxy/server load-test:1m         # 1,000,000 outbox events
```
