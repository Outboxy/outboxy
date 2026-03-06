import type { ApiConfig } from "@outboxy/api";

/**
 * Create a test configuration for API server
 *
 * Note: Database configuration is no longer part of ApiConfig.
 * The database adapter is passed separately to createServer().
 */
export function createTestConfig(): ApiConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    logLevel: "error",
    requestTimeoutMs: 30000,
    bodyLimit: 1048576,
    swaggerEnabled: false,
    nodeEnv: "test",
  };
}
