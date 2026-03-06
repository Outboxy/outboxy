import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OutboxEvent } from "@outboxy/publisher-core";
import { CompressionTypes } from "kafkajs";

// Hoisted to survive restoreMocks: true
const mockConnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockDisconnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockSend = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockProducerFn = vi.hoisted(() =>
  vi.fn(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    send: mockSend,
  })),
);

vi.mock("kafkajs", () => {
  function MockKafka() {
    return {
      producer: mockProducerFn,
    };
  }
  return {
    Kafka: MockKafka,
    Partitioners: {
      DefaultPartitioner: "DefaultPartitioner",
    },
    CompressionTypes: {
      None: 0,
      GZIP: 1,
      Snappy: 2,
      LZ4: 3,
      ZSTD: 4,
    },
  };
});

import { KafkaPublisher } from "../kafka.publisher.js";

function createMockEvent(overrides: Partial<OutboxEvent> = {}): OutboxEvent {
  const now = new Date();
  return {
    id: "evt-1",
    aggregateType: "Order",
    aggregateId: "order-1",
    eventType: "OrderCreated",
    eventVersion: 1,
    payload: { amount: 100 },
    headers: {},
    destinationUrl: "kafka://orders",
    destinationType: "kafka",
    idempotencyKey: null,
    status: "pending",
    retryCount: 0,
    maxRetries: 5,
    nextRetryAt: null,
    backoffMultiplier: "2.0",
    lastError: null,
    errorDetails: null,
    createdAt: now,
    updatedAt: now,
    processingStartedAt: null,
    processedAt: null,
    metadata: {},
    processedByWorker: null,
    deletedAt: null,
    createdDate: now,
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
    level: "info",
    silent: vi.fn(),
  } as unknown as import("@outboxy/logging").Logger;
}

