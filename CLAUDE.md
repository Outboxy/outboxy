# Outboxy Project — Claude Code Instructions

**Project**: Transactional Outbox & Inbox Patterns as a Service

---

## Technology Stack

| Category      | Choice          | Details                            |
| ------------- | --------------- | ---------------------------------- |
| API Framework | Fastify 5.x     | TypeScript-first, with Swagger     |
| Database      | Raw pg / mysql2 | No ORM — raw SQL via adapters      |
| Testing       | Vitest          | + Testcontainers for integration   |
| Validation    | Zod             | Runtime validation, type inference |
| HTTP Client   | undici          | Used in publisher-http             |
| Kafka Client  | kafkajs         | Used in publisher-kafka            |
| Logging       | pino            | Structured logging                 |
| Metrics       | prom-client     | Prometheus metrics                 |
| Monorepo      | pnpm workspaces | Changesets for versioning          |

**Do not use**: Express, Prisma, Drizzle, Jest, axios, yarn

---

## Package Structure

```
packages/
├── api/                 # Fastify REST API server
├── worker/              # Event polling & publishing service
├── server/              # Deployment package (API + Worker CLI, Docker)
├── sdk/                 # Node.js SDK (@outboxy/sdk) — OutboxyClient + InboxyClient
├── sdk-nestjs/          # NestJS integration module
├── schema/              # Shared table/column/status constants
├── logging/             # Shared logging utilities
├── migrations/          # Database migration runner
├── db-adapter-core/     # Core DB adapter interfaces
├── db-adapter-postgres/ # PostgreSQL adapter (pg)
├── db-adapter-mysql/    # MySQL adapter (mysql2)
├── dialect-core/        # Core SQL dialect interface
├── dialect-postgres/    # PostgreSQL dialect (outbox + inbox)
├── dialect-mysql/       # MySQL dialect (outbox + inbox)
├── publisher-core/      # Core publisher interfaces
├── publisher-http/      # HTTP/webhook publisher (undici)
├── publisher-kafka/     # Kafka publisher (kafkajs)
├── testing-utils/       # Test helpers and pool managers
└── e2e/                 # End-to-end integration tests
```

---

## Dual-Pattern Architecture

| Pattern    | Purpose                           | SDK Client      | DB Table      |
| ---------- | --------------------------------- | --------------- | ------------- |
| **Outbox** | Guarantees event publishing       | `OutboxyClient` | outbox_events |
| **Inbox**  | Guarantees idempotent consumption | `InboxyClient`  | inbox_events  |

Outbox requires a background worker for delivery. Inbox is library-only (no worker needed).

---

## Critical Technical Constraints

### Database Patterns

- Worker queries use `FOR UPDATE SKIP LOCKED` to prevent duplicate processing
- Inbox uses `ON CONFLICT DO NOTHING` for idempotent event insertion
- Event payloads stored as JSONB (PostgreSQL) or JSON (MySQL)

### Reliability Model

- **Outbox only**: at-least-once delivery (consumers must be idempotent)
- **Outbox + Inbox**: exactly-once processing (Inbox deduplicates via `ON CONFLICT DO NOTHING`)
- DLQ for failed events after max retries

### Event Statuses

Outbox: `pending` → `processing` → `succeeded` | `failed` → `dlq` | `cancelled`
Inbox: `processed` | `failed`

### Destination Types

`http`, `kafka` (implemented) | `sqs`, `rabbitmq`, `pubsub` (defined, not yet implemented)

---

## Scripts (root package.json)

| Task           | Command           |
| -------------- | ----------------- |
| Build all      | `pnpm build`      |
| Test all       | `pnpm test`       |
| Lint           | `pnpm lint`       |
| Lint fix       | `pnpm lint:fix`   |
| Format         | `pnpm format`     |
| Type check     | `pnpm typecheck`  |
| Run migrations | `pnpm migrate`    |
| Dev API        | `pnpm dev:api`    |
| Dev Worker     | `pnpm dev:worker` |

---

## Red Flags

| Condition                           | Risk               |
| ----------------------------------- | ------------------ |
| Worker query missing `SKIP LOCKED`  | Race condition     |
| Claiming exactly-once without Inbox | Misleading         |
| Tests consistently failing          | Block feature work |

---

Last Updated: 2026-02-18
