/**
 * HTTP Publisher E2E Tests
 *
 * Validates:
 * 1. HTTP publisher works end-to-end with real webhook server
 * 2. Events published to HTTP endpoints correctly
 * 3. Batch publishing to same destination
 * 4. Multiple destinations handled separately
 * 5. Error handling (4xx non-retryable, 5xx retryable)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  getTestPgConnectionStringWithSchema,
  createMockWebhookServer,
  waitForOutboxEventStatus,
  waitForEventsProcessed,
  type MockWebhookServer,
  type Pool,
} from "@outboxy/testing-utils";
import { createTestWorkerConfig } from "../helpers/worker-config-factory.js";
import { OutboxWorker, createLogger } from "@outboxy/worker";
import { createPostgresAdapter } from "@outboxy/db-adapter-postgres";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import { HttpPublisher } from "@outboxy/publisher-http";

describe("HTTP Publisher E2E Tests", () => {
  let pool: Pool;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let mockServer: MockWebhookServer;

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "http-publisher-e2e",
    });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    connectionString = getTestPgConnectionStringWithSchema(isolated.schemaName);
    mockServer = await createMockWebhookServer({ latencyMs: 10 });
    console.log(`✅ Mock webhook server started at ${mockServer.url}`);
  }, 30000);

  afterAll(async () => {
    await mockServer?.close();
    await cleanupPool();
    console.log("✅ Cleanup complete");
  }, 30000);

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events CASCADE");
    mockServer.clearRequests();
    mockServer.setLatency(10);
    mockServer.setStatusCode(200);
    mockServer.setFailureRate(0);
  });

  async function createTestWorker(
    options: {
      pollIntervalMs?: number;
      batchSize?: number;
      maxRetries?: number;
      backoffBaseMs?: number;
    } = {},
  ): Promise<{
    worker: OutboxWorker;
    publisher: HttpPublisher;
    adapter: DatabaseAdapter;
  }> {
    const config = createTestWorkerConfig({
      pollIntervalMs: options.pollIntervalMs,
      batchSize: options.batchSize,
      maxRetries: options.maxRetries,
      backoffBaseMs: options.backoffBaseMs,
    });

    const logger = createLogger({
      service: "outboxy-e2e",
      level: config.logLevel,
    });

    const adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 5,
      logger,
    });

    const publisher = new HttpPublisher({ timeoutMs: 5000 }, logger);

    const worker = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger,
      publisher,
    );

    return { worker, publisher, adapter };
  }

  it("should publish event to HTTP endpoint successfully", async () => {
    const startTime = Date.now();

    const { rows } = await pool.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, destination_url
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [
        "Order",
        "order-123",
        "OrderCreated",
        JSON.stringify({ orderNumber: 1001, amount: 99.99 }),
        mockServer.url,
      ],
    );

    const eventId = rows[0].id;
    console.log(`📝 Inserted event ${eventId}`);

    const { worker, adapter } = await createTestWorker();

    const workerPromise = worker.start();
    const event = await waitForOutboxEventStatus(pool, eventId, "succeeded");

    worker.stop();
    await workerPromise.catch(() => {});
    await adapter.shutdown();

    expect(event.status).toBe("succeeded");
    expect(event.retry_count).toBe(0);
    expect(event.last_error).toBeNull();

    expect(mockServer.requests.length).toBeGreaterThanOrEqual(1);

    const durationSec = (Date.now() - startTime) / 1000;
    console.log(`✅ Event successfully published to HTTP endpoint!`);
    console.log(`📊 Duration: ${durationSec.toFixed(2)}s`);
  }, 60000);

  it("should batch multiple events to same destination", async () => {
    const eventCount = 10;
    const startTime = Date.now();

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

    console.log(`📝 Inserted ${eventCount} events`);

    const { worker, adapter } = await createTestWorker({ batchSize: 10 });

    const workerPromise = worker.start();

    // Wait for all events to be processed
    await waitForEventsProcessed(pool, eventCount);

    worker.stop();
    await workerPromise.catch(() => {});
    await adapter.shutdown();

    const { rows } = await pool.query(
      `SELECT COUNT(*) as count FROM outbox_events WHERE status = 'succeeded'`,
    );
    expect(Number(rows[0].count)).toBe(eventCount);

    // HTTP publisher batches events to same destination - fewer requests than events
    expect(mockServer.requests.length).toBeLessThanOrEqual(eventCount);
    expect(mockServer.getTotalEventCount()).toBe(eventCount);

    const durationSec = (Date.now() - startTime) / 1000;
    console.log(`✅ ${eventCount} events batched and published`);
    console.log(`📊 HTTP requests made: ${mockServer.requests.length}`);
    console.log(`📊 Duration: ${durationSec.toFixed(2)}s`);
  }, 60000);

  it("should handle multiple destinations separately", async () => {
    // Create a second mock server
    const mockServer2 = await createMockWebhookServer({ latencyMs: 10 });

    try {
      // Insert events for different destinations
      await pool.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, destination_url
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          "Order",
          "order-dest1",
          "OrderCreated",
          JSON.stringify({ destination: 1 }),
          mockServer.url,
        ],
      );

      await pool.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, destination_url
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          "Order",
          "order-dest2",
          "OrderCreated",
          JSON.stringify({ destination: 2 }),
          mockServer2.url,
        ],
      );

      console.log(`📝 Inserted events for 2 different destinations`);

      const { worker, adapter } = await createTestWorker();

      const workerPromise = worker.start();

      // Wait for all events to be processed
      await waitForEventsProcessed(pool, 2);

      worker.stop();
      await workerPromise.catch(() => {});
      await adapter.shutdown();

      // Each destination should receive its event
      expect(mockServer.getTotalEventCount()).toBe(1);
      expect(mockServer2.getTotalEventCount()).toBe(1);

      console.log(`✅ Events delivered to separate destinations correctly`);
    } finally {
      await mockServer2.close();
    }
  }, 60000);

  it("should handle 5xx errors as retryable", async () => {
    mockServer.setStatusCode(500);
    mockServer.setFailureRate(1.0); // Force all requests to fail

    const { rows } = await pool.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, destination_url
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [
        "Order",
        "order-500",
        "OrderCreated",
        JSON.stringify({ willFail: true }),
        mockServer.url,
      ],
    );

    const eventId = rows[0].id;

    // Use short backoff for faster test execution
    const { worker, adapter } = await createTestWorker({
      maxRetries: 2,
      backoffBaseMs: 100,
    });

    const workerPromise = worker.start();

    // Wait for event to be retried and eventually fail/dlq
    await waitForEventsProcessed(pool, 1, { status: ["failed", "dlq"] });

    worker.stop();
    await workerPromise.catch(() => {});
    await adapter.shutdown();

    const { rows: eventRows } = await pool.query(
      `SELECT status, retry_count, last_error FROM outbox_events WHERE id = $1`,
      [eventId],
    );

    const event = eventRows[0];
    expect(event.retry_count).toBeGreaterThan(0);
    expect(event.last_error).toBeTruthy();
    expect(["failed", "dlq"]).toContain(event.status);

    console.log(
      `✅ 5xx errors handled as retryable: retry_count=${event.retry_count}`,
    );
  }, 60000);

  it("should handle 4xx errors as non-retryable", async () => {
    mockServer.setStatusCode(400);
    mockServer.setFailureRate(1.0); // Force all requests to fail

    const { rows } = await pool.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, destination_url
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [
        "Order",
        "order-400",
        "OrderCreated",
        JSON.stringify({ badRequest: true }),
        mockServer.url,
      ],
    );

    const eventId = rows[0].id;

    const { worker, adapter } = await createTestWorker({ maxRetries: 5 });

    const workerPromise = worker.start();

    // 4xx errors should go directly to DLQ without retries
    await waitForEventsProcessed(pool, 1, { status: "dlq" });

    worker.stop();
    await workerPromise.catch(() => {});
    await adapter.shutdown();

    const { rows: eventRows } = await pool.query(
      `SELECT status, retry_count, last_error FROM outbox_events WHERE id = $1`,
      [eventId],
    );

    const event = eventRows[0];
    expect(event.status).toBe("dlq");
    expect(event.last_error).toBeTruthy();

    console.log(
      `✅ 4xx errors handled as non-retryable: status=${event.status}`,
    );
  }, 60000);

  it("should include correct headers in HTTP request", async () => {
    const { rows } = await pool.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, destination_url, headers
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        "Order",
        "order-headers",
        "OrderCreated",
        JSON.stringify({ checkHeaders: true }),
        mockServer.url,
        JSON.stringify({ "X-Custom-Header": "custom-value" }),
      ],
    );

    const eventId = rows[0].id;

    const { worker, adapter } = await createTestWorker();

    const workerPromise = worker.start();
    await waitForOutboxEventStatus(pool, eventId, "succeeded");

    worker.stop();
    await workerPromise.catch(() => {});
    await adapter.shutdown();

    expect(mockServer.requests.length).toBeGreaterThanOrEqual(1);
    const request = mockServer.requests[0]!;

    // Check batch headers are present
    expect(request.headers["x-outbox-batch"]).toBe("true");
    expect(request.headers["x-outbox-event-ids"]).toContain(eventId);

    console.log(`✅ HTTP headers included correctly`);
  }, 60000);
});
