import type { WorkerConfig } from "@outboxy/worker";

/**
 * Create a WorkerConfig with test-optimized defaults.
 *
 * Default values are optimized for fast, reliable tests:
 * - pollIntervalMs: 100 (fast polling for quick tests)
 * - batchSize: 10 (reasonable batch for test volumes)
 * - logLevel: "error" (quiet unless errors)
 * - metricsEnabled: false (avoid port conflicts)
 * - adaptivePollingEnabled: true (realistic behavior)
 */
export function createTestWorkerConfig(
  overrides: Partial<WorkerConfig> = {},
): WorkerConfig {
  return {
    pollIntervalMs: 100,
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
    idempotencyCleanupEnabled: false,
    idempotencyCleanupIntervalMs: 86400000,
    idempotencyRetentionDays: 30,
    inboxCleanupEnabled: false,
    inboxCleanupIntervalMs: 86400000,
    inboxRetentionDays: 30,
    ...overrides,
  };
}
