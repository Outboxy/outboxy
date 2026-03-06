import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useSignalListenerCleanup,
  mockProcessExit,
  createMockLogger,
  findSignalHandler,
} from "./helpers.js";

const mockWorkerStop = vi.fn().mockResolvedValue(undefined);
const mockAdapterShutdown = vi.fn().mockResolvedValue(undefined);

const mockWorker = {
  stop: mockWorkerStop,
};

const mockAdapter = {
  shutdown: mockAdapterShutdown,
};

const mockPublisher = {
  initialize: vi.fn().mockResolvedValue(undefined),
  shutdown: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(new Map()),
};

const mockLogger = createMockLogger();

vi.mock("@outboxy/logging", () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}));

vi.mock("@outboxy/worker", () => ({
  startWorker: vi.fn().mockResolvedValue(mockWorker),
  WorkerCluster: {
    calculatePoolSize: vi.fn().mockReturnValue(5),
  },
  loadConfig: vi.fn().mockReturnValue({
    pollIntervalMs: 1000,
    batchSize: 10,
    maxRetries: 3,
    workerCount: 1,
  }),
}));

vi.mock("../config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    databaseUrl: "postgresql://localhost:5432/testdb",
    databaseType: "postgresql",
    dbPoolMax: 20,
    dbPoolMin: 2,
    dbConnectionTimeoutMs: 5000,
    dbStatementTimeoutMs: 10000,
    logLevel: "info",
    nodeEnv: "test",
  }),
  loadWorkerConfig: vi.fn().mockReturnValue({
    pollIntervalMs: 1000,
    batchSize: 10,
    maxRetries: 3,
    workerCount: 1,
  }),
}));

vi.mock("../adapter-factory.js", () => ({
  createDatabaseAdapter: vi.fn().mockResolvedValue(mockAdapter),
}));

vi.mock("../publisher-factory.js", () => ({
  createPublisherFromEnv: vi.fn().mockResolvedValue(mockPublisher),
}));

describe("cli/worker - workerMain", () => {
  useSignalListenerCleanup();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.OUTBOXY_PUBLISHER_WRAPPER;
  });

  it("should create database adapter with worker pool size", async () => {
    const { createDatabaseAdapter } = await import("../adapter-factory.js");
    const { workerMain } = await import("../cli/worker.js");

    await workerMain();

    expect(createDatabaseAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: "postgresql://localhost:5432/testdb",
        maxConnections: 5,
      }),
    );
  });

  it("should create logger with service name outboxy-worker", async () => {
    const { createLogger } = await import("@outboxy/logging");
    const { workerMain } = await import("../cli/worker.js");

    await workerMain();

    expect(createLogger).toHaveBeenCalledWith(
      expect.objectContaining({ service: "outboxy-worker" }),
    );
  });

  it("should log the publisher type", async () => {
    const { workerMain } = await import("../cli/worker.js");

    await workerMain();

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ publisherType: "http" }),
      "Creating publisher",
    );
  });

  it("should apply publisher wrapper when OUTBOXY_PUBLISHER_WRAPPER is set", async () => {
    const wrappedPublisher = { ...mockPublisher, wrapped: true };
    const wrapPublisher = vi.fn().mockReturnValue(wrappedPublisher);

    process.env.OUTBOXY_PUBLISHER_WRAPPER = "test-wrapper-module";

    vi.doMock("test-wrapper-module", () => ({ wrapPublisher }), {
      virtual: true,
    });

    const { workerMain } = await import("../cli/worker.js");
    await workerMain();

    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("should log warning when publisher wrapper fails to load", async () => {
    process.env.OUTBOXY_PUBLISHER_WRAPPER = "nonexistent-module-xyz";

    const { workerMain } = await import("../cli/worker.js");
    await workerMain();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ module: "nonexistent-module-xyz" }),
      expect.stringContaining("Failed to load publisher wrapper"),
    );
  });

  it("should stop worker and shutdown adapter on SIGTERM", async () => {
    const exitSpy = mockProcessExit();
    const onSpy = vi.spyOn(process, "on");
    const { workerMain } = await import("../cli/worker.js");

    await workerMain();

    const handler = findSignalHandler<() => Promise<void>>(onSpy, "SIGTERM");
    await handler();

    expect(mockWorkerStop).toHaveBeenCalled();
    expect(mockAdapterShutdown).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should exit with code 1 when worker shutdown fails", async () => {
    mockWorkerStop.mockRejectedValueOnce(new Error("Worker stop failed"));
    const exitSpy = mockProcessExit();
    const onSpy = vi.spyOn(process, "on");
    const { workerMain } = await import("../cli/worker.js");

    await workerMain();

    const handler = findSignalHandler<() => Promise<void>>(onSpy, "SIGTERM");
    await handler();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should exit with code 1 when unhandledRejection fires", async () => {
    const exitSpy = mockProcessExit();
    const onSpy = vi.spyOn(process, "on");
    const { workerMain } = await import("../cli/worker.js");

    await workerMain();

    const handler = findSignalHandler<(reason: unknown) => void>(
      onSpy,
      "unhandledRejection",
    );
    handler(new Error("unhandled"));

    expect(mockLogger.fatal).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should exit with code 1 when uncaughtException fires", async () => {
    const exitSpy = mockProcessExit();
    const onSpy = vi.spyOn(process, "on");
    const { workerMain } = await import("../cli/worker.js");

    await workerMain();

    const handler = findSignalHandler<(error: Error) => void>(
      onSpy,
      "uncaughtException",
    );
    handler(new Error("uncaught"));

    expect(mockLogger.fatal).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
