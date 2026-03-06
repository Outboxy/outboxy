import { z } from "zod";
import { loadAndValidateConfig } from "@outboxy/logging";

/**
 * Worker configuration schema
 *
 * Publisher-specific configuration has been moved to individual publisher packages:
 * - @outboxy/publisher-http
 * - @outboxy/publisher-kafka
 */
const workerConfigSchema = z
  .object({
    /** Polling interval in milliseconds */
    pollIntervalMs: z.coerce.number().int().positive().default(1000),

    /** Number of events to process per batch */
    batchSize: z.coerce.number().int().positive().default(10),

    /** Maximum retry attempts for failed events */
    maxRetries: z.coerce.number().int().nonnegative().default(5),

    /** Base delay for exponential backoff in milliseconds */
    backoffBaseMs: z.coerce.number().int().positive().default(1000),

    /** Multiplier for exponential backoff */
    backoffMultiplier: z.coerce.number().positive().default(2),

    /** Logging level */
    logLevel: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal"])
      .default("info"),

    /** Graceful shutdown timeout in milliseconds */
    shutdownTimeoutMs: z.coerce.number().int().positive().default(30000),

    /** Time threshold to consider an event as stale in milliseconds */
    staleEventThresholdMs: z.coerce.number().int().positive().default(300000),

    /** Interval for stale event recovery in milliseconds */
    staleRecoveryIntervalMs: z.coerce.number().int().positive().default(60000),

    /** Enable adaptive polling based on workload */
    adaptivePollingEnabled: z.coerce.boolean().default(true),

    /** Minimum polling interval for adaptive polling in milliseconds */
    adaptivePollingMinPollIntervalMs: z.coerce
      .number()
      .int()
      .positive()
      .default(100),

    /** Maximum polling interval for adaptive polling in milliseconds */
    adaptivePollingMaxPollIntervalMs: z.coerce
      .number()
      .int()
      .positive()
      .default(5000),

    /** Events threshold to consider workload as busy */
    adaptivePollingBusyThreshold: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(50),

    /** Events threshold to consider workload as moderate */
    adaptivePollingModerateThreshold: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(10),

    /** Enable Prometheus metrics server */
    metricsEnabled: z.coerce.boolean().default(true),

    /** Prometheus metrics server port */
    metricsPort: z.coerce.number().int().positive().default(9090),

    /** Prometheus metrics server bind address */
    metricsHost: z.string().default("0.0.0.0"),

    /** Prometheus metrics endpoint path */
    metricsPath: z.string().default("/metrics"),

    /** Worker instance ID (auto-generated if not provided) */
    workerId: z.string().optional(),

    /** Number of worker instances per container */
    workerCount: z.coerce.number().int().positive().default(1),

    /** Prefix for auto-generated worker IDs */
    workerIdPrefix: z.string().optional(),

    /** Enable automatic cleanup of expired idempotency records */
    idempotencyCleanupEnabled: z.coerce.boolean().default(true),

    /** Interval for idempotency cleanup in milliseconds */
    idempotencyCleanupIntervalMs: z.coerce
      .number()
      .int()
      .positive()
      .default(86400000), // 24 hours

    /** Retention period for idempotency records in days */
    idempotencyRetentionDays: z.coerce.number().int().positive().default(30),

    /** Enable automatic cleanup of processed inbox events */
    inboxCleanupEnabled: z.coerce.boolean().default(false),

    /** Interval for inbox cleanup in milliseconds */
    inboxCleanupIntervalMs: z.coerce
      .number()
      .int()
      .positive()
      .default(86400000), // 24 hours

    /** Retention period for processed inbox events in days */
    inboxRetentionDays: z.coerce.number().int().positive().default(30),
  })
  .refine(
    (config) =>
      config.adaptivePollingMinPollIntervalMs <
      config.adaptivePollingMaxPollIntervalMs,
    {
      message:
        "adaptivePollingMinPollIntervalMs must be less than adaptivePollingMaxPollIntervalMs",
    },
  )
  .refine(
    (config) =>
      config.adaptivePollingBusyThreshold >=
      config.adaptivePollingModerateThreshold,
    {
      message:
        "Adaptive polling thresholds must be in descending order (busy >= moderate)",
    },
  );

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadConfig(): WorkerConfig {
  return loadAndValidateConfig(
    workerConfigSchema,
    {
      pollIntervalMs: process.env.POLL_INTERVAL_MS,
      batchSize: process.env.BATCH_SIZE,
      maxRetries: process.env.MAX_RETRIES,
      backoffBaseMs: process.env.BACKOFF_BASE_MS,
      backoffMultiplier: process.env.BACKOFF_MULTIPLIER,
      logLevel: process.env.LOG_LEVEL,
      shutdownTimeoutMs: process.env.SHUTDOWN_TIMEOUT_MS,
      staleEventThresholdMs: process.env.STALE_EVENT_THRESHOLD_MS,
      staleRecoveryIntervalMs: process.env.STALE_RECOVERY_INTERVAL_MS,
      adaptivePollingEnabled: process.env.ADAPTIVE_POLLING_ENABLED,
      adaptivePollingMinPollIntervalMs:
        process.env.ADAPTIVE_POLLING_MIN_POLL_INTERVAL_MS,
      adaptivePollingMaxPollIntervalMs:
        process.env.ADAPTIVE_POLLING_MAX_POLL_INTERVAL_MS,
      adaptivePollingBusyThreshold: process.env.ADAPTIVE_POLLING_BUSY_THRESHOLD,
      adaptivePollingModerateThreshold:
        process.env.ADAPTIVE_POLLING_MODERATE_THRESHOLD,
      metricsEnabled: process.env.METRICS_ENABLED,
      metricsPort: process.env.METRICS_PORT,
      metricsHost: process.env.METRICS_HOST,
      metricsPath: process.env.METRICS_PATH,
      workerId: process.env.WORKER_ID,
      workerCount: process.env.WORKER_COUNT,
      workerIdPrefix: process.env.WORKER_ID_PREFIX,
      idempotencyCleanupEnabled: process.env.IDEMPOTENCY_CLEANUP_ENABLED,
      idempotencyCleanupIntervalMs: process.env.IDEMPOTENCY_CLEANUP_INTERVAL_MS,
      idempotencyRetentionDays: process.env.IDEMPOTENCY_RETENTION_DAYS,
      inboxCleanupEnabled: process.env.INBOX_CLEANUP_ENABLED,
      inboxCleanupIntervalMs: process.env.INBOX_CLEANUP_INTERVAL_MS,
      inboxRetentionDays: process.env.INBOX_RETENTION_DAYS,
    },
    { serviceName: "outboxy-worker" },
  );
}
