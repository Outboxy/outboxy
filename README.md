# Outboxy

Outboxy implements the transactional outbox and inbox patterns as a service, guaranteeing reliable event delivery from your database transactions to external systems such as HTTP webhooks and Kafka topics. Use the outbox pattern alone for at-least-once delivery, or combine it with the inbox pattern for exactly-once processing.

## Quick Start with Docker

The Docker image is published to `ghcr.io/outboxy/outboxy`. The image accepts three commands: `api`, `worker`, and `migrate`.

The following example starts Outboxy against a PostgreSQL database:

```bash
# 1. Run database migrations
docker run --rm \
  -e DATABASE_URL="postgresql://user:pass@host:5432/outboxy" \
  ghcr.io/outboxy/outboxy:latest migrate

# 2. Start the REST API server (port 3000)
docker run -d \
  -e DATABASE_URL="postgresql://user:pass@host:5432/outboxy" \
  -e PORT=3000 \
  -p 3000:3000 \
  ghcr.io/outboxy/outboxy:latest api

# 3. Start the worker
docker run -d \
  -e DATABASE_URL="postgresql://user:pass@host:5432/outboxy" \
  -e PUBLISHER_TYPE=http \
  ghcr.io/outboxy/outboxy:latest worker
```

Key environment variables:

| Variable           | Required | Default | Description                             |
| ------------------ | -------- | ------- | --------------------------------------- |
| `DATABASE_URL`     | Yes      | --      | PostgreSQL or MySQL connection string   |
| `PORT`             | No       | `3000`  | API server port                         |
| `LOG_LEVEL`        | No       | `info`  | `debug`, `info`, `warn`, or `error`     |
| `PUBLISHER_TYPE`   | No       | `http`  | `http` or `kafka`                       |
| `POLL_INTERVAL_MS` | No       | `1000`  | Worker polling interval in milliseconds |
| `BATCH_SIZE`       | No       | `10`    | Outbox events per worker batch          |
| `METRICS_PORT`     | No       | `9090`  | Worker Prometheus metrics port          |

Run `docker run --rm ghcr.io/outboxy/outboxy:latest help` for the full list.

## Reliability Model

- **Outbox alone** provides at-least-once delivery. Consumers must be idempotent.
- **Outbox + Inbox** together provide exactly-once processing. The inbox deduplicates outbox events using `ON CONFLICT DO NOTHING`, so the same outbox event is never processed twice.

## Architecture

![Package dependency graph](docs/package-graph.svg)

## Packages

| Package               | npm Scope                      | Description                                                 |
| --------------------- | ------------------------------ | ----------------------------------------------------------- |
| `api`                 | `@outboxy/api`                 | Fastify REST API server                                     |
| `worker`              | `@outboxy/worker`              | Outbox event polling and publishing service                 |
| `server`              | `@outboxy/server`              | Deployment package (API + worker CLI, Docker build context) |
| `sdk`                 | `@outboxy/sdk`                 | Node.js SDK — `OutboxyClient` and `InboxyClient`            |
| `sdk-nestjs`          | `@outboxy/sdk-nestjs`          | NestJS integration module                                   |
| `schema`              | `@outboxy/schema`              | Shared schema constants and types                           |
| `logging`             | `@outboxy/logging`             | Shared logging utilities (pino)                             |
| `migrations`          | `@outboxy/migrations`          | Database migration runner                                   |
| `db-adapter-core`     | `@outboxy/db-adapter-core`     | Core DB adapter interfaces                                  |
| `db-adapter-postgres` | `@outboxy/db-adapter-postgres` | PostgreSQL adapter (pg)                                     |
| `db-adapter-mysql`    | `@outboxy/db-adapter-mysql`    | MySQL adapter (mysql2)                                      |
| `dialect-core`        | `@outboxy/dialect-core`        | Core SQL dialect interface                                  |
| `dialect-postgres`    | `@outboxy/dialect-postgres`    | PostgreSQL dialect for the SDK                              |
| `dialect-mysql`       | `@outboxy/dialect-mysql`       | MySQL dialect for the SDK                                   |
| `publisher-core`      | `@outboxy/publisher-core`      | Core publisher interfaces                                   |
| `publisher-http`      | `@outboxy/publisher-http`      | HTTP webhook publisher (undici)                             |
| `publisher-kafka`     | `@outboxy/publisher-kafka`     | Kafka publisher (kafkajs)                                   |
| `testing-utils`       | `@outboxy/testing-utils`       | Test helpers and Testcontainers setup                       |
| `e2e`                 | `@outboxy/e2e`                 | End-to-end integration tests                                |

The following packages are published to npm: `@outboxy/sdk`, `@outboxy/sdk-nestjs`, `@outboxy/schema`, `@outboxy/dialect-core`, `@outboxy/dialect-postgres`, and `@outboxy/dialect-mysql`. All other packages are private to the monorepo.

## Databases

PostgreSQL and MySQL are both supported. The database type is auto-detected from the `DATABASE_URL` connection string, or can be set explicitly with `DATABASE_TYPE`.

## Documentation

See [docs/index.md](docs/index.md) for the full documentation index, including deployment guides, SDK usage, and the API reference.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup instructions, how to run tests, and available commands.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Security

See [SECURITY.md](SECURITY.md) for the security policy and how to report vulnerabilities.

## License

[MIT](LICENSE)
