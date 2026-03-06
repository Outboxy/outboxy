/**
 * M3.5 Graceful Shutdown - Unit Tests
 *
 * Tests the graceful shutdown mechanism that waits for in-flight
 * events to complete before terminating the worker.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "pino";
import { OutboxWorker } from "../../src/core/worker.js";
import type { Publisher, PublishResult } from "@outboxy/publisher-core";
import type { EventRepository } from "@outboxy/db-adapter-core";
import type { WorkerConfig } from "../../src/config.js";

describe("M3.5: Graceful Shutdown - Unit Tests", () => {
  let mockRepository: EventRepository;
  let mockLogger: Logger;
  let mockPublisher: Publisher;
  let config: WorkerConfig;

  beforeEach(() => {
    mockRepository = {
      claimPendingEvents: vi.fn(async () => []),
      getPendingEventCount: vi.fn(async () => 0),
      markSucceeded: vi.fn(async () => {}),
      scheduleRetry: vi.fn(async () => null),
      moveToDLQ: vi.fn(async () => {}),
    } as unknown as EventRepository;

    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => mockLogger),
    } as unknown as Logger;

    mockPublisher = {
      publish: vi.fn(async () => new Map<string, PublishResult>()),
    };

    config = {
      pollIntervalMs: 1000,
      batchSize: 10,
      maxRetries: 5,
      backoffBaseMs: 1000,
      backoffMultiplier: 2,
      logLevel: "error",
      shutdownTimeoutMs: 5000,
      staleEventThresholdMs: 300000,
      staleRecoveryIntervalMs: 60000,
      adaptivePollingEnabled: true,
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
    };

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should return immediately if no in-flight events", async () => {
    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      mockPublisher,
    );

    // Stop worker without starting it (no in-flight events)
    await worker.stop();

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Graceful shutdown complete (not started)",
    );
  });

  it("should force shutdown after timeout", async () => {
    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      mockPublisher,
    );

    // Mock publisher to hang indefinitely
    vi.mocked(mockPublisher.publish).mockImplementation(
      async () => new Promise(() => {}), // Never resolves
    );

    const mockEvents = [
      {
        id: "event-1",
        aggregateType: "Order",
        aggregateId: "order-1",
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
      },
    ];

    vi.mocked(mockRepository.claimPendingEvents).mockResolvedValueOnce(
      mockEvents as any,
    );

    // Start worker
    void worker.start();

    // Wait for poll to start processing
    await vi.advanceTimersByTimeAsync(100);

    // Stop worker
    const stopPromise = worker.stop();

    // Fast-forward past shutdown timeout
    await vi.advanceTimersByTimeAsync(config.shutdownTimeoutMs + 100);

    await stopPromise;

    // Should log forced shutdown
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        remainingCount: 1,
        timeoutMs: config.shutdownTimeoutMs,
      }),
      "Forced shutdown after timeout",
    );
  });

  it("should track in-flight events using Set", async () => {
    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      mockPublisher,
    );

    // Access private inFlightEvents for testing
    const inFlightEvents = (worker as any).inFlightEvents;
    expect(inFlightEvents).toBeInstanceOf(Set);
    expect(inFlightEvents.size).toBe(0);

    // Verify Set is empty initially
    await worker.stop();
    expect(inFlightEvents.size).toBe(0);
  });

  it("should log shutdown initiation", async () => {
    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      mockPublisher,
    );

    await worker.stop();

    expect(mockLogger.info).toHaveBeenCalledWith("Graceful shutdown initiated");
  });

  it("should be async (returns Promise)", async () => {
    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      mockPublisher,
    );

    const stopResult = worker.stop();
    expect(stopResult).toBeInstanceOf(Promise);

    await stopResult;
  });
});
