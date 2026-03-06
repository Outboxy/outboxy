/**
 * Kafka Publisher Unit Tests
 *
 * Note: Full integration tests with real Kafka are in @outboxy/worker package
 * (packages/worker/__tests__/integration/kafka-publisher.integration.test.ts)
 *
 * These unit tests focus on:
 * - Configuration validation
 * - Export verification
 * - Error classification logic
 */

import { describe, it, expect } from "vitest";
import { kafkaPublisherConfigSchema } from "../config.js";
import {
  isRetryableKafkaError,
  NON_RETRYABLE_PATTERNS,
} from "../error-classification.js";

describe("KafkaPublisher Configuration", () => {
  describe("kafkaPublisherConfigSchema", () => {
    it("should require brokers", () => {
      expect(() => kafkaPublisherConfigSchema.parse({})).toThrow();
    });

    it("should accept minimal config with brokers", () => {
      const config = kafkaPublisherConfigSchema.parse({
        brokers: "localhost:9092",
      });

      expect(config.brokers).toBe("localhost:9092");
      expect(config.clientId).toBe("outboxy-publisher");
      expect(config.compressionType).toBe("gzip");
      expect(config.maxRetries).toBe(3);
      expect(config.requestTimeoutMs).toBe(30000);
    });

    it("should accept full config", () => {
      const config = kafkaPublisherConfigSchema.parse({
        brokers: "broker1:9092,broker2:9092",
        clientId: "my-publisher",
        compressionType: "snappy",
        maxRetries: 5,
        requestTimeoutMs: 60000,
      });

      expect(config.brokers).toBe("broker1:9092,broker2:9092");
      expect(config.clientId).toBe("my-publisher");
      expect(config.compressionType).toBe("snappy");
      expect(config.maxRetries).toBe(5);
      expect(config.requestTimeoutMs).toBe(60000);
    });

    it("should validate compression type enum", () => {
      const validTypes = ["gzip", "snappy", "lz4", "zstd", "none"];

      for (const compressionType of validTypes) {
        const config = kafkaPublisherConfigSchema.parse({
          brokers: "localhost:9092",
          compressionType,
        });
        expect(config.compressionType).toBe(compressionType);
      }
    });

    it("should reject invalid compression type", () => {
      expect(() =>
        kafkaPublisherConfigSchema.parse({
          brokers: "localhost:9092",
          compressionType: "invalid",
        }),
      ).toThrow();
    });

    it("should reject negative maxRetries", () => {
      expect(() =>
        kafkaPublisherConfigSchema.parse({
          brokers: "localhost:9092",
          maxRetries: -1,
        }),
      ).toThrow();
    });

    it("should reject non-positive requestTimeoutMs", () => {
      expect(() =>
        kafkaPublisherConfigSchema.parse({
          brokers: "localhost:9092",
          requestTimeoutMs: 0,
        }),
      ).toThrow();
    });
  });
});

describe("KafkaPublisher Exports", () => {
  it("should export KafkaPublisher class", async () => {
    const { KafkaPublisher } = await import("../kafka.publisher.js");
    expect(KafkaPublisher).toBeDefined();
    expect(typeof KafkaPublisher).toBe("function");
  });

  it("should export config schema", async () => {
    const { kafkaPublisherConfigSchema } = await import("../config.js");
    expect(kafkaPublisherConfigSchema).toBeDefined();
  });

  it("should export from index", async () => {
    const exports = await import("../index.js");
    expect(exports.KafkaPublisher).toBeDefined();
    expect(exports.kafkaPublisherConfigSchema).toBeDefined();
    expect(exports.isRetryableKafkaError).toBeDefined();
    expect(exports.NON_RETRYABLE_PATTERNS).toBeDefined();
  });
});

describe("Error Classification", () => {
  describe("isRetryableKafkaError", () => {
    describe("non-retryable errors", () => {
      it.each(NON_RETRYABLE_PATTERNS)(
        'should return false for error containing "%s"',
        (pattern) => {
          const error = new Error(`Kafka error: ${pattern} or partition`);
          expect(isRetryableKafkaError(error)).toBe(false);
        },
      );

      it("should handle case-insensitive matching", () => {
        const error = new Error("UNKNOWN TOPIC or partition");
        expect(isRetryableKafkaError(error)).toBe(false);
      });

      it("should detect pattern anywhere in message", () => {
        const error = new Error(
          "KafkaJSError: topic marked for deletion: orders-topic",
        );
        expect(isRetryableKafkaError(error)).toBe(false);
      });
    });

    describe("retryable errors", () => {
      it("should return true for network errors", () => {
        const error = new Error("ECONNREFUSED: Connection refused");
        expect(isRetryableKafkaError(error)).toBe(true);
      });

      it("should return true for timeout errors", () => {
        const error = new Error("Request timed out after 30000ms");
        expect(isRetryableKafkaError(error)).toBe(true);
      });

      it("should return true for broker unavailable errors", () => {
        const error = new Error("Broker not available");
        expect(isRetryableKafkaError(error)).toBe(true);
      });

      it("should return true for leader not available errors", () => {
        const error = new Error("Leader not available for partition");
        expect(isRetryableKafkaError(error)).toBe(true);
      });

      it("should return true for generic connection errors", () => {
        const error = new Error("Connection error: ETIMEDOUT");
        expect(isRetryableKafkaError(error)).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("should return false for non-Error values", () => {
        expect(isRetryableKafkaError("string error")).toBe(false);
        expect(isRetryableKafkaError(null)).toBe(false);
        expect(isRetryableKafkaError(undefined)).toBe(false);
        expect(isRetryableKafkaError(42)).toBe(false);
        expect(isRetryableKafkaError({ message: "fake error" })).toBe(false);
      });

      it("should return true for Error with empty message", () => {
        const error = new Error("");
        expect(isRetryableKafkaError(error)).toBe(true);
      });
    });
  });

  describe("NON_RETRYABLE_PATTERNS", () => {
    it("should export the patterns array", () => {
      expect(Array.isArray(NON_RETRYABLE_PATTERNS)).toBe(true);
      expect(NON_RETRYABLE_PATTERNS.length).toBeGreaterThan(0);
    });

    it("should include essential patterns", () => {
      expect(NON_RETRYABLE_PATTERNS).toContain("unknown topic");
      expect(NON_RETRYABLE_PATTERNS).toContain("authorization failed");
      expect(NON_RETRYABLE_PATTERNS).toContain("authentication failed");
    });
  });
});
