# @outboxy/worker

Event polling and publishing service for Outboxy. Claims pending outbox events from the database, publishes them to their configured destinations (HTTP or Kafka), and handles retries, failures, and dead-letter queuing.

## Installation

```bash
npm install @outboxy/worker
```

This package is typically used via `@outboxy/server`, which wires up the database adapter, publishers, and CLI. See the [deployment guide](../../docs/deployment.md) for production setup.

---

## How It Works

### Polling Loop

Each `OutboxWorker` instance runs a continuous loop:

1. **Claim** a batch of pending outbox events using `SELECT ... FOR UPDATE SKIP LOCKED` (prevents duplicate processing across workers).
2. **Publish** all outbox events in the batch via the configured publisher (HTTP or Kafka).
3. **Group results** by outcome: succeeded, retryable failure, or dead-letter.
4. **Batch update** the database — one query per outcome group (1–3 queries instead of N).
5. **Sleep** for the adaptive poll interval, then repeat.

### Worker Cluster

`WorkerCluster` manages multiple `OutboxWorker` instances within a single process. Workers share a database connection pool and coordinate via PostgreSQL's `SKIP LOCKED` — no application-level coordination is needed.

Recommended pool size formula: `(WORKER_COUNT * 2) + 1` — two connections per worker for claim and batch update, plus one for maintenance.

### Retry Logic

Failed outbox events follow an exponential backoff strategy:

- **Retryable failure with retries remaining** — scheduled for retry with backoff: `BACKOFF_BASE_MS * BACKOFF_MULTIPLIER ^ retryCount`.
- **Non-retryable failure or max retries exceeded** — moved to the dead-letter queue (`dlq` status).

### Adaptive Polling

When enabled (default), the poll interval adjusts based on pending outbox event count:

| Pending Events        | Poll Interval |
| --------------------- | ------------- |
| >= 100 (configurable) | 100ms (min)   |
| >= 50                 | 500ms         |
| >= 10                 | 1000ms        |
| > 0                   | 2000ms        |
| 0 (idle)              | 5000ms (max)  |

Disable adaptive polling by setting `ADAPTIVE_POLLING_ENABLED=false` to use a fixed `POLL_INTERVAL_MS`.

### Graceful Shutdown

On `stop()`, the worker:

1. Stops polling for new outbox events.
2. Waits for all in-flight outbox events to finish (up to `SHUTDOWN_TIMEOUT_MS`).
3. Forces shutdown and logs a warning if the timeout expires.
4. Shuts down all publisher instances (flushes Kafka buffers, closes connections).

---

## Maintenance Tasks

The worker runs background maintenance schedulers:

- **Stale event recovery** — Recovers outbox events stuck in `processing` status (e.g., after a crash) back to `pending`. Runs every `STALE_RECOVERY_INTERVAL_MS` (default: 60s). An outbox event is considered stale after `STALE_EVENT_THRESHOLD_MS` (default: 5 min).
- **Idempotency key cleanup** — Removes expired idempotency records older than `IDEMPOTENCY_RETENTION_DAYS` (default: 30 days). Runs every 24 hours. Enabled by default.
- **Inbox event cleanup** — Removes processed inbox events older than `INBOX_RETENTION_DAYS` (default: 30 days). Disabled by default; enable with `INBOX_CLEANUP_ENABLED=true`.

---

## Prometheus Metrics

The worker exposes metrics on a separate HTTP server (default: port `9090`, path `/metrics`).

| Metric                             | Type      | Description                          |
| ---------------------------------- | --------- | ------------------------------------ |
| `outboxy_events_published_total`   | Counter   | Outbox events successfully published |
| `outboxy_events_failed_total`      | Counter   | Outbox events that failed to publish |
| `outboxy_events_dlq_total`         | Counter   | Outbox events moved to DLQ           |
| `outboxy_events_retried_total`     | Counter   | Retry attempts                       |
| `outboxy_event_processing_seconds` | Histogram | Outbox event processing duration     |
| `outboxy_batch_size`               | Histogram | Outbox events per poll batch         |
| `outboxy_poll_interval_seconds`    | Gauge     | Current adaptive poll interval       |
| `outboxy_pending_events`           | Gauge     | Current pending outbox event count   |

The metrics server also exposes `GET /health` returning `{ "status": "ok" }`.

---

## Configuration

Configuration is loaded from environment variables and validated with Zod at startup. See [docs/deployment/.env.example](../../docs/deployment/.env.example) for the full list with defaults.

| Variable              | Default | Description                      |
| --------------------- | ------- | -------------------------------- |
| `POLL_INTERVAL_MS`    | `1000`  | Base polling interval (ms)       |
| `BATCH_SIZE`          | `10`    | Outbox events per batch          |
| `MAX_RETRIES`         | `5`     | Max retry attempts before DLQ    |
| `BACKOFF_BASE_MS`     | `1000`  | Exponential backoff base (ms)    |
| `BACKOFF_MULTIPLIER`  | `2`     | Backoff multiplier               |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | Graceful shutdown timeout (ms)   |
| `WORKER_COUNT`        | `1`     | Worker instances per process     |
| `METRICS_ENABLED`     | `true`  | Enable Prometheus metrics server |
| `METRICS_PORT`        | `9090`  | Metrics HTTP server port         |

---

## Worker Identity

Each worker resolves its unique ID in priority order:

1. `WORKER_ID` environment variable (explicit).
2. `HOSTNAME` environment variable (automatic in Kubernetes).
3. Auto-generated short UUID (local development fallback).
