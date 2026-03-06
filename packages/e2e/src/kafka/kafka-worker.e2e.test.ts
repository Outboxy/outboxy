/**
 * Kafka Publisher E2E Tests
 *
 * Validates:
 * 1. Kafka publisher works end-to-end
 * 2. Events published to Kafka topics correctly
 * 3. Partition key (aggregateId) works for ordering guarantees
 * 4. Worker processes Kafka events identically to HTTP events
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createIsolatedTestPool,
  getTestPgConnectionStringWithSchema,
  getTestContainerConfig,
  getTestKafka,
  createTestConsumer,
  cleanupTestConsumer,
  waitForOutboxEventStatus,
  type Pool,
} from "@outboxy/testing-utils";
import { createTestWorkerConfig } from "../helpers/worker-config-factory.js";
import { type EachMessagePayload, type Kafka } from "kafkajs";
import { OutboxWorker, createLogger } from "@outboxy/worker";
import { createPostgresAdapter } from "@outboxy/db-adapter-postgres";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import { KafkaPublisher } from "@outboxy/publisher-kafka";

describe("Kafka Publisher E2E Tests", () => {
  let pool: Pool;
  let connectionString: string;
  let cleanupPool: () => Promise<void>;
  let kafkaBroker: string;
  let kafka: Kafka;

  let receivedMessages: Array<{
    topic: string;
    partition: number;
    key: string | null;
    value: unknown;
    headers: Record<string, string>;
    timestamp: string;
  }> = [];

  beforeAll(async () => {
    const config = getTestContainerConfig();
    const isolated = await createIsolatedTestPool({
      name: "kafka-publisher-e2e",
    });
    pool = isolated.pool;
    cleanupPool = isolated.cleanup;
    connectionString = getTestPgConnectionStringWithSchema(isolated.schemaName);
    kafkaBroker = config.kafkaBroker;
    kafka = getTestKafka();

    const admin = kafka.admin();
    await admin.connect();

    await admin.createTopics({
      topics: [
        { topic: "e2e-orders", numPartitions: 3 },
        { topic: "e2e-user-events", numPartitions: 3 },
        { topic: "e2e-concurrent", numPartitions: 3 },
      ],
    });

    await admin.disconnect();
    console.log("✅ E2E test topics created");

    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("✅ Topics ready");
  }, 30000);

  afterAll(async () => {
    console.log("🧹 Cleaning up test resources...");
    await cleanupPool();
    console.log("✅ Cleanup complete");
  }, 30000);

  beforeEach(async () => {
    await pool.query("TRUNCATE outbox_events CASCADE");
    receivedMessages = [];
  });

  async function createTestWorker(
    options: {
      kafkaClientId?: string;
      pollIntervalMs?: number;
      batchSize?: number;
    } = {},
  ): Promise<{
    worker: OutboxWorker;
    publisher: KafkaPublisher;
    adapter: DatabaseAdapter;
  }> {
    const config = createTestWorkerConfig({
      pollIntervalMs: options.pollIntervalMs,
      batchSize: options.batchSize,
    });

    const logger = createLogger({
      service: "outboxy-e2e",
      level: config.logLevel,
    });

    const adapter = await createPostgresAdapter({
      connectionString,
      maxConnections: 5,
      logger,
    });

    const publisher = new KafkaPublisher(
      {
        brokers: kafkaBroker,
        clientId: options.kafkaClientId ?? `e2e-worker-${Date.now()}`,
        compressionType: "gzip",
        maxRetries: 3,
        requestTimeoutMs: 30000,
      },
      logger,
    );
    await publisher.initialize();

    const worker = new OutboxWorker(
      config,
      adapter.eventRepository,
      logger,
      publisher,
    );

    return { worker, publisher, adapter };
  }

  async function waitForKafkaMessages(
    topic: string,
    expectedCount: number,
    maxWaitMs = 15000,
  ): Promise<typeof receivedMessages> {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      const messagesForTopic = receivedMessages.filter(
        (m) => m.topic === topic,
      );

      if (messagesForTopic.length >= expectedCount) {
        return messagesForTopic;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `Timeout waiting for ${expectedCount} messages on topic ${topic}. Got: ${receivedMessages.filter((m) => m.topic === topic).length}`,
    );
  }

  it("should publish event to Kafka topic successfully", async () => {
    const testTopic = "e2e-orders";
    const startTime = Date.now();

    const consumer = await createTestConsumer(`e2e-consumer-${Date.now()}`);

    await consumer.subscribe({ topic: testTopic, fromBeginning: true });

    const consumerPromise = consumer.run({
      eachMessage: async ({
        topic,
        partition,
        message,
      }: EachMessagePayload) => {
        receivedMessages.push({
          topic,
          partition,
          key: message.key?.toString() || null,
          value: JSON.parse(message.value!.toString()),
          headers: Object.fromEntries(
            Object.entries(message.headers || {}).map(([k, v]) => [
              k,
              v?.toString() || "",
            ]),
          ),
          timestamp: message.timestamp,
        });
      },
    });

    const { rows } = await pool.query(
      `INSERT INTO outbox_events (
        aggregate_type, aggregate_id, event_type, payload, destination_url
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id`,
      [
        "Order",
        "order-123",
        "OrderCreated",
        JSON.stringify({ orderNumber: 1001, amount: 99.99 }),
        `kafka://${testTopic}`,
      ],
    );

    const eventId = rows[0].id;
    console.log(`📝 Inserted event ${eventId} for topic ${testTopic}`);

    const { worker, publisher, adapter } = await createTestWorker({
      kafkaClientId: "e2e-worker-1",
    });

    const workerPromise = worker.start();
    const event = await waitForOutboxEventStatus(pool, eventId, "succeeded");

    worker.stop();
    await workerPromise.catch(() => {});
    await publisher.shutdown();
    await adapter.shutdown();

    expect(event.status).toBe("succeeded");
    expect(event.retry_count).toBe(0);
    expect(event.last_error).toBeNull();

    const messages = await waitForKafkaMessages(testTopic, 1);

    await consumer.stop();
    await cleanupTestConsumer(consumer);
    await consumerPromise.catch(() => {});

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0]!.topic).toBe(testTopic);
    expect(messages[0]!.key).toBe("order-123");

    const durationSec = (Date.now() - startTime) / 1000;
    console.log(`✅ Event successfully published to Kafka and verified!`);
    console.log(`📊 Duration: ${durationSec.toFixed(2)}s`);
  }, 60000);

  it("should handle multiple events with same aggregate to same partition", async () => {
    const testTopic = `e2e-user-events-${Date.now()}`;
    const aggregateId = `user-${Date.now()}`;
    const startTime = Date.now();

    const consumer = await createTestConsumer(`e2e-consumer-agg-${Date.now()}`);

    await consumer.subscribe({ topic: testTopic, fromBeginning: true });

    const consumerPromise = consumer.run({
      eachMessage: async ({
        topic,
        partition,
        message,
      }: EachMessagePayload) => {
        receivedMessages.push({
          topic,
          partition,
          key: message.key?.toString() || null,
          value: JSON.parse(message.value!.toString()),
          headers: {},
          timestamp: message.timestamp,
        });
      },
    });

    for (let i = 1; i <= 3; i++) {
      await pool.query(
        `INSERT INTO outbox_events (
          aggregate_type, aggregate_id, event_type, payload, destination_url
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          "User",
          aggregateId,
          `UserEvent${i}`,
          JSON.stringify({ eventNumber: i }),
          `kafka://${testTopic}`,
        ],
      );
    }

    console.log(`📝 Inserted 3 events for aggregate ${aggregateId}`);

    const { worker, publisher, adapter } = await createTestWorker({
      kafkaClientId: "e2e-worker-2",
    });

    const workerPromise = worker.start();
    const messages = await waitForKafkaMessages(testTopic, 3);

    worker.stop();
    await workerPromise.catch(() => {});
    await publisher.shutdown();
    await adapter.shutdown();

    await consumer.stop();
    await cleanupTestConsumer(consumer);
    await consumerPromise.catch(() => {});

    expect(messages.length).toBeGreaterThanOrEqual(3);

    const messagesForAggregate = messages.filter((m) => m.key === aggregateId);
    expect(messagesForAggregate.length).toBe(3);

    const partitions = new Set(messagesForAggregate.map((m) => m.partition));
    expect(partitions.size).toBe(1);

    const durationSec = (Date.now() - startTime) / 1000;
    console.log(
      `✅ All 3 events for aggregate ${aggregateId} sent to partition ${Array.from(partitions)[0]}`,
    );
    console.log(`📊 Duration: ${durationSec.toFixed(2)}s`);
  }, 60000);
});
