import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock process.exit to prevent test runner from terminating
vi.mock("@outboxy/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@outboxy/logging")>();
  return {
    ...actual,
    loadAndValidateConfig: (
      schema: unknown,
      rawConfig: unknown,
      options: unknown,
    ) => {
      // Re-implement without process.exit for testability
      const { z } = require("zod");
      try {
        return (schema as { parse: (input: unknown) => unknown }).parse(
          rawConfig,
        );
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw error;
        }
        throw error;
      }
    },
  };
});

describe("config", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    // Reset module cache so each test gets fresh config
    vi.resetModules();
  });

  it("should load valid config with all required fields", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/outboxy");
    vi.stubEnv("LOG_LEVEL", "debug");
    vi.stubEnv("DB_POOL_MAX", "30");

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config.databaseUrl).toBe("postgresql://localhost:5432/outboxy");
    expect(config.logLevel).toBe("debug");
    expect(config.dbPoolMax).toBe(30);
  });

  it("should apply defaults for optional fields", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/outboxy");

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config.dbPoolMax).toBe(20);
    expect(config.dbPoolMin).toBe(2);
    expect(config.dbConnectionTimeoutMs).toBe(5000);
    expect(config.dbStatementTimeoutMs).toBe(10000);
    expect(config.logLevel).toBe("info");
    // nodeEnv picks up NODE_ENV from the environment (vitest sets it to "test")
    expect(["development", "test", "production"]).toContain(config.nodeEnv);
  });

  it("should reject missing DATABASE_URL", async () => {
    // DATABASE_URL not set
    const { loadConfig } = await import("../config.js");

    expect(() => loadConfig()).toThrow();
  });

  it("should reject invalid DATABASE_URL (not a URL)", async () => {
    vi.stubEnv("DATABASE_URL", "not-a-url");

    const { loadConfig } = await import("../config.js");

    expect(() => loadConfig()).toThrow();
  });

  it("should coerce numeric string values", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/outboxy");
    vi.stubEnv("DB_POOL_MAX", "50");
    vi.stubEnv("DB_POOL_MIN", "5");
    vi.stubEnv("DB_CONNECTION_TIMEOUT_MS", "10000");
    vi.stubEnv("DB_STATEMENT_TIMEOUT_MS", "20000");

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config.dbPoolMax).toBe(50);
    expect(config.dbPoolMin).toBe(5);
    expect(config.dbConnectionTimeoutMs).toBe(10000);
    expect(config.dbStatementTimeoutMs).toBe(20000);
  });

  it("should accept valid database types", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/outboxy");
    vi.stubEnv("DATABASE_TYPE", "mysql");

    const { loadConfig } = await import("../config.js");
    const config = loadConfig();

    expect(config.databaseType).toBe("mysql");
  });
});
