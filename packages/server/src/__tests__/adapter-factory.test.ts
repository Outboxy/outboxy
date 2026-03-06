import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "@outboxy/logging";

const mockPostgresAdapter = {
  eventRepository: {},
  eventService: {},
  maintenance: {},
  getClient: vi.fn(),
  shutdown: vi.fn(),
  healthCheck: vi.fn(),
};

const mockMysqlAdapter = {
  eventRepository: {},
  eventService: {},
  maintenance: {},
  getClient: vi.fn(),
  shutdown: vi.fn(),
  healthCheck: vi.fn(),
};

vi.mock("@outboxy/db-adapter-postgres", () => ({
  createPostgresAdapter: vi.fn().mockResolvedValue(mockPostgresAdapter),
  canHandle: vi.fn(
    (url: string) =>
      url.startsWith("postgresql://") || url.startsWith("postgres://"),
  ),
}));

vi.mock("@outboxy/db-adapter-mysql", () => ({
  createMySQLAdapter: vi.fn().mockResolvedValue(mockMysqlAdapter),
  canHandle: vi.fn(
    (url: string) => url.startsWith("mysql://") || url.startsWith("mysql2://"),
  ),
}));

const mockLogger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: "info",
  silent: vi.fn(),
} as unknown as Logger;

describe("adapter-factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create a PostgreSQL adapter from connection string", async () => {
    const { createDatabaseAdapter } = await import("../adapter-factory.js");

    const adapter = await createDatabaseAdapter({
      connectionString: "postgresql://localhost:5432/outboxy",
      maxConnections: 20,
      logger: mockLogger,
    });

    expect(adapter).toBe(mockPostgresAdapter);
  });

  it("should create a MySQL adapter from connection string", async () => {
    const { createDatabaseAdapter } = await import("../adapter-factory.js");

    const adapter = await createDatabaseAdapter({
      connectionString: "mysql://localhost:3306/outboxy",
      maxConnections: 20,
      logger: mockLogger,
    });

    expect(adapter).toBe(mockMysqlAdapter);
  });

  it("should use explicit databaseType when provided", async () => {
    const { createDatabaseAdapter } = await import("../adapter-factory.js");

    const adapter = await createDatabaseAdapter({
      connectionString: "postgresql://localhost:5432/outboxy",
      databaseType: "postgresql",
      maxConnections: 10,
      logger: mockLogger,
    });

    expect(adapter).toBe(mockPostgresAdapter);
  });

  it("should pass postgres-specific options to adapter", async () => {
    const { createPostgresAdapter } =
      await import("@outboxy/db-adapter-postgres");
    const { createDatabaseAdapter } = await import("../adapter-factory.js");

    await createDatabaseAdapter({
      connectionString: "postgresql://localhost:5432/outboxy",
      maxConnections: 30,
      minConnections: 5,
      connectionTimeoutMs: 10000,
      statementTimeoutMs: 20000,
      logger: mockLogger,
    });

    expect(createPostgresAdapter).toHaveBeenCalledWith({
      connectionString: "postgresql://localhost:5432/outboxy",
      maxConnections: 30,
      minConnections: 5,
      connectionTimeoutMs: 10000,
      statementTimeoutMs: 20000,
      logger: mockLogger,
    });
  });

  it("should throw on unrecognized connection string", async () => {
    const { createDatabaseAdapter } = await import("../adapter-factory.js");

    await expect(
      createDatabaseAdapter({
        connectionString: "redis://localhost:6379",
        maxConnections: 10,
        logger: mockLogger,
      }),
    ).rejects.toThrow();
  });
});
