# Inbox Pattern (Idempotent Consumption)

The inbox pattern guarantees that an incoming event is processed exactly once, even if the event is delivered multiple times. Unlike the outbox pattern, the inbox requires no background worker; deduplication happens at INSERT time within the consumer's transaction.

## How Deduplication Works

Each inbox event has a required `idempotencyKey`. When the consumer calls `receive()`, the SDK inserts a row into `inbox_events` with a conflict clause on the `idempotency_key` column. If the key already exists, the insert is silently ignored and the result indicates a duplicate.

The following statement is the PostgreSQL implementation (`packages/dialect-postgres/src/postgres-inbox-dialect.ts`):

```sql
INSERT INTO inbox_events (idempotency_key, source, aggregate_type, ...)
VALUES ($1, $2, $3, ...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id
```

If the insert succeeds, `RETURNING id` provides the new row's ID. If the key conflicts, no rows are returned and the SDK returns `{ status: 'duplicate' }`.

The following statement is the MySQL implementation (`packages/dialect-mysql/src/mysql-inbox-dialect.ts`):

```sql
INSERT IGNORE INTO inbox_events (id, idempotency_key, source, ...)
VALUES (?, ?, ?, ...)
```

MySQL uses `INSERT IGNORE` with a pre-generated UUID. Duplicate detection relies on `affectedRows` being 0 for duplicates.

## Inbox Event Statuses

Inbox event statuses are defined in `packages/schema/src/status.ts`.

- **processed** -- The inbox event was successfully received and inserted. This is the default status on INSERT.
- **failed** -- The inbox event was received, but business logic failed. Set explicitly via `markFailed()`.

Inbox events do not have `retry`, `dlq`, or `cancelled` statuses. The inbox's responsibility is deduplication, not delivery.

## InboxyClient API

`InboxyClient<T>` is exported from `@outboxy/sdk` (`packages/sdk/src/inbox-client.ts`).

### What users interact with

`InboxyClient` is the only inbox API surface that application code touches. The dialect and adapter passed to the constructor are internal implementation details that wire up SQL generation and query execution.

### Configuration

The following example shows how to instantiate `InboxyClient` with a PostgreSQL connection pool:

```typescript
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

### receive()

The `receive()` method inserts an inbox event within the caller's transaction and returns whether the inbox event is new or a duplicate.

```typescript
const result = await inbox.receive(
  {
    idempotencyKey: "order-123-created", // required
    aggregateType: "Order",
    aggregateId: "123",
    eventType: "OrderCreated",
    payload: { orderId: "123", total: 100 },
    source: "payment-service", // optional
  },
  transactionClient,
);

if (result.status === "duplicate") {
  return; // already processed; skip business logic
}
// result.status === 'processed'
// result.eventId contains the new inbox event ID
```

`InboxReceiveResult` has two fields:

- `status: 'processed' | 'duplicate'`
- `eventId: string | null` -- The inbox event ID (`null` for duplicates on PostgreSQL).

### receiveBatch()

`receiveBatch()` performs a bulk insert for batch processing scenarios such as Kafka consumer batches.

```typescript
const results = await inbox.receiveBatch(events, transactionClient);
// results[i].status is 'processed' or 'duplicate' for each input event
```

### markFailed()

`markFailed()` marks a previously received inbox event as failed. The `idempotency_key` is not released, so the inbox event remains deduplicated. The status is set to `failed` with an error message for operational visibility.

```typescript
await inbox.markFailed(eventId, "Insufficient inventory", transactionClient);
```

## Idempotency Key Strategies

The `idempotencyKey` is chosen by the consumer. Common strategies (from `packages/sdk/src/inbox-types.ts`):

- **Transport-level:** `kafka:orders:${partition}:${offset}`
- **Business-level:** `order-${orderId}-created`
- **Hybrid:** `payment-svc:charge-${chargeId}`
- **Outbox event ID:** use the outbox event's own UUID as the key

## Exactly-Once Processing with Outbox + Inbox

When both patterns are used in the same database transaction, the system achieves exactly-once processing. The `createOutboxy()` factory (`packages/sdk/src/create-outboxy.ts`) creates both clients with a shared adapter so that both participate in the same transaction.

The following example demonstrates the full pattern: receive an incoming inbox event, run business logic, and publish a downstream outbox event — all in one atomic transaction:

```typescript
const { outbox, inbox } = createOutboxy<PoolClient>({
  dialect: new PostgreSqlDialect(),
  inboxDialect: new PostgreSqlInboxDialect(),
  adapter: (client) => async (sql, params) => {
    const result = await client.query(sql, params);
    return result.rows as { id: string }[];
  },
  defaultDestinationUrl: "https://fulfillment.example.com/webhook",
});

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // 1. Deduplicate the incoming inbox event
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

  // 2. Business logic
  await client.query("UPDATE orders SET status = $1 WHERE id = $2", [
    "paid",
    orderId,
  ]);

  // 3. Publish a downstream outbox event in the same transaction
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

If the transaction rolls back, both the inbox record and the outbox event are discarded. The next delivery attempt can retry safely because the `idempotency_key` was never committed.

## Inbox Cleanup

Processed inbox events accumulate over time. The worker's maintenance scheduler (`packages/worker/src/maintenance-scheduler.ts`) can optionally delete old inbox records.

| Config                   | Default         | Env var                     |
| ------------------------ | --------------- | --------------------------- |
| `inboxCleanupEnabled`    | `false`         | `INBOX_CLEANUP_ENABLED`     |
| `inboxCleanupIntervalMs` | 86400000 (24 h) | `INBOX_CLEANUP_INTERVAL_MS` |
| `inboxRetentionDays`     | 30              | `INBOX_RETENTION_DAYS`      |

After cleanup, inbox events older than the retention period lose their deduplication protection. This is acceptable under at-least-once delivery semantics because the inbox only needs to deduplicate within a reasonable window.
