import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useSignalListenerCleanup,
  mockProcessExit,
  createMockLogger,
  findSignalHandler,
} from "./helpers.js";

const mockServerListen = vi.fn().mockResolvedValue(undefined);
const mockServerClose = vi.fn().mockResolvedValue(undefined);
const mockAdapterShutdown = vi.fn().mockResolvedValue(undefined);

const mockServer = {
  listen: mockServerListen,
  close: mockServerClose,
};

const mockAdapter = {
  shutdown: mockAdapterShutdown,
};

const mockLogger = createMockLogger();

vi.mock("@outboxy/logging", () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger),
}));

vi.mock("@outboxy/api", () => ({
  createServer: vi.fn().mockResolvedValue(mockServer),
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
  loadApiConfig: vi.fn().mockReturnValue({
    port: 3000,
    host: "0.0.0.0",
    swaggerEnabled: false,
    corsOrigins: [],
    requestLogLevel: "info",
  }),
}));

vi.mock("../adapter-factory.js", () => ({
  createDatabaseAdapter: vi.fn().mockResolvedValue(mockAdapter),
}));

describe("cli/api - apiMain", () => {
  useSignalListenerCleanup();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should start the API server successfully", async () => {
    const { apiMain } = await import("../cli/api.js");

    await apiMain();

    expect(mockServerListen).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000 }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000 }),
      expect.stringContaining("listening"),
    );
  });

  it("should create database adapter with server config values", async () => {
    const { createDatabaseAdapter } = await import("../adapter-factory.js");
    const { apiMain } = await import("../cli/api.js");

    await apiMain();

    expect(createDatabaseAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: "postgresql://localhost:5432/testdb",
        maxConnections: 20,
      }),
    );
  });

  it("should create logger with service name outboxy-api", async () => {
    const { createLogger } = await import("@outboxy/logging");
    const { apiMain } = await import("../cli/api.js");

    await apiMain();

    expect(createLogger).toHaveBeenCalledWith(
      expect.objectContaining({ service: "outboxy-api" }),
    );
  });

  it("should close server and shutdown adapter on SIGTERM", async () => {
    const exitSpy = mockProcessExit();
    const onSpy = vi.spyOn(process, "on");
    const { apiMain } = await import("../cli/api.js");

    await apiMain();

    const handler = findSignalHandler<() => Promise<void>>(onSpy, "SIGTERM");
    await handler();

    expect(mockServerClose).toHaveBeenCalled();
    expect(mockAdapterShutdown).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("should exit with code 1 when shutdown fails", async () => {
    mockServerClose.mockRejectedValueOnce(new Error("Close failed"));
    const exitSpy = mockProcessExit();
    const onSpy = vi.spyOn(process, "on");
    const { apiMain } = await import("../cli/api.js");

    await apiMain();

    const handler = findSignalHandler<() => Promise<void>>(onSpy, "SIGTERM");
    await handler();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("should exit with code 1 when unhandledRejection fires", async () => {
    const exitSpy = mockProcessExit();
    const onSpy = vi.spyOn(process, "on");
    const { apiMain } = await import("../cli/api.js");

    await apiMain();

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
    const { apiMain } = await import("../cli/api.js");

    await apiMain();

    const handler = findSignalHandler<(error: Error) => void>(
      onSpy,
      "uncaughtException",
    );
    handler(new Error("uncaught"));

    expect(mockLogger.fatal).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
