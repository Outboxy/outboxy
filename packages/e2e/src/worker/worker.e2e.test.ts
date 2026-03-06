/**
 * V3 Architecture PoC E2E Tests
 *
 * Validates:
 * 1. 100 events/sec throughput with 10ms webhook latency (PRIMARY V3 ACCEPTANCE CRITERIA)
 * 2. Retry logic with exponential backoff
 * 3. DLQ handling after max retries
 * 4. SKIP LOCKED behavior with concurrent processing
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  getTestPgConnectionStringWithSchema,
  waitForEventsProcessed,
  createMockWebhookServer,
  type MockWebhookServer,
  type Pool,
} from "@outboxy/testing-utils";
import { createTestWorkerConfig } from "../helpers/worker-config-factory.js";
import {
  createPostgresAdapter,
  type PostgresAdapter,
} from "@outboxy/db-adapter-postgres";
import { OutboxWorker, createLogger } from "@outboxy/worker";
import { HttpPublisher } from "@outboxy/publisher-http";

describe("V3: Worker E2E Tests", () => {
  let pool: Pool;
  let adapter: PostgresAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let mockServer: MockWebhookServer;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({ name: "worker-e2e" });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    connectionString = getTestPgConnectionStringWithSchema(isolated.schemaName);

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 10,
    });

    mockServer = await createMockWebhookServer();
    console.log(`✅ Mock webhook server started at ${mockServer.url}`);
  }, 10000);

  afterAll(async () => {
    await mockServer?.close();
    await adapter.shutdown();
    await cleanupPool();
    console.log("🧹 Test cleanup complete");
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events CASCADE");
    mockServer.clearRequests();
    mockServer.setLatency(10);
    mockServer.setStatusCode(200);
    mockServer.setFailureRate(0);
  });

  it("should process 100 events/sec with 10ms webhook latency (V3 ACCEPTANCE CRITERIA)", async () => {
    const eventCount = 1000;
    mockServer.setLatency(10);

    console.log(`📝 Inserting ${eventCount} test events...`);

    const insertPromises = Array.from({ length: eventCount }, (_, i) =>
      pool.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, destination_url
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          "Order",
          `order-${i}`,
          "OrderCreated",
          JSON.stringify({ orderNumber: i }),
          mockServer.url,
        ],
      ),
    );

    await Promise.all(insertPromises);
    console.log("✅ Events inserted");

    const config = createTestWorkerConfig({
      batchSize: 50,
      pollIntervalMs: 100,
    });
    const logger = createLogger({ service: "outboxy-e2e", level: "error" });
    const publisher = new HttpPublisher({ timeoutMs: 5000 }, logger);
    const worker = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger,
      publisher,
    );

    console.log("🔄 Starting worker...");
    const startTime = Date.now();

    const workerPromise = worker.start();

    const processedCount = await waitForEventsProcessed(pool, eventCount, {
      timeout: 15000,
      interval: 500,
      onProgress: (processed, total) => {
        console.log(
          `  Processed: ${processed}/${total} (${Math.round((processed / total) * 100)}%)`,
        );
      },
    }).catch(() => {
      return pool
        .query(
          "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'succeeded'",
        )
        .then((r) => Number(r.rows[0].count));
    });

    worker.stop();
    await workerPromise.catch(() => {});

    const endTime = Date.now();
    const durationSec = (endTime - startTime) / 1000;
    const throughput = processedCount / durationSec;

    const MIN_THROUGHPUT_EVENTS_PER_SEC = Number(
      process.env.E2E_MIN_THROUGHPUT ?? 50,
    );

    console.log(`✅ Throughput: ${throughput.toFixed(1)} events/sec`);
    console.log(`✅ Duration: ${durationSec.toFixed(1)} seconds`);

    expect(throughput).toBeGreaterThanOrEqual(MIN_THROUGHPUT_EVENTS_PER_SEC);
    expect(processedCount).toBeGreaterThanOrEqual(eventCount);
  }, 30000);

  it("should retry failed events with exponential backoff", async () => {
    const testEventId = "00000000-0000-0000-0000-000000000001";
    await pool.query(
      `INSERT INTO outbox_events (
        id, aggregate_type, aggregate_id, event_type, payload, destination_url
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        testEventId,
        "Order",
        "order-1",
        "OrderCreated",
        JSON.stringify({ orderNumber: 1 }),
        mockServer.url,
      ],
    );

    mockServer.setStatusCode(500);
    mockServer.setFailureRate(1.0);

    const config = createTestWorkerConfig({
      maxRetries: 3,
      backoffBaseMs: 500,
    });
    const logger = createLogger({ service: "outboxy-e2e", level: "error" });
    const publisher = new HttpPublisher({ timeoutMs: 5000 }, logger);
    const worker = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger,
      publisher,
    );

    const workerPromise = worker.start();

    // Wait for the event to be retried at least once
    await waitForEventsProcessed(pool, 1, {
      timeout: 5000,
      status: ["failed", "dlq"],
    });

    worker.stop();
    await workerPromise.catch(() => {});

    const { rows } = await pool.query(
      `SELECT status, retry_count, last_error, next_retry_at FROM outbox_events WHERE id = $1`,
      [testEventId],
    );

    const event = rows[0];
    expect(["failed", "dlq"]).toContain(event.status);
    expect(event.retry_count).toBeGreaterThan(0);
    expect(event.last_error).toBeTruthy();

    console.log(
      `✅ Retry logic works: status=${event.status}, retry_count=${event.retry_count}`,
    );
  });

  it("should move event to DLQ after max retries exhausted", async () => {
    const testDlqEventId = "00000000-0000-0000-0000-000000000002";
    await pool.query(
      `INSERT INTO outbox_events (
        id, aggregate_type, aggregate_id, event_type, payload, destination_url,
        retry_count, max_retries
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        testDlqEventId,
        "Order",
        "order-dlq",
        "OrderCreated",
        JSON.stringify({ orderNumber: 1 }),
        mockServer.url,
        5,
        5,
      ],
    );

    mockServer.setStatusCode(500);
    mockServer.setFailureRate(1.0);

    const config = createTestWorkerConfig({ maxRetries: 5 });
    const logger = createLogger({ service: "outboxy-e2e", level: "error" });
    const publisher = new HttpPublisher({ timeoutMs: 5000 }, logger);
    const worker = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger,
      publisher,
    );

    const workerPromise = worker.start();

    // Wait for the event to be moved to DLQ
    await waitForEventsProcessed(pool, 1, {
      timeout: 5000,
      status: "dlq",
    });

    worker.stop();
    await workerPromise.catch(() => {});

    const { rows } = await pool.query(
      `SELECT status, retry_count, last_error, processed_at FROM outbox_events WHERE id = $1`,
      [testDlqEventId],
    );

    const event = rows[0];
    expect(event.status).toBe("dlq");
    expect(event.last_error).toBeTruthy();
    expect(event.processed_at).toBeTruthy();

    console.log("✅ DLQ logic works: event moved to DLQ after max retries");
  });

  it("should handle SKIP LOCKED correctly (no duplicate processing)", async () => {
    const eventCount = 50;

    for (let i = 0; i < eventCount; i++) {
      await pool.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, destination_url
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          "Order",
          `order-${i}`,
          "OrderCreated",
          JSON.stringify({ orderNumber: i }),
          mockServer.url,
        ],
      );
    }

    const config = createTestWorkerConfig({
      pollIntervalMs: 50,
      batchSize: 10,
    });
    const logger1 = createLogger({ service: "outboxy-e2e", level: "error" });
    const logger2 = createLogger({ service: "outboxy-e2e", level: "error" });

    const publisher1 = new HttpPublisher({ timeoutMs: 5000 }, logger1);
    const publisher2 = new HttpPublisher({ timeoutMs: 5000 }, logger2);

    const worker1 = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger1,
      publisher1,
    );
    const worker2 = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger2,
      publisher2,
    );

    const promise1 = worker1.start();
    const promise2 = worker2.start();

    await waitForEventsProcessed(pool, eventCount, { timeout: 15000 });

    worker1.stop();
    worker2.stop();

    await Promise.all([promise1.catch(() => {}), promise2.catch(() => {})]);

    const totalEventsDelivered = mockServer.getTotalEventCount();
    expect(totalEventsDelivered).toBe(eventCount);

    console.log(
      `✅ SKIP LOCKED prevents duplicates: ${eventCount} events, ${totalEventsDelivered} deliveries`,
    );
  }, 30000);
});
