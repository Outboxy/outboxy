/**
 * Load test runner
 *
 * Core test execution logic extracted from Vitest performance tests.
 */

import type { Pool } from "pg";
import { createLogger, type Logger } from "@outboxy/logging";
import type { Publisher } from "@outboxy/publisher-core";
import { createPostgresAdapter } from "@outboxy/db-adapter-postgres";
import { HttpPublisher } from "@outboxy/publisher-http";
import { Registry } from "prom-client";
import {
  createWorkerMetrics,
  createMetricsServer,
  type WorkerMetrics,
} from "@outboxy/worker";
import type { WorkerConfig } from "../config.js";
import {
  calculateMetrics,
  queryLatenciesFromDb,
  queryTestTimeWindow,
  validateThreshold,
  type PerformanceMetrics,
  type ThresholdResult,
} from "./metrics.js";
import { createMockServer, type MockServer } from "./mock-server.js";
import {
  reportProgress,
  updateConcurrentProgress,
  finishProgressBar,
  reportResult,
  createTestResult,
  type OutputFormat,
} from "./reporter.js";
import {
  createMultiWorkerContext,
  startAllWorkers,
  stopAllWorkers,
  getWorkerDistribution,
  formatWorkerDistribution,
} from "./multi-worker-runner.js";

export interface LoadTestConfig {
  eventCount: number;
  thresholdEventsPerSec: number;
  batchSize: number;
  pollIntervalMs: number;
  timeoutMs: number;
  outputFormat: OutputFormat;
  workerCount: number;
  insertRate: number;
  insertBatchSize: number;
}

export interface LoadTestResult {
  metrics: PerformanceMetrics;
  thresholdResult: ThresholdResult;
  passed: boolean;
}

const DEFAULT_CONFIG: LoadTestConfig = {
  eventCount: 10000,
  thresholdEventsPerSec: 100,
  batchSize: 100,
  pollIntervalMs: 50,
  timeoutMs: 3600000,
  outputFormat: "human",
  workerCount: 1,
  insertRate: 0,
  insertBatchSize: 100,
};

/**
 * Truncate outbox_events table to ensure clean state
 */
async function truncateEvents(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE TABLE outbox_events RESTART IDENTITY CASCADE");
}

/**
 * Insert a single batch of events via multi-row INSERT
 */
async function insertBatch(
  pool: Pool,
  batchSize: number,
  destinationUrl: string,
  offset: number,
): Promise<void> {
  const values: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < batchSize; i++) {
    const eventNum = offset + i;
    const paramOffset = params.length;
    values.push(
      `($${paramOffset + 1}, $${paramOffset + 2}, $${paramOffset + 3}, $${paramOffset + 4}, $${paramOffset + 5})`,
    );
    params.push(
      "Order",
      `order-${eventNum}`,
      "OrderCreated",
      JSON.stringify({ orderNumber: eventNum }),
      destinationUrl,
    );
  }

  await pool.query(
    `INSERT INTO outbox_events (
      aggregate_type, aggregate_id, event_type, payload, destination_url
    ) VALUES ${values.join(", ")}`,
    params,
  );
}

export interface EventInserter {
  readonly insertedCount: number;
  readonly done: boolean;
  start: () => void;
  stop: () => void;
  waitUntilDone: () => Promise<void>;
}

/**
 * Creates a concurrent event inserter that feeds events into the DB
 * while workers are already processing.
 *
 * insertRate = 0 → burst mode (as fast as possible)
 * insertRate > 0 → rate-limited (events/sec)
 */
