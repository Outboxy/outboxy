import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { withEnv } from "@outboxy/testing-utils";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const ENV_VARS = [
    "POLL_INTERVAL_MS",
    "BATCH_SIZE",
    "MAX_RETRIES",
    "BACKOFF_BASE_MS",
    "BACKOFF_MULTIPLIER",
    "LOG_LEVEL",
    "SHUTDOWN_TIMEOUT_MS",
    "STALE_EVENT_THRESHOLD_MS",
    "STALE_RECOVERY_INTERVAL_MS",
    "ADAPTIVE_POLLING_ENABLED",
    "ADAPTIVE_POLLING_MIN_POLL_INTERVAL_MS",
    "ADAPTIVE_POLLING_MAX_POLL_INTERVAL_MS",
    "ADAPTIVE_POLLING_BUSY_THRESHOLD",
    "ADAPTIVE_POLLING_MODERATE_THRESHOLD",
    "METRICS_ENABLED",
    "METRICS_PORT",
    "METRICS_HOST",
    "METRICS_PATH",
    "WORKER_ID",
    "WORKER_COUNT",
    "WORKER_ID_PREFIX",
    "IDEMPOTENCY_CLEANUP_ENABLED",
    "IDEMPOTENCY_CLEANUP_INTERVAL_MS",
    "IDEMPOTENCY_RETENTION_DAYS",
    "INBOX_CLEANUP_ENABLED",
    "INBOX_CLEANUP_INTERVAL_MS",
    "INBOX_RETENTION_DAYS",
  ];

  beforeEach(() => {
    for (const key of ENV_VARS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      delete process.env[key];
    }
  });

  describe("defaults", () => {
    it("returns default pollIntervalMs of 1000", () => {
      const config = loadConfig();
      expect(config.pollIntervalMs).toBe(1000);
    });

    it("returns default batchSize of 10", () => {
      const config = loadConfig();
      expect(config.batchSize).toBe(10);
    });

    it("returns default maxRetries of 5", () => {
      const config = loadConfig();
      expect(config.maxRetries).toBe(5);
    });

    it("returns default backoffBaseMs of 1000", () => {
      const config = loadConfig();
      expect(config.backoffBaseMs).toBe(1000);
    });

    it("returns default backoffMultiplier of 2", () => {
      const config = loadConfig();
      expect(config.backoffMultiplier).toBe(2);
    });

    it("returns default logLevel of info", () => {
      const config = loadConfig();
      expect(config.logLevel).toBe("info");
    });

    it("returns default shutdownTimeoutMs of 30000", () => {
      const config = loadConfig();
      expect(config.shutdownTimeoutMs).toBe(30000);
    });

    it("returns default adaptivePollingEnabled of true", () => {
      const config = loadConfig();
      expect(config.adaptivePollingEnabled).toBe(true);
    });

    it("returns default adaptivePollingMinPollIntervalMs of 100", () => {
      const config = loadConfig();
      expect(config.adaptivePollingMinPollIntervalMs).toBe(100);
    });

    it("returns default adaptivePollingMaxPollIntervalMs of 5000", () => {
      const config = loadConfig();
      expect(config.adaptivePollingMaxPollIntervalMs).toBe(5000);
    });

    it("returns default adaptivePollingBusyThreshold of 50", () => {
      const config = loadConfig();
      expect(config.adaptivePollingBusyThreshold).toBe(50);
    });

    it("returns default adaptivePollingModerateThreshold of 10", () => {
      const config = loadConfig();
      expect(config.adaptivePollingModerateThreshold).toBe(10);
    });

    it("returns default metricsEnabled of true", () => {
      const config = loadConfig();
      expect(config.metricsEnabled).toBe(true);
    });

    it("returns default metricsPort of 9090", () => {
      const config = loadConfig();
      expect(config.metricsPort).toBe(9090);
    });

    it("returns default metricsHost of 0.0.0.0", () => {
      const config = loadConfig();
      expect(config.metricsHost).toBe("0.0.0.0");
    });

    it("returns default metricsPath of /metrics", () => {
      const config = loadConfig();
      expect(config.metricsPath).toBe("/metrics");
    });

    it("returns default workerCount of 1", () => {
      const config = loadConfig();
      expect(config.workerCount).toBe(1);
    });

    it("returns workerId as undefined by default", () => {
      const config = loadConfig();
      expect(config.workerId).toBeUndefined();
    });

    it("returns default idempotencyCleanupEnabled of true", () => {
      const config = loadConfig();
      expect(config.idempotencyCleanupEnabled).toBe(true);
    });

    it("returns default idempotencyCleanupIntervalMs of 86400000", () => {
      const config = loadConfig();
      expect(config.idempotencyCleanupIntervalMs).toBe(86400000);
    });

    it("returns default idempotencyRetentionDays of 30", () => {
      const config = loadConfig();
      expect(config.idempotencyRetentionDays).toBe(30);
    });

    it("returns default inboxCleanupEnabled of false", () => {
      const config = loadConfig();
      expect(config.inboxCleanupEnabled).toBe(false);
    });

    it("returns default inboxCleanupIntervalMs of 86400000", () => {
      const config = loadConfig();
      expect(config.inboxCleanupIntervalMs).toBe(86400000);
    });

    it("returns default inboxRetentionDays of 30", () => {
      const config = loadConfig();
      expect(config.inboxRetentionDays).toBe(30);
    });
  });

  describe("env var parsing", () => {
    it("reads POLL_INTERVAL_MS from environment", () => {
      withEnv({ POLL_INTERVAL_MS: "2000" }, () => {
        const config = loadConfig();
        expect(config.pollIntervalMs).toBe(2000);
      });
    });

    it("reads BATCH_SIZE from environment", () => {
      withEnv({ BATCH_SIZE: "50" }, () => {
        const config = loadConfig();
        expect(config.batchSize).toBe(50);
      });
    });

    it("reads MAX_RETRIES from environment", () => {
      withEnv({ MAX_RETRIES: "10" }, () => {
        const config = loadConfig();
        expect(config.maxRetries).toBe(10);
      });
    });

    it("reads BACKOFF_BASE_MS from environment", () => {
      withEnv({ BACKOFF_BASE_MS: "500" }, () => {
        const config = loadConfig();
        expect(config.backoffBaseMs).toBe(500);
      });
    });

    it("reads BACKOFF_MULTIPLIER from environment", () => {
      withEnv({ BACKOFF_MULTIPLIER: "3" }, () => {
        const config = loadConfig();
        expect(config.backoffMultiplier).toBe(3);
      });
    });

    it("reads LOG_LEVEL from environment", () => {
      withEnv({ LOG_LEVEL: "debug" }, () => {
        const config = loadConfig();
        expect(config.logLevel).toBe("debug");
      });
    });

    it("reads WORKER_ID from environment", () => {
      withEnv({ WORKER_ID: "my-worker-123" }, () => {
        const config = loadConfig();
        expect(config.workerId).toBe("my-worker-123");
      });
    });

    it("reads WORKER_COUNT from environment", () => {
      withEnv({ WORKER_COUNT: "4" }, () => {
        const config = loadConfig();
        expect(config.workerCount).toBe(4);
      });
    });

    it("reads WORKER_ID_PREFIX from environment", () => {
      withEnv({ WORKER_ID_PREFIX: "cluster-a" }, () => {
        const config = loadConfig();
        expect(config.workerIdPrefix).toBe("cluster-a");
      });
    });

    it("reads METRICS_ENABLED=true from environment", () => {
      withEnv({ METRICS_ENABLED: "true" }, () => {
        const config = loadConfig();
        expect(config.metricsEnabled).toBe(true);
      });
    });

    it("reads METRICS_PORT from environment", () => {
      withEnv({ METRICS_PORT: "8080" }, () => {
        const config = loadConfig();
        expect(config.metricsPort).toBe(8080);
      });
    });

    it("reads METRICS_HOST from environment", () => {
      withEnv({ METRICS_HOST: "127.0.0.1" }, () => {
        const config = loadConfig();
        expect(config.metricsHost).toBe("127.0.0.1");
      });
    });

    it("reads METRICS_PATH from environment", () => {
      withEnv({ METRICS_PATH: "/prom" }, () => {
        const config = loadConfig();
        expect(config.metricsPath).toBe("/prom");
      });
    });

    it("reads ADAPTIVE_POLLING_ENABLED=true from environment", () => {
      withEnv({ ADAPTIVE_POLLING_ENABLED: "true" }, () => {
        const config = loadConfig();
        expect(config.adaptivePollingEnabled).toBe(true);
      });
    });

    it("reads INBOX_CLEANUP_ENABLED=true from environment", () => {
      withEnv({ INBOX_CLEANUP_ENABLED: "true" }, () => {
        const config = loadConfig();
        expect(config.inboxCleanupEnabled).toBe(true);
      });
    });

    it("reads IDEMPOTENCY_RETENTION_DAYS from environment", () => {
      withEnv({ IDEMPOTENCY_RETENTION_DAYS: "60" }, () => {
        const config = loadConfig();
        expect(config.idempotencyRetentionDays).toBe(60);
      });
    });

    it("reads INBOX_RETENTION_DAYS from environment", () => {
      withEnv({ INBOX_RETENTION_DAYS: "90" }, () => {
        const config = loadConfig();
        expect(config.inboxRetentionDays).toBe(90);
      });
    });

    it("reads SHUTDOWN_TIMEOUT_MS from environment", () => {
      withEnv({ SHUTDOWN_TIMEOUT_MS: "10000" }, () => {
        const config = loadConfig();
        expect(config.shutdownTimeoutMs).toBe(10000);
      });
    });

    it("reads STALE_EVENT_THRESHOLD_MS from environment", () => {
      withEnv({ STALE_EVENT_THRESHOLD_MS: "60000" }, () => {
        const config = loadConfig();
        expect(config.staleEventThresholdMs).toBe(60000);
      });
    });

    it("reads STALE_RECOVERY_INTERVAL_MS from environment", () => {
      withEnv({ STALE_RECOVERY_INTERVAL_MS: "30000" }, () => {
        const config = loadConfig();
        expect(config.staleRecoveryIntervalMs).toBe(30000);
      });
    });

    it("reads ADAPTIVE_POLLING_MIN_POLL_INTERVAL_MS from environment", () => {
      withEnv({ ADAPTIVE_POLLING_MIN_POLL_INTERVAL_MS: "50" }, () => {
        const config = loadConfig();
        expect(config.adaptivePollingMinPollIntervalMs).toBe(50);
      });
    });

    it("reads ADAPTIVE_POLLING_MAX_POLL_INTERVAL_MS from environment", () => {
      withEnv({ ADAPTIVE_POLLING_MAX_POLL_INTERVAL_MS: "10000" }, () => {
        const config = loadConfig();
        expect(config.adaptivePollingMaxPollIntervalMs).toBe(10000);
      });
    });

    it("reads ADAPTIVE_POLLING_BUSY_THRESHOLD from environment", () => {
      withEnv({ ADAPTIVE_POLLING_BUSY_THRESHOLD: "100" }, () => {
        const config = loadConfig();
        expect(config.adaptivePollingBusyThreshold).toBe(100);
      });
    });

    it("reads ADAPTIVE_POLLING_MODERATE_THRESHOLD from environment", () => {
      withEnv({ ADAPTIVE_POLLING_MODERATE_THRESHOLD: "20" }, () => {
        const config = loadConfig();
        expect(config.adaptivePollingModerateThreshold).toBe(20);
      });
    });
  });

  describe("validation refinements", () => {
    it("throws when min > max adaptive polling interval", () => {
      withEnv(
        {
          ADAPTIVE_POLLING_MIN_POLL_INTERVAL_MS: "5000",
          ADAPTIVE_POLLING_MAX_POLL_INTERVAL_MS: "100",
        },
        () => {
          expect(() => loadConfig()).toThrow();
        },
      );
    });

    it("throws when busy threshold < moderate threshold", () => {
      withEnv(
        {
          ADAPTIVE_POLLING_BUSY_THRESHOLD: "5",
          ADAPTIVE_POLLING_MODERATE_THRESHOLD: "20",
        },
        () => {
          expect(() => loadConfig()).toThrow();
        },
      );
    });

    it("accepts valid thresholds where busy >= moderate", () => {
      withEnv(
        {
          ADAPTIVE_POLLING_BUSY_THRESHOLD: "20",
          ADAPTIVE_POLLING_MODERATE_THRESHOLD: "20",
        },
        () => {
          const config = loadConfig();
          expect(config.adaptivePollingBusyThreshold).toBe(20);
          expect(config.adaptivePollingModerateThreshold).toBe(20);
        },
      );
    });

    it("accepts valid log levels", () => {
      const validLevels = ["trace", "debug", "info", "warn", "error", "fatal"];
      for (const level of validLevels) {
        withEnv({ LOG_LEVEL: level }, () => {
          const config = loadConfig();
          expect(config.logLevel).toBe(level);
        });
      }
    });

    it("throws on invalid log level", () => {
      withEnv({ LOG_LEVEL: "verbose" }, () => {
        expect(() => loadConfig()).toThrow();
      });
    });
  });
});
