# @outboxy/sdk

Node.js SDK for integrating the transactional outbox and inbox patterns into your application. TypeScript-first with full type inference.

## Installation

```bash
npm install @outboxy/sdk
```

You also need a dialect package for your database:

```bash
# PostgreSQL
npm install @outboxy/dialect-postgres pg

# MySQL
npm install @outboxy/dialect-mysql mysql2
```

## Overview

The SDK provides two clients:

- **OutboxyClient** — Publishes outbox events to your database within your existing transaction. A background worker delivers the events asynchronously.
- **InboxyClient** — Receives and deduplicates incoming inbox events using `ON CONFLICT DO NOTHING`.

Both clients are ORM-agnostic. You provide an adapter function that converts your database executor (e.g., `pg.PoolClient`, `mysql2.PoolConnection`) into a common `QueryFn` interface. The SDK never manages connections or transactions.

---

## OutboxyClient

### Setup (PostgreSQL)

The following example creates an `OutboxyClient` backed by a PostgreSQL connection pool:

```typescript
import { Pool, PoolClient } from "pg";
import { OutboxyClient } from "@outboxy/sdk";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";

const pool = new Pool({ connectionString: DATABASE_URL });

const outboxy = new OutboxyClient<PoolClient>({
  dialect: new PostgreSqlDialect(),
  adapter: (client) => async (sql, params) => {
    const result = await client.query(sql, params);
    return result.rows as { id: string }[];
  },
  defaultDestinationUrl: "https://webhook.example.com",
});
```

### Publishing Events

Call `publish()` inside your existing database transaction to atomically record an outbox event alongside your business data:

```typescript
const client = await pool.connect();
try {
  await client.query("BEGIN");

  // Your business logic
  await client.query("INSERT INTO orders ...");

  // Publish an outbox event in the same transaction
  const eventId = await outboxy.publish(
    {
      aggregateType: "Order",
      aggregateId: "order-123",
      eventType: "OrderCreated",
      payload: { orderId: "order-123", total: 100 },
      idempotencyKey: "order-123-created", // optional
    },
    client,
  );

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
```

### Batch Publishing

Use `publishBatch()` to publish multiple outbox events in a single database round-trip:

```typescript
const eventIds = await outboxy.publishBatch(
  [
    {
      aggregateType: "Order",
      aggregateId: "order-1",
      eventType: "OrderCreated",
      payload: { total: 100 },
    },
    {
      aggregateType: "Order",
      aggregateId: "order-2",
      eventType: "OrderCreated",
      payload: { total: 200 },
    },
  ],
  client,
);
```

Large batches are automatically chunked based on the database parameter limit.

### OutboxyConfig Options

| Option                   | Type                      | Required | Default  | Description                                                    |
| ------------------------ | ------------------------- | -------- | -------- | -------------------------------------------------------------- |
| `dialect`                | `SqlDialect`              | Yes      | —        | SQL dialect (`PostgreSqlDialect` or `MySqlDialect`)            |
| `adapter`                | `AdapterFn<T>`            | Yes      | —        | Converts your executor to `QueryFn`                            |
| `defaultDestinationUrl`  | `string`                  | No       | —        | Default delivery URL (can be overridden per-event)             |
| `defaultDestinationType` | `DestinationType`         | No       | `"http"` | Delivery type: `http`, `kafka`, `sqs`, `rabbitmq`, or `pubsub` |
| `defaultMaxRetries`      | `number`                  | No       | `5`      | Default max retry attempts                                     |
| `defaultHeaders`         | `Record<string, unknown>` | No       | `{}`     | Default HTTP headers sent with each outbox event               |
| `defaultMetadata`        | `Record<string, unknown>` | No       | `{}`     | Default metadata for observability                             |

### PublishEventInput Fields

| Field             | Type                      | Required | Default                  | Description                                      |
| ----------------- | ------------------------- | -------- | ------------------------ | ------------------------------------------------ |
| `aggregateType`   | `string`                  | Yes      | —                        | e.g., `"Order"`, `"Payment"`                     |
| `aggregateId`     | `string`                  | Yes      | —                        | e.g., order ID, user ID                          |
| `eventType`       | `string`                  | Yes      | —                        | e.g., `"OrderCreated"`, `"PaymentCompleted"`     |
| `payload`         | `TPayload`                | Yes      | —                        | Event payload (serialized as JSON)               |
| `destinationUrl`  | `string`                  | No       | `defaultDestinationUrl`  | Delivery URL for this outbox event               |
| `destinationType` | `DestinationType`         | No       | `defaultDestinationType` | Delivery type for this outbox event              |
| `idempotencyKey`  | `string`                  | No       | —                        | Alphanumeric, dashes, underscores; max 255 chars |
| `maxRetries`      | `number`                  | No       | `defaultMaxRetries`      | Max retry attempts for this outbox event         |
| `eventVersion`    | `number`                  | No       | `1`                      | Schema version (positive integer)                |
| `headers`         | `Record<string, unknown>` | No       | `defaultHeaders`         | HTTP headers for this outbox event               |
| `metadata`        | `Record<string, unknown>` | No       | `defaultMetadata`        | Custom metadata (e.g., `trace_id`, `span_id`)    |

