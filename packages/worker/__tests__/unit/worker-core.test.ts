import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OutboxWorker } from "../../src/core/worker.js";
import type { Publisher, PublishResult } from "@outboxy/publisher-core";
import type { EventRepository } from "@outboxy/db-adapter-core";
import type { Logger } from "@outboxy/logging";
import {
  makeConfig,
  makeLogger,
  makeRepository,
  makeEvent,
  makeMetrics,
} from "./helpers.js";

describe("OutboxWorker", () => {
  let mockRepository: EventRepository;
  let mockLogger: Logger;
  let mockPublisher: Publisher;

  beforeEach(() => {
    mockRepository = makeRepository();
    mockLogger = makeLogger();
    mockPublisher = {
      publish: vi.fn(async () => new Map<string, PublishResult>()),
    };
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("getWorkerId", () => {
    it("returns the provided worker ID", () => {
      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker-1",
      );
      expect(worker.getWorkerId()).toBe("test-worker-1");
    });

    it("auto-generates a worker ID when none provided", () => {
      const config = makeConfig({ workerId: undefined });
      const worker = new OutboxWorker(
        config,
        mockRepository,
        mockLogger,
        mockPublisher,
      );
      expect(worker.getWorkerId()).toBeDefined();
      expect(typeof worker.getWorkerId()).toBe("string");
    });

    it("uses config workerId when provided", () => {
      const config = makeConfig({ workerId: "config-worker-id" });
      const worker = new OutboxWorker(
        config,
        mockRepository,
        mockLogger,
        mockPublisher,
      );
      expect(worker.getWorkerId()).toBe("config-worker-id");
    });
  });

  describe("start", () => {
    it("logs worker started message", async () => {
      vi.mocked(mockRepository.claimPendingEvents).mockResolvedValue([]);
      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(10);
      await worker.stop();

      expect(mockLogger.info).toHaveBeenCalledWith("Worker started");
    });

    it("sets batchSizeConfig metric on start", async () => {
      const metrics = makeMetrics();
      const config = makeConfig({ batchSize: 25 });
      vi.mocked(mockRepository.claimPendingEvents).mockResolvedValue([]);

      const worker = new OutboxWorker(
        config,
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(10);
      await worker.stop();

      expect(metrics.batchSizeConfig.set).toHaveBeenCalledWith(
        { worker_id: "test-worker" },
        25,
      );
    });

    it("calls getPendingEventCount when metrics are provided", async () => {
      const metrics = makeMetrics();
      vi.mocked(mockRepository.claimPendingEvents).mockResolvedValue([]);

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(10);
      await worker.stop();

      expect(mockRepository.getPendingEventCount).toHaveBeenCalled();
    });

    it("does not call getPendingEventCount when metrics are not provided", async () => {
      vi.mocked(mockRepository.claimPendingEvents).mockResolvedValue([]);

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(10);
      await worker.stop();

      expect(mockRepository.getPendingEventCount).not.toHaveBeenCalled();
    });
  });

  describe("poll loop — successful events", () => {
    it("calls claimPendingEvents and markSucceeded on success", async () => {
      const event = makeEvent("event-1");
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      const publishResult = new Map<string, PublishResult>([
        ["event-1", { success: true, retryable: false, durationMs: 50 }],
      ]);
      vi.mocked(mockPublisher.publish).mockResolvedValue(publishResult);

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockRepository.markSucceeded).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            eventId: "event-1",
            workerId: "test-worker",
          }),
        ]),
      );
    });

    it("logs event published successfully", async () => {
      const event = makeEvent("event-1");
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          ["event-1", { success: true, retryable: false, durationMs: 10 }],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "event-1" }),
        "Event published successfully",
      );
    });

    it("records success metrics when metrics are provided", async () => {
      const metrics = makeMetrics();
      const event = makeEvent("event-1");
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          ["event-1", { success: true, retryable: false, durationMs: 50 }],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(metrics.eventsPublished.inc).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_type: "http",
          event_type: "OrderCreated",
          aggregate_type: "Order",
          worker_id: "test-worker",
        }),
      );
    });
  });

  describe("poll loop — retryable failures", () => {
    it("calls scheduleRetry when event fails with retryable error", async () => {
      const event = makeEvent("event-1", { retryCount: 0 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          [
            "event-1",
            {
              success: false,
              retryable: true,
              error: new Error("HTTP 500"),
            },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockRepository.scheduleRetry).toHaveBeenCalledWith(
        ["event-1"],
        expect.any(Map),
        expect.objectContaining({ backoffBaseMs: 1000, backoffMultiplier: 2 }),
      );
    });

    it("logs retry scheduled for retryable failure", async () => {
      const event = makeEvent("event-1", { retryCount: 1 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          [
            "event-1",
            {
              success: false,
              retryable: true,
              error: new Error("Connection refused"),
            },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "event-1", retryCount: 2 }),
        "Event retry scheduled",
      );
    });

    it("records retry metrics", async () => {
      const metrics = makeMetrics();
      const event = makeEvent("event-1", { retryCount: 1 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          [
            "event-1",
            {
              success: false,
              retryable: true,
              error: new Error("Timeout"),
            },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(metrics.eventsRetried.inc).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_type: "http",
          event_type: "OrderCreated",
          aggregate_type: "Order",
          retry_count: "2",
          worker_id: "test-worker",
        }),
      );
    });
  });

  describe("poll loop — DLQ routing", () => {
    it("calls moveToDLQ when event exceeds maxRetries", async () => {
      const event = makeEvent("event-1", { retryCount: 5 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          [
            "event-1",
            {
              success: false,
              retryable: true,
              error: new Error("HTTP 500"),
            },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig({ maxRetries: 5 }),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockRepository.moveToDLQ).toHaveBeenCalledWith(
        ["event-1"],
        expect.any(Map),
      );
    });

    it("calls moveToDLQ for non-retryable failures", async () => {
      const event = makeEvent("event-1", { retryCount: 0 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          [
            "event-1",
            {
              success: false,
              retryable: false,
              error: new Error("HTTP 400 Bad Request"),
            },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockRepository.moveToDLQ).toHaveBeenCalledWith(
        ["event-1"],
        expect.any(Map),
      );
    });

    it("logs DLQ routing warning", async () => {
      const event = makeEvent("event-1", { retryCount: 5 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          [
            "event-1",
            {
              success: false,
              retryable: true,
              error: new Error("Server error"),
            },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig({ maxRetries: 5 }),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: "event-1" }),
        "Event moved to DLQ",
      );
    });

    it("records DLQ metrics", async () => {
      const metrics = makeMetrics();
      const event = makeEvent("event-1", { retryCount: 5 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          [
            "event-1",
            {
              success: false,
              retryable: true,
              error: new Error("HTTP 500"),
            },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig({ maxRetries: 5 }),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(metrics.eventsDlq.inc).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_type: "http",
          event_type: "OrderCreated",
          aggregate_type: "Order",
          worker_id: "test-worker",
        }),
      );
    });
  });

  describe("poll loop — publisher throws", () => {
    it("handles publisher.publish() throwing an exception", async () => {
      const event = makeEvent("event-1", { retryCount: 0 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockRejectedValue(
        new Error("Publisher crash"),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockRepository.scheduleRetry).toHaveBeenCalled();
    });
  });

  describe("poll loop — polling error handling", () => {
    it("logs error and continues when claimPendingEvents throws", async () => {
      vi.mocked(mockRepository.claimPendingEvents)
        .mockRejectedValueOnce(new Error("DB connection lost"))
        .mockResolvedValue([]);

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Polling failed",
      );
    });
  });

  describe("poll loop — batch size metrics", () => {
    it("observes batchSize metric when events are found", async () => {
      const metrics = makeMetrics();
      const events = [makeEvent("event-1"), makeEvent("event-2")];
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce(events)
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          ["event-1", { success: true, retryable: false }],
          ["event-2", { success: true, retryable: false }],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(metrics.batchSize.observe).toHaveBeenCalledWith(
        { worker_id: "test-worker" },
        2,
      );
    });

    it("does not observe batchSize metric when no events are found", async () => {
      const metrics = makeMetrics();
      vi.mocked(mockRepository.claimPendingEvents).mockResolvedValue([]);

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(metrics.batchSize.observe).not.toHaveBeenCalled();
    });
  });

  describe("poll loop — mixed batch outcomes", () => {
    it("processes a batch with success, retry, and DLQ outcomes", async () => {
      const events = [
        makeEvent("event-1", { retryCount: 0 }),
        makeEvent("event-2", { retryCount: 0 }),
        makeEvent("event-3", { retryCount: 5 }),
      ];
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce(events)
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          ["event-1", { success: true, retryable: false }],
          [
            "event-2",
            { success: false, retryable: true, error: new Error("500") },
          ],
          [
            "event-3",
            { success: false, retryable: true, error: new Error("500") },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig({ maxRetries: 5 }),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockRepository.markSucceeded).toHaveBeenCalledWith([
        { eventId: "event-1", workerId: "test-worker" },
      ]);
      expect(mockRepository.scheduleRetry).toHaveBeenCalledWith(
        ["event-2"],
        expect.any(Map),
        expect.any(Object),
      );
      expect(mockRepository.moveToDLQ).toHaveBeenCalledWith(
        ["event-3"],
        expect.any(Map),
      );
    });
  });

  describe("pendingEventCount error handling", () => {
    it("logs error when getPendingEventCount throws", async () => {
      const metrics = makeMetrics();
      vi.mocked(mockRepository.getPendingEventCount).mockRejectedValue(
        new Error("DB error"),
      );
      vi.mocked(mockRepository.claimPendingEvents).mockResolvedValue([]);

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Failed to update pending event count gauge",
      );
    });
  });

  describe("categorizeError — failure reason classification", () => {
    async function getFailureReason(
      errorMessage: string,
      retryable: boolean,
    ): Promise<string> {
      const metrics = makeMetrics();
      const event = makeEvent("event-1", { retryCount: 0 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          [
            "event-1",
            {
              success: false,
              retryable,
              error: new Error(errorMessage),
            },
          ],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      const call = (metrics.eventsFailed.inc as ReturnType<typeof vi.fn>).mock
        .calls[0]!;
      return call[0].failure_reason as string;
    }

    it("classifies timeout errors", async () => {
      expect(await getFailureReason("Request timeout", true)).toBe("timeout");
    });

    it("classifies timed out errors", async () => {
      expect(await getFailureReason("Operation timed out", true)).toBe(
        "timeout",
      );
    });

    it("classifies connection refused errors", async () => {
      expect(await getFailureReason("ECONNREFUSED localhost:8080", true)).toBe(
        "connection_error",
      );
    });

    it("classifies enotfound errors", async () => {
      expect(await getFailureReason("ENOTFOUND example.com", true)).toBe(
        "connection_error",
      );
    });

    it("classifies connection errors", async () => {
      expect(await getFailureReason("connection reset", true)).toBe(
        "connection_error",
      );
    });

    it("classifies 4xx errors (status 4 pattern)", async () => {
      expect(await getFailureReason("HTTP status 400 Bad Request", false)).toBe(
        "4xx",
      );
    });

    it("classifies 4xx errors (status: 4 pattern)", async () => {
      expect(await getFailureReason("status: 401 Unauthorized", false)).toBe(
        "4xx",
      );
    });

    it("classifies 5xx errors (status 5 pattern)", async () => {
      expect(
        await getFailureReason("HTTP status 500 Internal Server Error", true),
      ).toBe("5xx");
    });

    it("classifies 5xx errors (status: 5 pattern)", async () => {
      expect(
        await getFailureReason("status: 503 Service Unavailable", true),
      ).toBe("5xx");
    });

    it("classifies kafka errors", async () => {
      expect(await getFailureReason("kafka producer error", true)).toBe(
        "kafka_producer",
      );
    });

    it("classifies non-retryable unknown errors as dlq", async () => {
      expect(await getFailureReason("some random error", false)).toBe("dlq");
    });

    it("classifies retryable unknown errors as unknown", async () => {
      expect(await getFailureReason("some random error", true)).toBe("unknown");
    });
  });

  describe("adaptive polling", () => {
    it("records poll interval metric when adaptive polling is enabled", async () => {
      const metrics = makeMetrics();
      const config = makeConfig({
        adaptivePollingEnabled: true,
        adaptivePollingMinPollIntervalMs: 100,
        adaptivePollingMaxPollIntervalMs: 5000,
        adaptivePollingBusyThreshold: 50,
        adaptivePollingModerateThreshold: 10,
        batchSize: 10,
      });

      vi.mocked(mockRepository.claimPendingEvents).mockResolvedValue([]);

      const worker = new OutboxWorker(
        config,
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(metrics.pollInterval.set).toHaveBeenCalledWith(
        { worker_id: "test-worker" },
        expect.any(Number),
      );
    });

    it("does not record poll interval metric when adaptive polling is disabled", async () => {
      const metrics = makeMetrics();
      const config = makeConfig({
        adaptivePollingEnabled: false,
        pollIntervalMs: 2000,
      });

      vi.mocked(mockRepository.claimPendingEvents).mockResolvedValue([]);

      const worker = new OutboxWorker(
        config,
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(metrics.pollInterval.set).not.toHaveBeenCalled();
    });
  });

  describe("event with null destinationType", () => {
    it("defaults destinationType to http when null", async () => {
      const metrics = makeMetrics();
      const event = makeEvent("event-1", {
        destinationType: null as never,
        retryCount: 0,
      });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>([
          ["event-1", { success: true, retryable: false, durationMs: 10 }],
        ]),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        metrics,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(metrics.eventsPublished.inc).toHaveBeenCalledWith(
        expect.objectContaining({ destination_type: "http" }),
      );
    });
  });

  describe("publish result fallback defaults", () => {
    it("handles events not in the publish result map", async () => {
      const event = makeEvent("event-1", { retryCount: 0 });
      vi.mocked(mockRepository.claimPendingEvents)
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);

      vi.mocked(mockPublisher.publish).mockResolvedValue(
        new Map<string, PublishResult>(),
      );

      const worker = new OutboxWorker(
        makeConfig(),
        mockRepository,
        mockLogger,
        mockPublisher,
        undefined,
        "test-worker",
      );

      void worker.start();
      await vi.advanceTimersByTimeAsync(50);
      await worker.stop();

      expect(mockRepository.scheduleRetry).toHaveBeenCalled();
    });
  });
});
