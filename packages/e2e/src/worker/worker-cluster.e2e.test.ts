/**
 * WorkerCluster E2E Tests
 *
 * Validates:
 * 1. Multiple workers sharing a single pg.Pool
 * 2. SKIP LOCKED coordination between concurrent workers
 * 3. Pool exhaustion prevention
 * 4. Simultaneous graceful shutdown
 * 5. High-concurrency scenarios (5+ workers)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  getTestPgConnectionStringWithSchema,
  waitForEventsProcessed,
  waitForProcessingStarted,
  createMockWebhookServer,
  insertTestEvents,
  type MockWebhookServer,
  type Pool,
} from "@outboxy/testing-utils";
import { createTestWorkerConfig } from "../helpers/worker-config-factory.js";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { createPostgresAdapter } from "@outboxy/db-adapter-postgres";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import { WorkerCluster, createLogger } from "@outboxy/worker";
import { HttpPublisher } from "@outboxy/publisher-http";

describe("WorkerCluster E2E Tests", () => {
  let pool: Pool;
  let adapter: DatabaseAdapter;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let mockServer: MockWebhookServer;

  const logger = createLogger({ service: "outboxy-e2e", level: "error" });

  beforeAll(async () => {
    const isolated = await createIsolatedTestPool({
      name: "worker-cluster-e2e",
    });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    connectionString = getTestPgConnectionStringWithSchema(isolated.schemaName);

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 25,
      logger,
    });

    mockServer = await createMockWebhookServer();
  }, 10000);

  afterAll(async () => {
    await mockServer?.close();
    await adapter?.shutdown();
    await cleanupPool();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events CASCADE");
    mockServer.clearRequests();
  });

  it("should process events with 3 workers sharing a single pool", async () => {
    const eventCount = 100;
    const workerCount = 3;

    await insertTestEvents(pool, eventCount, {
      destinationUrl: mockServer.url,
    });

    const config = createTestWorkerConfig({
      batchSize: 10,
      workerCount,
      adaptivePollingEnabled: false,
    });

    const cluster = new WorkerCluster(
      adapter.eventRepository,
      config,
      { workerCount, workerIdPrefix: "test-cluster" },
      logger,
      () => new HttpPublisher({ timeoutMs: 5000 }, logger),
    );

    void cluster.start();

    await waitForEventsProcessed(pool, eventCount, { timeout: 15000 });

    await cluster.stop();

    const result = await pool.query(
      "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'succeeded'",
    );
    expect(Number(result.rows[0].count)).toBe(eventCount);

    const workerDistribution = await pool.query(`
      SELECT processed_by_worker, COUNT(*) as count
      FROM outbox_events
      WHERE processed_by_worker IS NOT NULL
      GROUP BY processed_by_worker
    `);

    expect(workerDistribution.rows.length).toBeGreaterThan(1);
  });

  it("should coordinate 5 workers via SKIP LOCKED (no duplicate processing)", async () => {
    const eventCount = 200;
    const workerCount = 5;

    await insertTestEvents(pool, eventCount, {
      destinationUrl: mockServer.url,
    });

    const config = createTestWorkerConfig({
      batchSize: 5,
      workerCount,
      adaptivePollingEnabled: false,
    });

    const cluster = new WorkerCluster(
      adapter.eventRepository,
      config,
      { workerCount, workerIdPrefix: "skip-locked-test" },
      logger,
      () => new HttpPublisher({ timeoutMs: 5000 }, logger),
    );

    void cluster.start();

    await waitForEventsProcessed(pool, eventCount, { timeout: 20000 });

    await cluster.stop();

    expect(mockServer.requests.length).toBeLessThanOrEqual(eventCount);
    expect(mockServer.requests.length).toBeGreaterThan(0);

    const result = await pool.query(
      "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'succeeded'",
    );
    expect(Number(result.rows[0].count)).toBe(eventCount);
  });

  it("should handle pool exhaustion gracefully with limited connections", async () => {
    // Create a limited adapter using the same schema-aware connection string
    const limitedAdapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 5,
      logger,
    });

    try {
      const eventCount = 50;
      const workerCount = 10;

      const values: string[] = [];
      const params: unknown[] = [];

      for (let i = 0; i < eventCount; i++) {
        const offset = params.length;
        values.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`,
        );
        params.push(
          "Order",
          `order-${i}`,
          "OrderCreated",
          JSON.stringify({ orderNumber: i }),
          mockServer.url,
        );
      }

      // Use main pool (same isolated schema)
      await pool.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, destination_url
        ) VALUES ${values.join(", ")}`,
        params,
      );

      const limitedConfig = createTestWorkerConfig({
        batchSize: 5,
        workerCount,
        adaptivePollingEnabled: false,
      });

      const cluster = new WorkerCluster(
        limitedAdapter.eventRepository,
        limitedConfig,
        { workerCount, workerIdPrefix: "pool-exhaust" },
        logger,
        () => new HttpPublisher({ timeoutMs: 5000 }, logger),
      );

      void cluster.start();

      await waitForEventsProcessed(pool, eventCount, { timeout: 30000 });

      await cluster.stop();

      const result = await pool.query(
        "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'succeeded'",
      );
      expect(Number(result.rows[0].count)).toBe(eventCount);
    } finally {
      await limitedAdapter.shutdown();
    }
  });

  it("should shutdown all workers simultaneously without data loss", async () => {
    const eventCount = 100;
    const workerCount = 5;

    await insertTestEvents(pool, eventCount, {
      destinationUrl: mockServer.url,
    });

    const config = createTestWorkerConfig({
      batchSize: 5,
      shutdownTimeoutMs: 10000,
      workerCount,
      adaptivePollingEnabled: false,
    });

    const cluster = new WorkerCluster(
      adapter.eventRepository,
      config,
      { workerCount, workerIdPrefix: "shutdown-test" },
      logger,
      () => new HttpPublisher({ timeoutMs: 5000 }, logger),
    );

    void cluster.start();

    // Wait for some events to start processing before testing shutdown
    await waitForProcessingStarted(pool, { timeout: 10000 });

    await cluster.stop();

    const processingResult = await pool.query(
      "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'processing'",
    );
    expect(Number(processingResult.rows[0].count)).toBe(0);
  });

  it("should calculate correct pool size based on worker count", () => {
    expect(WorkerCluster.calculatePoolSize(1)).toBe(3);
    expect(WorkerCluster.calculatePoolSize(3)).toBe(7);
    expect(WorkerCluster.calculatePoolSize(5)).toBe(11);
    expect(WorkerCluster.calculatePoolSize(10)).toBe(21);
  });

  it("should bypass locked events via SKIP LOCKED (other workers continue)", async () => {
    await insertTestEvents(pool, 20, { destinationUrl: mockServer.url });

    const lockingClient = await pool.connect();
    try {
      await lockingClient.query("BEGIN");
      await lockingClient.query(`
        SELECT * FROM outbox_events
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE
      `);

      const config = createTestWorkerConfig({
        batchSize: 5,
        workerCount: 2,
        adaptivePollingEnabled: false,
      });

      const cluster = new WorkerCluster(
        adapter.eventRepository,
        config,
        { workerCount: 2, workerIdPrefix: "skip-locked-bypass" },
        logger,
        () => new HttpPublisher({ timeoutMs: 5000 }, logger),
      );

      void cluster.start();

      // Wait for 19 events to be processed (1 is locked by test)
      await waitForEventsProcessed(pool, 19, {
        timeout: 10000,
        status: "succeeded",
      });

      await cluster.stop();

      const succeededResult = await pool.query(
        "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'succeeded'",
      );
      expect(Number(succeededResult.rows[0].count)).toBe(19);

      await lockingClient.query("ROLLBACK");
    } finally {
      lockingClient.release();
    }
  });

  it("should handle partial batch failure with mixed results", async () => {
    let failCount = 0;
    const partialFailServer = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          JSON.parse(Buffer.concat(chunks).toString());

          if (failCount % 3 === 0) {
            failCount++;
            res.writeHead(500);
            res.end("Simulated failure");
          } else {
            failCount++;
            res.writeHead(200);
            res.end("OK");
          }
        });
      },
    );

    const partialFailUrl = await new Promise<string>((resolve) => {
      partialFailServer.listen(0, "127.0.0.1", () => {
        const addr = partialFailServer.address() as AddressInfo;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });

    try {
      const eventCount = 30;
      const values: string[] = [];
      const params: unknown[] = [];

      for (let i = 0; i < eventCount; i++) {
        const offset = params.length;
        values.push(
          `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`,
        );
        params.push(
          "Order",
          `order-${i}`,
          "OrderCreated",
          JSON.stringify({ orderNumber: i }),
          partialFailUrl,
        );
      }

      await pool.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, destination_url
        ) VALUES ${values.join(", ")}`,
        params,
      );

      const config = createTestWorkerConfig({
        batchSize: 10,
        workerCount: 1,
        maxRetries: 1,
        adaptivePollingEnabled: false,
      });

      const cluster = new WorkerCluster(
        adapter.eventRepository,
        config,
        { workerCount: 1, workerIdPrefix: "partial-fail" },
        logger,
        () => new HttpPublisher({ timeoutMs: 5000 }, logger),
      );

      void cluster.start();

      // Wait for all events to be processed (mixed statuses expected)
      await waitForEventsProcessed(pool, 30, {
        timeout: 15000,
        status: ["succeeded", "failed", "dlq"],
      });

      await cluster.stop();

      const statusResult = await pool.query(`
        SELECT status, COUNT(*) as count
        FROM outbox_events
        GROUP BY status
      `);

      const statusCounts = new Map<string, number>(
        statusResult.rows.map((r: { status: string; count: string }) => [
          r.status,
          Number(r.count),
        ]),
      );

      const succeeded = statusCounts.get("succeeded") ?? 0;
      const failed = statusCounts.get("failed") ?? 0;
      const dlq = statusCounts.get("dlq") ?? 0;

      expect(succeeded).toBeGreaterThan(0);
      expect(failed + dlq).toBeGreaterThan(0);
    } finally {
      partialFailServer.close();
    }
  });

  it("should shutdown 10+ workers simultaneously without hanging", async () => {
    const workerCount = 12;

    await insertTestEvents(pool, 50, { destinationUrl: mockServer.url });

    const config = createTestWorkerConfig({
      batchSize: 5,
      shutdownTimeoutMs: 10000,
      workerCount,
      adaptivePollingEnabled: false,
    });

    const cluster = new WorkerCluster(
      adapter.eventRepository,
      config,
      { workerCount, workerIdPrefix: "many-workers" },
      logger,
      () => new HttpPublisher({ timeoutMs: 5000 }, logger),
    );

    void cluster.start();

    // Wait for processing to start before testing shutdown
    await waitForProcessingStarted(pool, { timeout: 10000 });

    expect(cluster.getWorkerCount()).toBe(workerCount);

    const shutdownStart = Date.now();
    await cluster.stop();
    const shutdownDuration = Date.now() - shutdownStart;

    expect(shutdownDuration).toBeLessThan(10000);
    expect(cluster.getWorkerCount()).toBe(0);

    const processingResult = await pool.query(
      "SELECT COUNT(*) as count FROM outbox_events WHERE status = 'processing'",
    );
    expect(Number(processingResult.rows[0].count)).toBe(0);
  });
});
