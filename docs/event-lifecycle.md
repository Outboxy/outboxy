# Event Lifecycle (Outbox)

This document describes the full lifecycle of an outbox event from creation to final disposition, including status transitions, retry logic, failure handling, and worker behaviour.

## Status Flow

An outbox event moves through the following statuses. Every terminal status and every transition is shown; a reader does not need to consult other documents to understand the complete lifecycle.

```
  SDK publish()           Worker claims          Publisher succeeds
  +-----------+         +------------+         +-------------+
  |  pending  | ------> | processing | ------> |  succeeded  |
  +-----------+         +-----+------+         +-------------+
                               |
                               | Publisher fails (retryable)
                               v
                        +------+-----+     retryCount < maxRetries
                        |   failed   | ------------------+
                        +------+-----+                   |
                               |                         | (waits for next_retry_at,
                               |                         |  then worker reclaims)
                               |                         v
                               |                  back to "processing"
                               |
                               | retryCount >= maxRetries
                               | OR non-retryable error
                               v
                        +------+-----+
                        |    dlq     |
                        +------------+

  Admin action (via API):
  Any status except "succeeded" -----> cancelled
```

Statuses are defined in `packages/schema/src/status.ts`.

| Status       | Set by                                             | Meaning                                              |
| ------------ | -------------------------------------------------- | ---------------------------------------------------- |
| `pending`    | SDK at INSERT time                                 | Outbox event is queued, not yet claimed              |
| `processing` | Worker on claim                                    | Worker has locked and is delivering the outbox event |
| `succeeded`  | Worker on success                                  | Publisher confirmed delivery                         |
| `failed`     | Worker on retryable failure                        | Delivery failed; a retry is scheduled                |
| `dlq`        | Worker on exhausted retries or non-retryable error | Dead letter queue; no further automatic retries      |
| `cancelled`  | Admin API                                          | Manually cancelled before or after failure           |

## Event Claiming: FOR UPDATE SKIP LOCKED

The worker claims outbox events using an atomic `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` query. This is the core concurrency mechanism that allows multiple workers to process events without duplicating work.

The following query is the PostgreSQL implementation (`packages/db-adapter-postgres/src/repositories/pg-event.repository.ts`):

```sql
UPDATE outbox_events
SET status = 'processing',
    processing_started_at = NOW(),
    updated_at = NOW()
WHERE id IN (
  SELECT id
  FROM outbox_events
  WHERE status IN ('pending', 'failed')
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    AND deleted_at IS NULL
  ORDER BY created_at ASC
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING *
```

Without `SKIP LOCKED`, concurrent workers would block on the same row locks, serializing all processing. With `SKIP LOCKED`, each worker skips rows already locked by another worker and grabs the next available batch, enabling horizontal scaling with zero coordination overhead.

**MySQL note:** MySQL also uses `FOR UPDATE SKIP LOCKED` but omits `ORDER BY`. MySQL's `ORDER BY` combined with `FOR UPDATE` locks the entire scanned range, which would defeat the purpose of `SKIP LOCKED`. Outbox events are therefore claimed in arbitrary order on MySQL.

## Batch Processing

The worker processes outbox events in configurable batches (default: 10 events, controlled by the `BATCH_SIZE` environment variable).

The processing flow per batch (`packages/worker/src/core/worker.ts`):

1. **Claim** -- Execute the `SKIP LOCKED` query to atomically claim up to `batchSize` outbox events.
2. **Publish** -- Send all events to the publisher (HTTP or Kafka) in parallel.
3. **Group results** -- Classify each outbox event as succeeded, retry-needed, or DLQ-bound.
4. **Batch update** -- Execute one database query per result group (up to 3 queries total, rather than one query per event).

## Retry Logic

Retry decisions are made in `packages/worker/src/retry.ts`.

- **Success** -- Mark the outbox event as `succeeded`.
- **Non-retryable failure** -- Move the outbox event to `dlq` immediately.
- **Retryable failure, retries remaining** -- Set status to `failed` and schedule a retry with exponential backoff.
- **Retryable failure, retries exhausted** -- Move the outbox event to `dlq`.

The publisher determines whether a failure is retryable. For the HTTP publisher, 4xx responses are non-retryable; 5xx responses, timeouts, and connection errors are retryable.

### Exponential Backoff

The retry delay is calculated server-side in SQL (`packages/db-adapter-postgres/src/repositories/pg-event.repository.ts`):

```sql
next_retry_at = NOW() + (backoffBaseMs * power(backoffMultiplier, retry_count))
                        * interval '1 millisecond'
```

Default configuration (`packages/worker/src/config.ts`):

| Parameter           | Default | Env var              |
| ------------------- | ------- | -------------------- |
| `maxRetries`        | 5       | `MAX_RETRIES`        |
| `backoffBaseMs`     | 1000    | `BACKOFF_BASE_MS`    |
| `backoffMultiplier` | 2       | `BACKOFF_MULTIPLIER` |

With the defaults above, retry delays are: 1 s, 2 s, 4 s, 8 s, 16 s.

Per-outbox-event `maxRetries` can also be set at publish time via the SDK and is stored in the `max_retries` column. The worker-level `maxRetries` config acts as a global cap.

## Dead Letter Queue (DLQ)

An outbox event moves to `dlq` status when:

- The publisher returns `retryable: false` (for example, an HTTP 4xx client error).
- The outbox event's `retry_count >= max_retries`.

DLQ outbox events remain in the `outbox_events` table with `status = 'dlq'`. They can be inspected and replayed via the admin API.

## Adaptive Polling

The worker adjusts its poll interval based on queue depth (`packages/worker/src/core/worker.ts`). Adaptive polling is enabled by default (`ADAPTIVE_POLLING_ENABLED=true`).

| Pending outbox events | Poll interval |
| --------------------- | ------------- |
| >= 100 (very busy)    | 100 ms        |
| >= 50 (busy)          | 500 ms        |
| >= 10 (moderate)      | 1 000 ms      |
| > 0 (light)           | 2 000 ms      |
| 0 (idle)              | 5 000 ms      |

All thresholds are configurable via environment variables.

## Stale Event Recovery

If a worker crashes while processing outbox events, those events remain stuck in `processing` status. The maintenance scheduler (`packages/worker/src/maintenance-scheduler.ts`) runs a periodic recovery job that resets stale outbox events to `failed` status.

By default, outbox events stuck in `processing` for more than 5 minutes (300 000 ms) are recovered. The recovery job runs every 60 seconds.

## Worker Clustering

Multiple worker instances can run in the same process via `WorkerCluster` (`packages/worker/src/core/worker-cluster.ts`). Workers coordinate through the database using `FOR UPDATE SKIP LOCKED`; no application-level coordination is needed.

Recommended connection pool size: `(workerCount * 2) + 1` connections.