---

## InboxyClient

### Setup (PostgreSQL)

The following example creates an `InboxyClient` backed by a PostgreSQL connection pool:

```typescript
import { Pool, PoolClient } from "pg";
import { InboxyClient } from "@outboxy/sdk";
import { PostgreSqlInboxDialect } from "@outboxy/dialect-postgres";

const inbox = new InboxyClient<PoolClient>({
  dialect: new PostgreSqlInboxDialect(),
  adapter: (client) => async (sql, params) => {
    const result = await client.query(sql, params);
    return result.rows as { id: string }[];
  },
});
```

### Receiving Events

Call `receive()` inside your database transaction to idempotently record an incoming inbox event. The method returns `"duplicate"` if the event was already processed:

```typescript
const client = await pool.connect();
try {
  await client.query("BEGIN");

  const result = await inbox.receive(
    {
      idempotencyKey: "order-123-created", // required
      aggregateType: "Order",
      aggregateId: "order-123",
      eventType: "OrderCreated",
      payload: { orderId: "order-123", total: 100 },
      source: "payment-service", // optional
    },
    client,
  );

  if (result.status === "duplicate") {
    await client.query("COMMIT");
    return; // Already processed — skip business logic
  }

  // Process the inbox event (business logic here)
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
```

The `receive()` method returns an `InboxReceiveResult`:

| Field     | Type                         | Description                                                   |
| --------- | ---------------------------- | ------------------------------------------------------------- |
| `eventId` | `string \| null`             | Generated event ID (`null` for duplicates on PostgreSQL)      |
| `status`  | `"processed" \| "duplicate"` | Whether the inbox event was newly inserted or already existed |

### InboxyConfig Options

| Option            | Type                      | Required | Default | Description                                                     |
| ----------------- | ------------------------- | -------- | ------- | --------------------------------------------------------------- |
| `dialect`         | `InboxSqlDialect`         | Yes      | —       | Inbox dialect (`PostgreSqlInboxDialect` or `MySqlInboxDialect`) |
| `adapter`         | `AdapterFn<T>`            | Yes      | —       | Converts your executor to `QueryFn`                             |
| `defaultHeaders`  | `Record<string, unknown>` | No       | `{}`    | Default headers for received inbox events                       |
| `defaultMetadata` | `Record<string, unknown>` | No       | `{}`    | Default metadata for received inbox events                      |

### Marking Events as Failed

Call `markFailed()` to record a business-logic failure against an inbox event without retrying it:

```typescript
await inbox.markFailed(result.eventId!, "Insufficient inventory", client);
```

---

## Unified Factory: createOutboxy

When using both the outbox and inbox, `createOutboxy()` creates both clients from a single shared adapter:

```typescript
import { createOutboxy } from "@outboxy/sdk";
import {
  PostgreSqlDialect,
  PostgreSqlInboxDialect,
} from "@outboxy/dialect-postgres";
import { Pool, PoolClient } from "pg";

const { outbox, inbox } = createOutboxy<PoolClient>({
  dialect: new PostgreSqlDialect(),
  inboxDialect: new PostgreSqlInboxDialect(),
  adapter: (client) => async (sql, params) => {
    const result = await client.query(sql, params);
    return result.rows as { id: string }[];
  },
  defaultDestinationUrl: "https://webhook.example.com",
});
```

The following example shows an atomic chain: receive an inbox event, run business logic, and publish a downstream outbox event — all in one transaction:

