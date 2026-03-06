import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "@outboxy/logging";

// Mock the publisher modules
vi.mock("@outboxy/publisher-http", () => ({
  HttpPublisher: vi.fn().mockImplementation(function (config: unknown) {
    return {
      type: "http",
      config,
      publish: vi.fn(),
    };
  }),
}));

vi.mock("@outboxy/publisher-kafka", () => ({
  KafkaPublisher: vi.fn().mockImplementation(function (config: unknown) {
    return {
      type: "kafka",
      config,
      publish: vi.fn(),
    };
  }),
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

describe("publisher-factory", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe("createPublisher", () => {
    it("should create an HTTP publisher with options", async () => {
      const { createPublisher } = await import("../publisher-factory.js");

      const publisher = await createPublisher(
        "http",
        { timeoutMs: 5000 },
        mockLogger,
      );

      expect(publisher).toBeDefined();
      expect((publisher as { type: string }).type).toBe("http");
    });

    it("should create a Kafka publisher with options", async () => {
      const { createPublisher } = await import("../publisher-factory.js");

      const publisher = await createPublisher(
        "kafka",
        {
          brokers: "broker1:9092,broker2:9092",
          clientId: "test-client",
          compressionType: "gzip",
          maxRetries: 5,
          requestTimeoutMs: 10000,
        },
        mockLogger,
      );

      expect(publisher).toBeDefined();
      expect((publisher as { type: string }).type).toBe("kafka");
    });

    it("should throw when Kafka publisher has empty brokers", async () => {
      const { createPublisher } = await import("../publisher-factory.js");

      await expect(
        createPublisher("kafka", { brokers: "" }, mockLogger),
      ).rejects.toThrow("KAFKA_BROKERS");
    });
  });

  describe("createPublisherFromEnv", () => {
    it("should default to HTTP publisher when PUBLISHER_TYPE is not set", async () => {
      vi.resetModules();
      const { createPublisherFromEnv } =
        await import("../publisher-factory.js");

      const publisher = await createPublisherFromEnv(mockLogger);

      expect(publisher).toBeDefined();
      expect((publisher as { type: string }).type).toBe("http");
    });

    it("should create HTTP publisher with timeout from env", async () => {
      vi.stubEnv("PUBLISHER_TYPE", "http");
      vi.stubEnv("HTTP_TIMEOUT_MS", "5000");
      vi.resetModules();

      const { createPublisherFromEnv } =
        await import("../publisher-factory.js");
      const publisher = await createPublisherFromEnv(mockLogger);

      expect(publisher).toBeDefined();
      expect(
        (publisher as { config: { timeoutMs: number } }).config.timeoutMs,
      ).toBe(5000);
    });

    it("should create Kafka publisher from env vars", async () => {
      vi.stubEnv("PUBLISHER_TYPE", "kafka");
      vi.stubEnv("KAFKA_BROKERS", "broker1:9092");
      vi.stubEnv("KAFKA_CLIENT_ID", "test-client");
      vi.stubEnv("KAFKA_COMPRESSION_TYPE", "snappy");
      vi.stubEnv("KAFKA_MAX_RETRIES", "3");
      vi.stubEnv("KAFKA_REQUEST_TIMEOUT_MS", "15000");
      vi.resetModules();

      const { createPublisherFromEnv } =
        await import("../publisher-factory.js");
      const publisher = await createPublisherFromEnv(mockLogger);

      expect(publisher).toBeDefined();
      expect((publisher as { type: string }).type).toBe("kafka");
    });

    it("should reject invalid publisher type via Zod", async () => {
      vi.stubEnv("PUBLISHER_TYPE", "invalid");
      vi.resetModules();

      const { createPublisherFromEnv } =
        await import("../publisher-factory.js");

      await expect(createPublisherFromEnv(mockLogger)).rejects.toThrow();
    });

    it("should reject non-numeric HTTP_TIMEOUT_MS via Zod", async () => {
      vi.stubEnv("PUBLISHER_TYPE", "http");
      vi.stubEnv("HTTP_TIMEOUT_MS", "not-a-number");
      vi.resetModules();

      const { createPublisherFromEnv } =
        await import("../publisher-factory.js");

      await expect(createPublisherFromEnv(mockLogger)).rejects.toThrow();
    });

    it("should reject negative KAFKA_MAX_RETRIES via Zod", async () => {
      vi.stubEnv("PUBLISHER_TYPE", "kafka");
      vi.stubEnv("KAFKA_BROKERS", "broker1:9092");
      vi.stubEnv("KAFKA_MAX_RETRIES", "-1");
      vi.resetModules();

      const { createPublisherFromEnv } =
        await import("../publisher-factory.js");

      await expect(createPublisherFromEnv(mockLogger)).rejects.toThrow();
    });
  });
});