describe("KafkaPublisher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockDisconnect.mockResolvedValue(undefined);
    mockSend.mockResolvedValue(undefined);
    mockProducerFn.mockReturnValue({
      connect: mockConnect,
      disconnect: mockDisconnect,
      send: mockSend,
    });
  });

  describe("constructor", () => {
    it("should throw when brokers is missing", () => {
      expect(() => new KafkaPublisher({} as { brokers: string })).toThrow();
    });
  });

  describe("initialize", () => {
    it("should create and connect a producer", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });

      await publisher.initialize();

      expect(mockProducerFn).toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalled();
    });

    it("should log initialization messages when logger provided", async () => {
      const logger = makeLogger();

      const publisher = new KafkaPublisher(
        { brokers: "localhost:9092" },
        logger,
      );

      await publisher.initialize();

      expect(logger.info).toHaveBeenCalledWith(
        "Initializing Kafka producer...",
      );
      expect(logger.info).toHaveBeenCalledWith("Kafka producer connected");
    });
  });

  describe("shutdown", () => {
    it("should disconnect producer when initialized", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();
      await publisher.shutdown();

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it("should not call disconnect when not initialized", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.shutdown();

      expect(mockDisconnect).not.toHaveBeenCalled();
    });

    it("should null out the producer after shutdown", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();
      await publisher.shutdown();
      await publisher.shutdown();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it("should log disconnect messages when logger provided", async () => {
      const logger = makeLogger();

      const publisher = new KafkaPublisher(
        { brokers: "localhost:9092" },
        logger,
      );
      await publisher.initialize();
      await publisher.shutdown();

      expect(logger.info).toHaveBeenCalledWith(
        "Disconnecting Kafka producer...",
      );
      expect(logger.info).toHaveBeenCalledWith("Kafka producer disconnected");
    });
  });

  describe("publish", () => {
    it("should throw when called before initialize", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });

      await expect(publisher.publish([createMockEvent()])).rejects.toThrow(
        "not initialized",
      );
    });

    it("should publish events to correct topic from kafka:// URL", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      await publisher.publish([
        createMockEvent({ destinationUrl: "kafka://orders" }),
      ]);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "orders" }),
      );
    });

    it("should publish to topic without kafka:// prefix", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      await publisher.publish([createMockEvent({ destinationUrl: "orders" })]);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "orders" }),
      );
    });

    it("should return success for each published event", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      const results = await publisher.publish([
        createMockEvent({ id: "evt-1" }),
        createMockEvent({ id: "evt-2", destinationUrl: "kafka://orders" }),
      ]);

      expect(results.get("evt-1")).toEqual({ success: true, retryable: false });
      expect(results.get("evt-2")).toEqual({ success: true, retryable: false });
    });

    it("should group events by topic and send one batch per topic", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      await publisher.publish([
        createMockEvent({ id: "evt-1", destinationUrl: "kafka://topic-a" }),
        createMockEvent({ id: "evt-2", destinationUrl: "kafka://topic-b" }),
        createMockEvent({ id: "evt-3", destinationUrl: "kafka://topic-a" }),
      ]);

      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("should return failure result with retryable flag for network errors", async () => {
      const networkError = new Error("ECONNREFUSED: Connection refused");
      mockSend.mockRejectedValueOnce(networkError);

      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      const results = await publisher.publish([
        createMockEvent({ id: "evt-1" }),
      ]);

      const result = results.get("evt-1");
      expect(result?.success).toBe(false);
      expect(result?.retryable).toBe(true);
      expect(result?.error).toBe(networkError);
    });

    it("should return non-retryable failure for authorization errors", async () => {
      const authError = new Error("authorization failed: access denied");
      mockSend.mockRejectedValueOnce(authError);

      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      const results = await publisher.publish([
        createMockEvent({ id: "evt-1" }),
      ]);

      const result = results.get("evt-1");
      expect(result?.success).toBe(false);
      expect(result?.retryable).toBe(false);
    });

    it("should include event payload in message value JSON", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      const event = createMockEvent({
        id: "evt-1",
        eventType: "OrderCreated",
        aggregateType: "Order",
        aggregateId: "order-123",
        payload: { total: 200 },
      });

      await publisher.publish([event]);

      const sendCall = mockSend.mock.calls[0]![0];
      const message = sendCall.messages[0];
      const parsedValue = JSON.parse(message.value as string);

      expect(parsedValue).toMatchObject({
        eventType: "OrderCreated",
        aggregateType: "Order",
        aggregateId: "order-123",
        payload: { total: 200 },
      });
    });

    it("should include outbox headers in Kafka message", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      const event = createMockEvent({
        id: "evt-1",
        eventType: "OrderCreated",
        aggregateType: "Order",
      });

      await publisher.publish([event]);

      const sendCall = mockSend.mock.calls[0]![0];
      const message = sendCall.messages[0];

      expect(message.headers).toMatchObject({
        "x-outbox-event-id": "evt-1",
        "x-outbox-event-type": "OrderCreated",
        "x-outbox-aggregate-type": "Order",
      });
    });

    it("should use aggregateId as partition key", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      await publisher.publish([createMockEvent({ aggregateId: "order-123" })]);

      const sendCall = mockSend.mock.calls[0]![0];
      expect(sendCall.messages[0].key).toBe("order-123");
    });

    it("should return empty map for empty events array", async () => {
      const publisher = new KafkaPublisher({ brokers: "localhost:9092" });
      await publisher.initialize();

      const results = await publisher.publish([]);

      expect(results.size).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("should log error when publish batch fails", async () => {
      const logger = makeLogger();

      mockSend.mockRejectedValueOnce(new Error("Connection error"));

      const publisher = new KafkaPublisher(
        { brokers: "localhost:9092" },
        logger,
      );
      await publisher.initialize();

      await publisher.publish([createMockEvent()]);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "orders" }),
        expect.stringContaining("failed"),
      );
    });

    it("should log debug when publish batch succeeds", async () => {
      const logger = makeLogger();

      const publisher = new KafkaPublisher(
        { brokers: "localhost:9092" },
        logger,
      );
      await publisher.initialize();

      await publisher.publish([createMockEvent()]);

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "orders" }),
        expect.stringContaining("succeeded"),
      );
    });
  });

  describe("compression types", () => {
    it("should set gzip compression when configured", async () => {
      const publisher = new KafkaPublisher({
        brokers: "localhost:9092",
        compressionType: "gzip",
      });
      await publisher.initialize();
      await publisher.publish([createMockEvent()]);

      const sendCall = mockSend.mock.calls[0]![0];
      expect(sendCall.compression).toBe(CompressionTypes.GZIP);
    });

    it("should set snappy compression when configured", async () => {
      const publisher = new KafkaPublisher({
        brokers: "localhost:9092",
        compressionType: "snappy",
      });
      await publisher.initialize();
      await publisher.publish([createMockEvent()]);

      const sendCall = mockSend.mock.calls[0]![0];
      expect(sendCall.compression).toBe(CompressionTypes.Snappy);
    });

    it("should set lz4 compression when configured", async () => {
      const publisher = new KafkaPublisher({
        brokers: "localhost:9092",
        compressionType: "lz4",
      });
      await publisher.initialize();
      await publisher.publish([createMockEvent()]);

      const sendCall = mockSend.mock.calls[0]![0];
      expect(sendCall.compression).toBe(CompressionTypes.LZ4);
    });

    it("should set zstd compression when configured", async () => {
      const publisher = new KafkaPublisher({
        brokers: "localhost:9092",
        compressionType: "zstd",
      });
      await publisher.initialize();
      await publisher.publish([createMockEvent()]);

      const sendCall = mockSend.mock.calls[0]![0];
      expect(sendCall.compression).toBe(CompressionTypes.ZSTD);
    });

    it("should set no compression when configured", async () => {
      const publisher = new KafkaPublisher({
        brokers: "localhost:9092",
        compressionType: "none",
      });
      await publisher.initialize();
      await publisher.publish([createMockEvent()]);

      const sendCall = mockSend.mock.calls[0]![0];
      expect(sendCall.compression).toBe(CompressionTypes.None);
    });
  });
});