```typescript
const client = await pool.connect();
try {
  await client.query("BEGIN");

  const result = await inbox.receive(
    {
      idempotencyKey: event.id,
      aggregateType: "Payment",
      aggregateId: event.paymentId,
      eventType: "PaymentCompleted",
      payload: event.payload,
    },
    client,
  );

  if (result.status === "duplicate") {
    await client.query("COMMIT");
    return;
  }

  // Business logic
  await client.query("UPDATE orders SET status = $1 WHERE id = $2", [
    "paid",
    orderId,
  ]);

  // Publish a downstream outbox event in the same transaction
  await outbox.publish(
    {
      aggregateType: "Order",
      aggregateId: orderId,
      eventType: "OrderPaid",
      payload: { orderId, paidAt: new Date().toISOString() },
    },
    client,
  );

  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
```

---

## Error Handling

All SDK errors extend `OutboxyError` and include an error `code` for programmatic handling:

| Error Class              | Code                        | When                                      |
| ------------------------ | --------------------------- | ----------------------------------------- |
| `OutboxyValidationError` | `VALIDATION_ERROR`          | Invalid input (bad idempotency key, etc.) |
| `OutboxyConnectionError` | `CONNECTION_ERROR`          | Database connection failure               |
| `OutboxyDuplicateError`  | `DUPLICATE_IDEMPOTENCY_KEY` | Idempotency key conflict (outbox)         |

The following example shows how to catch and distinguish SDK errors:

```typescript
import {
  OutboxyError,
  OutboxyValidationError,
  OutboxyConnectionError,
} from "@outboxy/sdk";

try {
  await outboxy.publish(event, client);
} catch (error) {
  if (error instanceof OutboxyValidationError) {
    console.error(`Validation failed on field: ${error.field}`);
  } else if (error instanceof OutboxyConnectionError) {
    console.error("Database unavailable:", error.cause?.message);
  }
}
```

---

## MySQL Support

The following example creates an `OutboxyClient` backed by a MySQL connection pool:

```typescript
import { createPool, PoolConnection } from "mysql2/promise";
import { OutboxyClient } from "@outboxy/sdk";
import { MySqlDialect } from "@outboxy/dialect-mysql";

const pool = createPool({ uri: DATABASE_URL });

const outboxy = new OutboxyClient<PoolConnection>({
  dialect: new MySqlDialect(),
  adapter: (conn) => async (sql, params) => {
    const [result] = await conn.execute(sql, params);
    if (!Array.isArray(result)) {
      return result.affectedRows > 0 ? [{ id: "" }] : [];
    }
    return result as { id: string }[];
  },
  defaultDestinationUrl: "https://webhook.example.com",
});
```

MySQL idempotency keys cannot be reused after the original outbox event succeeds (no partial unique indexes). Use keys that include a timestamp or UUID to ensure uniqueness.

---

## Adapter Factories

The SDK ships pre-built adapter factories for common database drivers. Import them from `@outboxy/sdk/adapters`:

### PostgreSQL (pg)

```typescript
import { OutboxyClient } from "@outboxy/sdk";
import { createPgAdapter } from "@outboxy/sdk/adapters";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";

const outboxy = new OutboxyClient({
  dialect: new PostgreSqlDialect(),
  adapter: createPgAdapter(),
  defaultDestinationUrl: "https://webhook.example.com",
});
```

### PostgreSQL (postgres-js)

```typescript
import { OutboxyClient } from "@outboxy/sdk";
import { createPostgresJsAdapter } from "@outboxy/sdk/adapters";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";

const outboxy = new OutboxyClient({
  dialect: new PostgreSqlDialect(),
  adapter: createPostgresJsAdapter(),
  defaultDestinationUrl: "https://webhook.example.com",
});
```

### MySQL (mysql2)

```typescript
import { OutboxyClient } from "@outboxy/sdk";
import { createMysql2Adapter } from "@outboxy/sdk/adapters";
import { MySqlDialect } from "@outboxy/dialect-mysql";

const outboxy = new OutboxyClient({
  dialect: new MySqlDialect(),
  adapter: createMysql2Adapter(),
  defaultDestinationUrl: "https://webhook.example.com",
});
```

### Drizzle ORM

Drizzle does not currently expose a documented API for accessing the raw database driver within transactions. To use Outboxy with Drizzle, use the adapter matching your underlying Drizzle driver and extract the raw client from the transaction object yourself:

```typescript
import { OutboxyClient } from "@outboxy/sdk";
import { createPostgresJsAdapter } from "@outboxy/sdk/adapters";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";

const outboxy = new OutboxyClient({
  dialect: new PostgreSqlDialect(),
  adapter: createPostgresJsAdapter(),
});

await db.transaction(async (tx) => {
  // Drizzle business logic...
  const rawClient = extractRawClient(tx); // depends on your Drizzle version + driver
  await outboxy.publish(event, rawClient);
});
```

## License

MIT
