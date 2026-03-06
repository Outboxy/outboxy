# Database Adapters and Dialects

Outboxy splits database concerns into two layers: **adapters** handle connection management and query execution, while **dialects** handle SQL generation. This separation allows each layer to be versioned and tree-shaken independently.

## What Users Interact With vs. Internal Implementation

| Layer      | Package(s)                                                  | Used by                               | Visibility                                                                   |
| ---------- | ----------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| Dialect    | `@outboxy/dialect-postgres`, `@outboxy/dialect-mysql`       | SDK (`OutboxyClient`, `InboxyClient`) | **User-facing** -- passed to the SDK constructor                             |
| Adapter    | `@outboxy/db-adapter-postgres`, `@outboxy/db-adapter-mysql` | API server and worker                 | **Internal** -- configured in the server deployment, not in application code |
| Migrations | `@outboxy/migrations`                                       | CLI / deployment scripts              | **User-facing** -- called once during setup                                  |

Application code only touches dialects (via the SDK constructor) and migrations (during deployment). Adapters are an internal concern of the Outboxy server and worker.

## Architecture Overview

The diagram below shows the relationship between the two layers and their implementations:

```
  Dialect (SQL generation)              Adapter (connection + execution)
  dialect-core      (interfaces)        db-adapter-core     (interfaces)
  dialect-postgres  (PostgreSQL SQL)    db-adapter-postgres (pg Pool)
  dialect-mysql     (MySQL SQL)         db-adapter-mysql    (mysql2 Pool)
```

The migration package (`@outboxy/migrations`) operates independently using raw SQL files.

## Adapter Layer (`db-adapter-*`)

### Core Interfaces

`@outboxy/db-adapter-core` defines the contracts every adapter must implement. The central interface is `DatabaseAdapter`, which extends `ConnectionManager` and exposes three sub-interfaces.

| Sub-interface           | Purpose                                                                                                        | Consumer                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `EventRepository`       | Worker operations: claim outbox events (`FOR UPDATE SKIP LOCKED`), mark succeeded, schedule retry, move to DLQ | Worker                  |
| `EventService`          | API operations: create outbox event, get by ID, find by idempotency key, replay events                         | API server              |
| `MaintenanceOperations` | Background tasks: recover stale outbox events, clean up idempotency keys, clean up inbox events                | Worker maintenance loop |

Adapters may also expose an `InboxRepository<T>` for inbox pattern operations. The generic `T` represents the database executor type (for example, `pg.Pool | pg.PoolClient` for PostgreSQL or `mysql2.Pool | mysql2.PoolConnection` for MySQL), allowing the repository to participate in the caller's transaction.

### ConnectionManager Lifecycle

Every adapter implements the `ConnectionManager` interface:

- `initialize()` -- Creates the connection pool, tests connectivity with retry logic, and instantiates repositories.
- `shutdown(timeoutMs?)` -- Drains the pool gracefully within the given timeout (default: 10 seconds).
- `checkHealth()` -- Returns a `ConnectionHealthStatus` with pool metrics. PostgreSQL exposes `totalConnections`, `idleConnections`, and `waitingClients`; MySQL returns only a `healthy` boolean because `mysql2` does not expose pool statistics.

### Error Normalization

Each adapter maps database-specific errors to four normalized error classes defined in `db-adapter-core`:

- `ConnectionError` -- Network failures, authentication errors, pool exhaustion.
- `QueryTimeoutError` -- Statement timeouts, lock acquisition timeouts.
- `ConstraintViolationError` -- Unique, foreign key, or check constraint violations.
- `DatabaseError` -- Base class for all other database errors.

The `createWithErrorMapping(mapFn)` factory produces a `withErrorMapping` wrapper. Adapter repositories use this wrapper to catch and normalize errors automatically.

### Adapter Detection

The `detectDatabaseType()` function in `db-adapter-core` auto-detects the database from a connection string. Each adapter also exports a `canHandle(connectionString)` function.

Supported connection string prefixes:

- PostgreSQL: `postgres://`, `postgresql://`
- MySQL: `mysql://`, `mysql2://`

### Configuration

Both adapters validate options with Zod schemas. Common options:

