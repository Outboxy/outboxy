/**
 * M3.5 Graceful Shutdown - E2E Tests
 *
 * Tests graceful shutdown with real database to verify:
 * 1. No data loss during shutdown (all in-flight events complete)
 * 2. K8s rolling update simulation
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
import { createPostgresAdapter } from "@outboxy/db-adapter-postgres";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import { OutboxWorker, createLogger } from "@outboxy/worker";
import { HttpPublisher } from "@outboxy/publisher-http";

describe("M3.5: Graceful Shutdown - E2E Tests", () => {
  let pool: Pool;
  let adapter: DatabaseAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let mockServer: MockWebhookServer;

  const logger = createLogger({ service: "outboxy-e2e", level: "error" });

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "graceful-shutdown-e2e",
    });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    connectionString = getTestPgConnectionStringWithSchema(isolated.schemaName);

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 10,
      logger,
    });

    mockServer = await createMockWebhookServer({ latencyMs: 50 });
  }, 10000);

  afterAll(async () => {
    await mockServer?.close();
    await adapter?.shutdown();
    await cleanupPool();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events CASCADE");
    mockServer.clearRequests();
    mockServer.setLatency(50);
  });

  it("should complete all in-flight events before shutdown (no data loss)", async () => {
    const eventCount = 20;
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

    mockServer.setLatency(200);

    const config = createTestWorkerConfig({
      batchSize: 10,
      shutdownTimeoutMs: 5000,
    });

    const publisher = new HttpPublisher({ timeoutMs: 5000 }, logger);
    const worker = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger,
      publisher,
    );

    void worker.start();

    // Wait for some events to be processed (not all) before triggering shutdown
    await waitForEventsProcessed(pool, 5, {
      timeout: 10000,
      status: ["processing", "succeeded"],
    });

    await worker.stop();

    const totalPublished = mockServer.getTotalEventCount();
    expect(totalPublished).toBeGreaterThan(0);

    const succeededCount = await pool.query(
      "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'succeeded'",
    );
    expect(Number(succeededCount.rows[0].count)).toBe(totalPublished);

    const processingCount = await pool.query(
      "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'processing'",
    );
    expect(Number(processingCount.rows[0].count)).toBe(0);
  });

  it("should simulate K8s rolling update (no event loss across pods)", async () => {
    const eventCount = 50;
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

    mockServer.setLatency(100);

    const config = createTestWorkerConfig({
      pollIntervalMs: 50,
      batchSize: 15,
      shutdownTimeoutMs: 3000,
    });

    // Simulate Pod 1 starts, processes some events
    const publisher1 = new HttpPublisher({ timeoutMs: 5000 }, logger);
    const worker1 = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger,
      publisher1,
    );

    void worker1.start();

    // Wait for some events to be processed before triggering rolling update
    await waitForEventsProcessed(pool, 10, {
      timeout: 10000,
      status: ["processing", "succeeded"],
    });

    // K8s sends SIGTERM to Pod 1 (rolling update)
    await worker1.stop();
    await publisher1.shutdown?.();

    const pod1EventCount = mockServer.getTotalEventCount();
    console.log(`Pod 1 processed ${pod1EventCount} events before shutdown`);

    // Simulate Pod 2 starts immediately (takes over remaining events)
    const publisher2 = new HttpPublisher({ timeoutMs: 5000 }, logger);
    const worker2 = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger,
      publisher2,
    );

    void worker2.start();

    await waitForEventsProcessed(pool, eventCount, { timeout: 15000 });

    await worker2.stop();
    await publisher2.shutdown?.();

    const totalEvents = mockServer.getTotalEventCount();
    const pod2EventCount = totalEvents - pod1EventCount;
    console.log(`Pod 2 processed ${pod2EventCount} events`);

    // Verify: All events processed (no loss)
    expect(totalEvents).toBe(eventCount);

    // Verify: All events succeeded
    const succeededCount = await pool.query(
      "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'succeeded'",
    );
    expect(Number(succeededCount.rows[0].count)).toBe(eventCount);

    // Verify: No duplicate processing (idempotency - each event published exactly once)
    const allEventPayloads = mockServer.requests.flatMap((req) => {
      const body = req.body as {
        events?: Array<{ payload: { orderNumber: number } }>;
      };
      return body.events?.map((e) => e.payload.orderNumber) ?? [];
    });
    const uniqueOrderIds = new Set(allEventPayloads);
    expect(uniqueOrderIds.size).toBe(eventCount);
  });
});
