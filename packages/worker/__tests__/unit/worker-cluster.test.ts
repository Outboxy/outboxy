import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerCluster } from "../../src/core/worker-cluster.js";
import type { Publisher, PublishResult } from "@outboxy/publisher-core";
import type { EventRepository } from "@outboxy/db-adapter-core";
import type { Logger } from "@outboxy/logging";
import { makeConfig, makeLogger, makeRepository } from "./helpers.js";

function makePublisher(): Publisher {
  return {
    publish: vi.fn(async () => new Map<string, PublishResult>()),
    initialize: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  };
}

describe("WorkerCluster", () => {
  let mockRepository: EventRepository;
  let mockLogger: Logger;

  beforeEach(() => {
    mockRepository = makeRepository();
    mockLogger = makeLogger();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("calculatePoolSize", () => {
    it("calculates pool size as (workerCount * 2) + 1", () => {
      expect(WorkerCluster.calculatePoolSize(1)).toBe(3);
      expect(WorkerCluster.calculatePoolSize(2)).toBe(5);
      expect(WorkerCluster.calculatePoolSize(5)).toBe(11);
      expect(WorkerCluster.calculatePoolSize(10)).toBe(21);
    });

    it("returns 1 for workerCount of 0", () => {
      expect(WorkerCluster.calculatePoolSize(0)).toBe(1);
    });
  });

  describe("initial state", () => {
    it("starts with workerCount of 0 before start()", () => {
      const publisherFactory = () => makePublisher();
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 3 },
        mockLogger,
        publisherFactory,
      );

      expect(cluster.getWorkerCount()).toBe(0);
    });

    it("returns not running status before start()", () => {
      const publisherFactory = () => makePublisher();
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 2 },
        mockLogger,
        publisherFactory,
      );

      const status = cluster.getStatus();
      expect(status.running).toBe(false);
      expect(status.workerCount).toBe(0);
      expect(status.workerIds).toEqual([]);
    });
  });

  describe("start", () => {
    it("spawns the correct number of workers", async () => {
      const publishers: Publisher[] = [];
      const publisherFactory = () => {
        const p = makePublisher();
        publishers.push(p);
        return p;
      };

      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 3, workerIdPrefix: "test-cluster" },
        mockLogger,
        publisherFactory,
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      expect(publishers).toHaveLength(3);
    });

    it("calls initialize() on each publisher that has it", async () => {
      const publishers: Publisher[] = [];
      const publisherFactory = () => {
        const p = makePublisher();
        publishers.push(p);
        return p;
      };

      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 2, workerIdPrefix: "test-cluster" },
        mockLogger,
        publisherFactory,
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      for (const publisher of publishers) {
        expect(publisher.initialize).toHaveBeenCalled();
      }
    });

    it("assigns unique worker IDs with prefix-N pattern", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 3, workerIdPrefix: "my-worker" },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);

      const status = cluster.getStatus();
      expect(status.workerIds).toContain("my-worker-0");
      expect(status.workerIds).toContain("my-worker-1");
      expect(status.workerIds).toContain("my-worker-2");

      await cluster.stop();
      await startPromise;
    });

    it("logs starting message with workerCount", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 2, workerIdPrefix: "my-cluster" },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ workerCount: 2 }),
        "Starting WorkerCluster",
      );
    });

    it("warns and returns early if already running", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 1, workerIdPrefix: "my-cluster" },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);

      await cluster.start();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "WorkerCluster already running",
      );

      await cluster.stop();
      await startPromise;
    });

    it("works with publishers without initialize method", async () => {
      const publisherWithoutInit: Publisher = {
        publish: vi.fn(async () => new Map<string, PublishResult>()),
      };

      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 1, workerIdPrefix: "my-cluster" },
        mockLogger,
        () => publisherWithoutInit,
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ workerCount: 1 }),
        "Starting WorkerCluster",
      );
    });
  });

  describe("stop", () => {
    it("warns and returns early if not running", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 1, workerIdPrefix: "my-cluster" },
        mockLogger,
        () => makePublisher(),
      );

      await cluster.stop();

      expect(mockLogger.warn).toHaveBeenCalledWith("WorkerCluster not running");
    });

    it("calls shutdown() on each publisher", async () => {
      const publishers: Publisher[] = [];
      const publisherFactory = () => {
        const p = makePublisher();
        publishers.push(p);
        return p;
      };

      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 2, workerIdPrefix: "test-cluster" },
        mockLogger,
        publisherFactory,
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      for (const publisher of publishers) {
        expect(publisher.shutdown).toHaveBeenCalled();
      }
    });

    it("resets worker and publisher lists after stop", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 2, workerIdPrefix: "test-cluster" },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      expect(cluster.getWorkerCount()).toBe(0);
      expect(cluster.getStatus().workerIds).toEqual([]);
    });

    it("logs stopping and stopped messages", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 1, workerIdPrefix: "test-cluster" },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ workerCount: 1 }),
        "Stopping WorkerCluster",
      );
      expect(mockLogger.info).toHaveBeenCalledWith("WorkerCluster stopped");
    });

    it("handles publisher shutdown errors gracefully", async () => {
      const failingPublisher: Publisher = {
        publish: vi.fn(async () => new Map<string, PublishResult>()),
        initialize: vi.fn(async () => {}),
        shutdown: vi.fn(async () => {
          throw new Error("Shutdown failed");
        }),
      };

      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 1, workerIdPrefix: "test-cluster" },
        mockLogger,
        () => failingPublisher,
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        "Error shutting down publisher",
      );
    });
  });

  describe("getStatus", () => {
    it("returns running=true while workers are active", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 2, workerIdPrefix: "test-cluster" },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);

      const status = cluster.getStatus();
      expect(status.running).toBe(true);
      expect(status.workerCount).toBe(2);

      await cluster.stop();
      await startPromise;
    });

    it("returns running=false after stop", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 1, workerIdPrefix: "test-cluster" },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);
      await cluster.stop();
      await startPromise;

      expect(cluster.getStatus().running).toBe(false);
    });
  });

  describe("workerIdPrefix derivation", () => {
    it("uses provided workerIdPrefix when set", async () => {
      const cluster = new WorkerCluster(
        mockRepository,
        makeConfig(),
        { workerCount: 1, workerIdPrefix: "custom-prefix" },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);

      expect(cluster.getStatus().workerIds[0]).toBe("custom-prefix-0");

      await cluster.stop();
      await startPromise;
    });

    it("derives prefix from config workerId when no prefix set", async () => {
      const config = makeConfig({ workerId: "my-worker-abc12-xyz" });
      const cluster = new WorkerCluster(
        mockRepository,
        config,
        { workerCount: 1 },
        mockLogger,
        () => makePublisher(),
      );

      const startPromise = cluster.start();
      await vi.advanceTimersByTimeAsync(10);

      const workerId = cluster.getStatus().workerIds[0];
      expect(workerId).toMatch(/-0$/);

      await cluster.stop();
      await startPromise;
    });
  });
});
