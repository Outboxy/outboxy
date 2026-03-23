# @outboxy/migrations

Database migration runner for Outboxy. Creates the outbox and inbox tables, indexes, and tracking infrastructure needed by `@outboxy/sdk` and the Outboxy worker.

## Installation

```bash
npm install @outboxy/migrations
```

Install the driver for your database:

```bash
# PostgreSQL
npm install pg

# MySQL
npm install mysql2
```

## Usage

### PostgreSQL

```typescript
import { runMigrations } from "@outboxy/migrations";

await runMigrations(process.env.DATABASE_URL);
```

### MySQL

```typescript
import { runMigrations } from "@outboxy/migrations";

await runMigrations(process.env.DATABASE_URL, "mysql");
```

### Checking Migration Status

```typescript
import { getMigrationStatus } from "@outboxy/migrations";

const status = await getMigrationStatus(process.env.DATABASE_URL);
console.log(
  `Applied: ${status.applied.length}, Pending: ${status.pending.length}`,
);
```

## API

### `runMigrations(connectionString, dialect?)`

Applies all pending migrations to the database.

| Parameter          | Type      | Default        | Description                |
| ------------------ | --------- | -------------- | -------------------------- |
| `connectionString` | `string`  | —              | Database connection string |
| `dialect`          | `Dialect` | `"postgresql"` | Database dialect           |

### `getMigrationStatus(connectionString, dialect?)`

Returns the current migration status.

| Parameter          | Type      | Default        | Description                |
| ------------------ | --------- | -------------- | -------------------------- |
| `connectionString` | `string`  | —              | Database connection string |
| `dialect`          | `Dialect` | `"postgresql"` | Database dialect           |

Returns `MigrationStatus`:

```typescript
interface MigrationStatus {
  applied: string[];
  pending: string[];
  lastApplied: string | null;
}
```

### `Dialect`

```typescript
type Dialect = "postgresql" | "postgres" | "mysql";
```

`"postgresql"` and `"postgres"` are equivalent aliases.

## What It Creates

Each migration run creates and manages:

- `outbox_events` — Transactional outbox event table
- `inbox_events` — Idempotent inbox event table
- Associated indexes for polling and deduplication
- `__outboxy_migrations` — Internal tracking table

## License

MIT