| Option                | PostgreSQL default | MySQL default |
| --------------------- | ------------------ | ------------- |
| `maxConnections`      | 20                 | 20            |
| `connectionTimeoutMs` | 5000               | 5000          |
| `maxRetries`          | 3                  | 3             |
| `retryDelayMs`        | 1000               | 1000          |

PostgreSQL additionally supports `minConnections` (default: 2), `idleTimeoutMs` (default: 30000), and `statementTimeoutMs` (default: 10000).

## Dialect Layer (`dialect-*`)

### What users interact with

Application code passes a dialect instance to the SDK constructor. The dialect is the only database-specific object that application code needs to import. No adapter imports are needed in application code.

### Core Interfaces

`@outboxy/dialect-core` defines two interfaces:

- `SqlDialect` -- Outbox SQL generation: `buildInsert()` (with idempotency handling), `buildBulkInsert()`.
- `InboxSqlDialect` -- Inbox SQL generation: `buildInboxInsert()` (with `ON CONFLICT DO NOTHING`), `buildInboxBulkInsert()`, `buildMarkFailed()`, `buildFindByIdempotencyKeys()`, `buildCleanupProcessedEvents()`.

Both interfaces extend `BaseDialectProperties`, which provides:

- `name` -- `"postgresql"` or `"mysql"`.
- `placeholder(index)` -- Parameter placeholder (`$1` for PostgreSQL, `?` for MySQL).
- `maxParameters` -- 65535 for both databases.
- `supportsReturning` -- `true` for PostgreSQL, `false` for MySQL.

### Key Differences Between Dialects

| Feature             | PostgreSQL                                                                                           | MySQL                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| ID generation       | `RETURNING id` clause                                                                                | Requires a pre-generated UUID passed as `generatedId`          |
| Outbox idempotency  | `ON CONFLICT (idempotency_key) WHERE status != 'succeeded' DO UPDATE SET ...` (partial unique index) | `ON DUPLICATE KEY UPDATE` with a CASE expression               |
| Inbox deduplication | `ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`                                              | `INSERT IGNORE` (check `affectedRows` for duplicate detection) |
| Date arithmetic     | `NOW() - ($1 * interval '1 day')`                                                                    | `DATE_SUB(NOW(), INTERVAL ? DAY)`                              |

## Migration System

`@outboxy/migrations` manages schema creation via raw SQL files stored in `sql/postgres/` and `sql/mysql/`. Migrations are tracked in a `__outboxy_migrations` table.

### Migration Files

| Migration                  | Creates                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| `001_create_tables`        | `outbox_config` and `outbox_events` tables                                   |
| `002_create_indexes`       | Outbox indexes (status/retry, processing, aggregate, idempotency, partition) |
| `003_create_inbox_tables`  | `inbox_events` table                                                         |
| `004_create_inbox_indexes` | Inbox indexes (idempotency unique, status, aggregate, cleanup, source)       |

### Running Migrations

The following example shows how to run migrations programmatically:

```typescript
import { runMigrations } from "@outboxy/migrations";

await runMigrations("postgresql://..."); // PostgreSQL
await runMigrations("mysql://...", "mysql"); // MySQL
```

Each migration runs in a transaction on PostgreSQL. On MySQL, `INSERT IGNORE` is used for race-condition safety. The `getMigrationStatus()` function returns lists of applied and pending migrations.

## Adding a New Database

To add support for a new database (for example, SQLite), implement the following:

1. **Dialect package** (`@outboxy/dialect-sqlite`): Implement `SqlDialect` and `InboxSqlDialect` with database-specific SQL generation.
2. **Adapter package** (`@outboxy/db-adapter-sqlite`): Implement `DatabaseAdapter` (including `EventRepository`, `EventService`, `MaintenanceOperations`, and optionally `InboxRepository<T>`). Export a `canHandle()` function and a `createSqliteAdapter()` factory.
3. **Migration SQL files**: Add a `sql/sqlite/` directory under `@outboxy/migrations` with equivalent DDL statements.
4. **Error mapper**: Create a `mapSqliteError()` function that normalizes native errors to `DatabaseError` subclasses.
