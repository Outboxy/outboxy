import { vi } from "vitest";
import type { WorkerConfig } from "../../src/config.js";
import type { Logger } from "@outboxy/logging";
import type { EventRepository } from "@outboxy/db-adapter-core";
import type { OutboxEvent } from "@outboxy/publisher-core";
import type { WorkerMetrics } from "../../src/metrics/index.js";

export function makeEvent(
  id: string,
  overrides: Partial<OutboxEvent> = {},
): OutboxEvent {
  return {
    id,
    aggregateType: "Order",
    aggregateId: `order-${id}`,
    eventType: "OrderCreated",
    eventVersion: 1,
    payload: { test: true },
    headers: {},
    destinationUrl: "http://example.com",
    destinationType: "http",
    idempotencyKey: null,
    status: "processing",
    retryCount: 0,
    maxRetries: 5,
    nextRetryAt: null,
    backoffMultiplier: "2.0",
    lastError: null,
    errorDetails: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    processingStartedAt: new Date(),
    processedAt: null,
    metadata: {},
    processedByWorker: null,
    deletedAt: null,
    createdDate: new Date(),
    ...overrides,
  };
}

export function makeMetrics(): WorkerMetrics {
  return {
    eventsPublished: { inc: vi.fn() },
    eventsFailed: { inc: vi.fn() },
    eventsDlq: { inc: vi.fn() },
    eventsRetried: { inc: vi.fn() },
    processingDuration: { observe: vi.fn() },
    batchSize: { observe: vi.fn() },
    pollInterval: { set: vi.fn() },
    pendingEvents: { set: vi.fn() },
    batchSizeConfig: { set: vi.fn() },
    staleEventsRecovered: { inc: vi.fn() },
    idempotencyKeysCleaned: { inc: vi.fn() },
    inboxEventsCleaned: { inc: vi.fn() },
  } as unknown as WorkerMetrics;
}

export function makeConfig(
  overrides: Partial<WorkerConfig> = {},
): WorkerConfig {
  return {
    pollIntervalMs: 100,
    batchSize: 10,
    maxRetries: 5,
    backoffBaseMs: 1000,
    backoffMultiplier: 2,
    logLevel: "error",
    shutdownTimeoutMs: 5000,
    staleEventThresholdMs: 300000,
    staleRecoveryIntervalMs: 60000,
    adaptivePollingEnabled: false,
    adaptivePollingMinPollIntervalMs: 100,
    adaptivePollingMaxPollIntervalMs: 5000,
    adaptivePollingBusyThreshold: 50,
    adaptivePollingModerateThreshold: 10,
    metricsEnabled: false,
    metricsPort: 9090,
    metricsHost: "0.0.0.0",
    metricsPath: "/metrics",
    workerCount: 1,
    idempotencyCleanupEnabled: true,
    idempotencyCleanupIntervalMs: 86400000,
    idempotencyRetentionDays: 30,
    inboxCleanupEnabled: false,
    inboxCleanupIntervalMs: 86400000,
    inboxRetentionDays: 30,
    ...overrides,
  };
}

export function makeLogger(): Logger {
  const logger: Logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as unknown as Logger;
  (logger.child as ReturnType<typeof vi.fn>).mockReturnValue(logger);
  return logger;
}

export function makeRepository(): EventRepository {
  return {
    claimPendingEvents: vi.fn(async () => []),
    getPendingEventCount: vi.fn(async () => 0),
    markSucceeded: vi.fn(async () => {}),
    scheduleRetry: vi.fn(async () => null),
    moveToDLQ: vi.fn(async () => {}),
  } as unknown as EventRepository;
}