function createEventInserter(
  pool: Pool,
  eventCount: number,
  destinationUrl: string,
  insertRate: number,
  insertBatchSize: number,
): EventInserter {
  let _insertedCount = 0;
  let _done = false;
  let _stopped = false;
  let _resolveWait: (() => void) | null = null;
  const _waitPromise = new Promise<void>((resolve) => {
    _resolveWait = resolve;
  });

  async function runInsertLoop(): Promise<void> {
    while (_insertedCount < eventCount && !_stopped) {
      const remaining = eventCount - _insertedCount;
      const currentBatchSize = Math.min(insertBatchSize, remaining);

      await insertBatch(pool, currentBatchSize, destinationUrl, _insertedCount);
      _insertedCount += currentBatchSize;

      // Rate limiting: sleep between batches to achieve target events/sec
      if (insertRate > 0 && _insertedCount < eventCount && !_stopped) {
        const delayMs = (currentBatchSize / insertRate) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    _done = true;
    _resolveWait?.();
  }

  return {
    get insertedCount() {
      return _insertedCount;
    },
    get done() {
      return _done;
    },
    start() {
      void runInsertLoop();
    },
    stop() {
      _stopped = true;
    },
    waitUntilDone() {
      return _waitPromise;
    },
  };
}

/**
 * Monitor event processing progress with concurrent insert/process display
 */
async function monitorProgress(
  pool: Pool,
  eventCount: number,
  inserter: EventInserter,
  timeoutMs: number,
  format: OutputFormat,
): Promise<{
  processedCount: number;
  failedCount: number;
  durationMs: number;
}> {
  const startTime = Date.now();
  let processedCount = 0;
  let failedCount = 0;

  while (
    processedCount + failedCount < eventCount &&
    Date.now() - startTime < timeoutMs
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'succeeded') as succeeded,
        COUNT(*) FILTER (WHERE status = 'dlq') as failed
      FROM outbox_events
    `);

    processedCount = Number(result.rows[0].succeeded);
    failedCount = Number(result.rows[0].failed);

    updateConcurrentProgress(
      inserter.insertedCount,
      processedCount + failedCount,
      eventCount,
      format,
    );
  }
  finishProgressBar(format);

  return {
    processedCount,
    failedCount,
    durationMs: Date.now() - startTime,
  };
}

const METRICS_PORT = 9090;

/**
 * Run a load test with the specified configuration
 */
export async function runLoadTest(
  pool: Pool,
  connectionString: string,
  config: Partial<LoadTestConfig> = {},
): Promise<LoadTestResult> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const {
    eventCount,
    thresholdEventsPerSec,
    batchSize,
    timeoutMs,
    outputFormat,
    workerCount,
    insertRate,
    insertBatchSize,
  } = finalConfig;

  const rateLabel = insertRate > 0 ? `${insertRate} events/sec` : "burst mode";
  reportProgress(
    "\uD83D\uDE80",
    `Starting load test: ${eventCount.toLocaleString()} events, ${workerCount} worker(s), insert rate: ${rateLabel}`,
    outputFormat,
  );

  let mockServer: MockServer | null = null;
  let adapter: Awaited<ReturnType<typeof createPostgresAdapter>> | null = null;
  let metricsServer: Awaited<ReturnType<typeof createMetricsServer>> | null =
    null;
  let inserter: EventInserter | null = null;

  try {
    await truncateEvents(pool);

    mockServer = await createMockServer();
    reportProgress(
      "\u2705",
      `Mock webhook server started at ${mockServer.url}`,
      outputFormat,
    );

    const logger = createLogger({
      service: "outboxy-load-test",
      level: "error",
    });

    let workerMetrics: WorkerMetrics | undefined;
    try {
      const metricsRegistry = new Registry();
      workerMetrics = createWorkerMetrics(metricsRegistry);
      metricsServer = createMetricsServer(
        { port: METRICS_PORT, host: "0.0.0.0", path: "/metrics" },
        logger,
        metricsRegistry,
      );
      await metricsServer.start();
      reportProgress(
        "\u2705",
        `Metrics server started at http://0.0.0.0:${METRICS_PORT}/metrics`,
        outputFormat,
      );
    } catch {
      // Port may already be in use — continue without metrics
      workerMetrics = undefined;
      metricsServer = null;
    }

    adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: workerCount * 2 + 1,
      logger,
    });

    const publisherFactory = (workerLogger: Logger): Publisher =>
      new HttpPublisher({ timeoutMs: 5000 }, workerLogger);

    const workerConfig: WorkerConfig = {
      pollIntervalMs: 10,
      batchSize,
      maxRetries: 5,
      backoffBaseMs: 1000,
      backoffMultiplier: 2,
      logLevel: "error",
      shutdownTimeoutMs: 30000,
      staleEventThresholdMs: 300000,
      staleRecoveryIntervalMs: 60000,
      adaptivePollingEnabled: false,
      adaptivePollingMinPollIntervalMs: 100,
      adaptivePollingMaxPollIntervalMs: 5000,
      adaptivePollingBusyThreshold: 50,
      adaptivePollingModerateThreshold: 10,
      metricsEnabled: true,
      metricsPort: METRICS_PORT,
      metricsHost: "0.0.0.0",
      metricsPath: "/metrics",
      workerCount: 1,
      idempotencyCleanupEnabled: false,
      idempotencyCleanupIntervalMs: 86400000,
      idempotencyRetentionDays: 30,
      inboxCleanupEnabled: false,
      inboxCleanupIntervalMs: 86400000,
      inboxRetentionDays: 30,
    };

    // Workers start first, polling an empty table until events arrive
    reportProgress(
      "\uD83D\uDD04",
      `Starting ${workerCount} worker(s)...`,
      outputFormat,
    );
    mockServer.reset();

    const workerContext = createMultiWorkerContext(
      adapter.eventRepository,
      workerCount,
      workerConfig,
      logger,
      publisherFactory,
      workerMetrics,
    );
    startAllWorkers(workerContext);
    reportProgress(
      "\u2705",
      `${workerCount} worker(s) started, polling for events`,
      outputFormat,
    );

    inserter = createEventInserter(
      pool,
      eventCount,
      mockServer.url,
      insertRate,
      insertBatchSize,
    );
    reportProgress(
      "\uD83D\uDCDD",
      `Inserting ${eventCount.toLocaleString()} events (${rateLabel})...`,
      outputFormat,
    );
    inserter.start();

    const { processedCount, failedCount, durationMs } = await monitorProgress(
      pool,
      eventCount,
      inserter,
      timeoutMs,
      outputFormat,
    );

    inserter.stop();
    await stopAllWorkers(workerContext);

    // DB timestamps give accurate duration, excluding monitoring poll overhead
    const timeWindow = await queryTestTimeWindow(pool);
    const accurateDurationMs = timeWindow
      ? timeWindow.endMs - timeWindow.startMs
      : durationMs;

    reportProgress(
      "\uD83D\uDCCA",
      "Calculating latency from DB timestamps...",
      outputFormat,
    );
    const latencies = await queryLatenciesFromDb(pool);

    const metrics = calculateMetrics(
      eventCount,
      processedCount,
      failedCount,
      accurateDurationMs,
      latencies,
    );
    const thresholdResult = validateThreshold(metrics, thresholdEventsPerSec);

    const distribution = await getWorkerDistribution(pool);
    if (distribution.size > 0) {
      reportProgress("\uD83D\uDCCA", "Worker Distribution:", outputFormat);
      for (const line of formatWorkerDistribution(distribution)) {
        reportProgress("  ", line, outputFormat);
      }
    }

    const testResult = createTestResult(
      `${eventCount.toLocaleString()} Events Load Test (${workerCount} worker${workerCount > 1 ? "s" : ""})`,
      metrics,
      thresholdResult,
    );

    reportResult(testResult, outputFormat);

    return {
      metrics,
      thresholdResult,
      passed: thresholdResult.passed,
    };
  } finally {
    if (inserter) {
      inserter.stop();
    }
    if (adapter) {
      await adapter.shutdown();
    }
    if (metricsServer) {
      await metricsServer.stop();
    }
    if (mockServer) {
      await mockServer.close();
    }
  }
}
