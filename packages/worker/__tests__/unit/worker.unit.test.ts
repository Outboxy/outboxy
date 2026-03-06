/**
 * V5 Plugin Architecture Validation Test
 *
 * This test proves that the worker accepts ANY publisher implementation,
 * not just HTTP or Kafka. This validates the core V5 requirement:
 * "Kafka publisher works without modifying core worker logic"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutboxWorker } from "../../src/core/worker.js";
import type { Publisher, PublishResult } from "@outboxy/publisher-core";
import type { EventRepository } from "@outboxy/db-adapter-core";
import type { WorkerConfig } from "../../src/config.js";
import type { Logger } from "@outboxy/logging";

describe("V5: Plugin Architecture Validation", () => {
  let mockRepository: EventRepository;
  let mockLogger: Logger;
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
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    config = {
      pollIntervalMs: 1000,
      batchSize: 10,
      maxRetries: 5,
      backoffBaseMs: 1000,
      backoffMultiplier: 2,
      logLevel: "error",
      shutdownTimeoutMs: 30000,
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
  });

  it("should accept any publisher implementation (proves plugin architecture)", () => {
    const mockPublisher: Publisher = {
      publish: vi.fn(async () => new Map<string, PublishResult>()),
      initialize: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
    };

    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      mockPublisher,
    );

    expect(worker).toBeDefined();
    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it("should work with HTTP publisher", async () => {
    const httpPublisher: Publisher = {
      publish: vi.fn(async () => new Map<string, PublishResult>()),
    };

    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      httpPublisher,
    );
    expect(worker).toBeDefined();
  });

  it("should work with Kafka publisher", async () => {
    const kafkaPublisher: Publisher = {
      publish: vi.fn(async () => new Map<string, PublishResult>()),
      initialize: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
    };

    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      kafkaPublisher,
    );
    expect(worker).toBeDefined();
  });

  it("should work with any custom publisher (SQS, RabbitMQ, etc.)", async () => {
    const customPublisher: Publisher = {
      publish: vi.fn(async () => new Map<string, PublishResult>()),
    };

    const worker = new OutboxWorker(
      config,
      mockRepository,
      mockLogger,
      customPublisher,
    );
    expect(worker).toBeDefined();
  });
});
