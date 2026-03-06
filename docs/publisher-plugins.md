# Publisher Plugins

Publishers deliver outbox events to their destinations. The worker depends only on the `Publisher` interface from `@outboxy/publisher-core`; concrete implementations live in separate packages.

## What Users Interact With vs. Internal Implementation

| Component             | Package                    | Used by                  | Visibility                                                   |
| --------------------- | -------------------------- | ------------------------ | ------------------------------------------------------------ |
| `Publisher` interface | `@outboxy/publisher-core`  | Worker (internal)        | **Internal** -- the worker instantiates and calls publishers |
| `HttpPublisher`       | `@outboxy/publisher-http`  | Worker via server config | **Internal** -- configured in the server deployment          |
| `KafkaPublisher`      | `@outboxy/publisher-kafka` | Worker via server config | **Internal** -- configured in the server deployment          |

Application code does not instantiate publishers directly. Publishers are configured at deployment time via the server package. The sections below document publisher behaviour and configuration options for operators deploying the Outboxy server.

## Publisher Interface

The `Publisher` interface is defined in `packages/publisher-core/src/types.ts`:

```typescript
interface Publisher {
  publish(events: OutboxEvent[]): Promise<Map<string, PublishResult>>;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}

interface PublishResult {
  success: boolean;
  error?: Error;
  retryable: boolean; // true = retry with backoff, false = move to DLQ
}
```

The `publish()` method receives a batch of outbox events and returns a `Map<string, PublishResult>` keyed by outbox event ID. Each result indicates success or failure and whether the failure is retryable. The worker uses the `retryable` flag to decide between scheduling a retry (with exponential backoff) or moving the outbox event to the dead letter queue.

The `initialize()` and `shutdown()` lifecycle hooks are optional. The worker calls `initialize()` at startup and `shutdown()` during graceful shutdown.

## HTTP Publisher (`@outboxy/publisher-http`)

The HTTP publisher delivers outbox events as HTTP POST requests using the `undici` library.

### Batch Delivery

Outbox events are grouped by `destinationUrl`. One HTTP request is sent per unique destination URL, reducing network overhead from N requests (one per outbox event) to M requests (one per destination).

The following example shows the batch payload format:

```json
{
  "batch": true,
  "count": 3,
  "events": [
    {
      "eventId": "...",
      "eventType": "...",
      "aggregateType": "...",
      "aggregateId": "...",
      "payload": {},
      "createdAt": "..."
    }
  ]
}
```

Custom headers are included on every request:

- `X-Outbox-Batch: true`
- `X-Outbox-Batch-Size`
- `X-Outbox-Event-IDs`

### Response Handling

| Response                                    | Outcome                                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2xx                                         | All outbox events in the batch are marked `succeeded`. If the body contains a `results` object keyed by outbox event ID (with `success`, `retryable`, and `error` fields), per-event results are respected instead. |
| 5xx, 408, 429                               | All outbox events in the batch are treated as a retryable failure.                                                                                                                                                  |
| Other 4xx                                   | All outbox events in the batch are treated as non-retryable; they move to DLQ.                                                                                                                                      |
| Network error (connection refused, timeout) | Treated as a retryable failure.                                                                                                                                                                                     |

### Configuration

The HTTP publisher is configured via `httpPublisherConfigSchema` (validated with Zod). All fields have defaults.

| Option      | Default                | Description                               |
| ----------- | ---------------------- | ----------------------------------------- |
| `timeoutMs` | 30000                  | Request timeout for both headers and body |
| `userAgent` | `"Outboxy-Worker/1.0"` | Value of the `User-Agent` header          |

### Usage

The following example shows how to instantiate `HttpPublisher` with a custom timeout:

```typescript
import { HttpPublisher } from "@outboxy/publisher-http";

const publisher = new HttpPublisher({ timeoutMs: 15000 });
```

## Kafka Publisher (`@outboxy/publisher-kafka`)

The Kafka publisher delivers outbox events to Kafka topics using the `kafkajs` library.

### Topic Resolution

Topics are extracted from each outbox event's `destinationUrl`:

- `"kafka://orders"` resolves to the topic `"orders"`.
- `"orders"` is used as the topic name directly.

Topic names are validated against Kafka rules: 1 to 249 characters, ASCII alphanumeric plus `.`, `_`, and `-`, and cannot start with `.` or `_`.

### Partitioning Strategy

The `aggregateId` from each outbox event is used as the Kafka partition key. All outbox events for the same aggregate land on the same partition, preserving ordering per aggregate. If `aggregateId` is null or empty, no partition key is set and Kafka's `DefaultPartitioner` distributes the message.

### Batching

Outbox events are grouped by topic. Each topic group is sent as a single `producer.send()` call with multiple messages; `kafkajs` batches the messages internally.

Each Kafka message includes the following headers:

- `x-outbox-event-id`
- `x-outbox-event-type`
- `x-outbox-aggregate-type`

### Error Classification

The `isRetryableKafkaError()` function classifies errors as follows.

Non-retryable errors (outbox events move to DLQ):

- Unknown topic, invalid topic, authorization failed, authentication failed, invalid message, topic marked for deletion, unsupported version.

Retryable errors (worker retries with backoff):

- Everything else: network errors, broker unavailable, timeouts.

### Configuration

The Kafka publisher is configured via `kafkaPublisherConfigSchema` (validated with Zod).

| Option             | Default               | Description                                                              |
| ------------------ | --------------------- | ------------------------------------------------------------------------ |
| `brokers`          | (required)            | Comma-separated broker list (for example, `"broker1:9092,broker2:9092"`) |
| `clientId`         | `"outboxy-publisher"` | Kafka client identifier                                                  |
| `compressionType`  | `"gzip"`              | Message compression: `gzip`, `snappy`, `lz4`, `zstd`, or `none`          |
| `maxRetries`       | 3                     | `kafkajs`-level retries per operation                                    |
| `requestTimeoutMs` | 30000                 | Kafka request timeout                                                    |

### Usage

The following example shows how to instantiate `KafkaPublisher` and connect the Kafka producer:

```typescript
import { KafkaPublisher } from "@outboxy/publisher-kafka";

const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
await publisher.initialize(); // connects the Kafka producer
```

## Adding a New Publisher

To add support for a new destination type (for example, SQS), follow these steps:

1. Create a new package (for example, `@outboxy/publisher-sqs`).
2. Implement the `Publisher` interface from `@outboxy/publisher-core`.
3. Define a Zod config schema for validation.
4. Implement error classification: return `retryable: true` for transient failures (network errors, throttling) and `retryable: false` for permanent failures (invalid queue, auth errors).
5. Use `initialize()` and `shutdown()` for client lifecycle management.

The `destinationType` column in `outbox_events` currently accepts `http`, `kafka`, `sqs`, `rabbitmq`, and `pubsub` (defined via CHECK constraint in the migration DDL). Only `http` and `kafka` have publisher implementations. <!-- TODO: verify CHECK constraint includes all five destination types in both postgres and mysql migration files -->
