/**
 * Test Kafka manager for shared Kafka connections
 *
 * Manages KafkaJS clients that share the globally started Redpanda container.
 *
 * @packageDocumentation
 */

import { Kafka, type Consumer, type Producer } from "kafkajs";
import { getTestContainerConfig } from "./setupTests.js";

// Track resources for cleanup
const consumers: Consumer[] = [];
const producers: Producer[] = [];
let sharedKafka: Kafka | null = null;

/**
 * Get or create a shared Kafka client
 *
 * @returns A configured Kafka client connected to the test container
 */
export function getTestKafka(): Kafka {
  if (!sharedKafka) {
    const config = getTestContainerConfig();
    sharedKafka = new Kafka({
      clientId: "test-client",
      brokers: [config.kafkaBroker],
      retry: {
        retries: 5,
        initialRetryTime: 300,
      },
    });
  }
  return sharedKafka;
}

/**
 * Create a Kafka consumer for testing
 *
 * @param groupId - Consumer group ID (default: "test-group")
 * @returns A connected Kafka consumer
 *
 * @example
 * ```typescript
 * const consumer = await createTestConsumer("my-test-group");
 * await consumer.subscribe({ topic: "test-topic" });
 * ```
 */
export async function createTestConsumer(
  groupId = "test-group",
): Promise<Consumer> {
  const kafka = getTestKafka();
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  consumers.push(consumer);
  return consumer;
}

/**
 * Create a Kafka producer for testing
 *
 * @returns A connected Kafka producer
 *
 * @example
 * ```typescript
 * const producer = await createTestProducer();
 * await producer.send({ topic: "test-topic", messages: [{ value: "test" }] });
 * ```
 */
export async function createTestProducer(): Promise<Producer> {
  const kafka = getTestKafka();
  const producer = kafka.producer();
  await producer.connect();
  producers.push(producer);
  return producer;
}

/**
 * Disconnect a Kafka consumer
 *
 * @param consumer - The consumer to disconnect
 */
export async function cleanupTestConsumer(consumer: Consumer): Promise<void> {
  const index = consumers.indexOf(consumer);
  if (index > -1) {
    consumers.splice(index, 1);
  }
  await consumer.disconnect();
}

/**
 * Disconnect a Kafka producer
 *
 * @param producer - The producer to disconnect
 */
export async function cleanupTestProducer(producer: Producer): Promise<void> {
  const index = producers.indexOf(producer);
  if (index > -1) {
    producers.splice(index, 1);
  }
  await producer.disconnect();
}

/**
 * Clean up all tracked Kafka resources
 *
 * Should be called in afterAll to ensure proper cleanup.
 */
export async function cleanupAllKafkaResources(): Promise<void> {
  for (const consumer of consumers) {
    try {
      await consumer.disconnect();
    } catch {
      // Ignore errors during cleanup
    }
  }
  consumers.length = 0;

  for (const producer of producers) {
    try {
      await producer.disconnect();
    } catch {
      // Ignore errors during cleanup
    }
  }
  producers.length = 0;

  sharedKafka = null;
}

/**
 * Wait for Kafka messages with timeout
 *
 * @param consumer - The consumer to receive messages from
 * @param expectedCount - Number of messages to wait for
 * @param timeout - Maximum time to wait in milliseconds
 * @returns Array of received messages
 */
export async function waitForKafkaMessages(
  consumer: Consumer,
  expectedCount: number,
  timeout = 10000,
): Promise<Array<{ key: string | null; value: string | null }>> {
  const messages: Array<{ key: string | null; value: string | null }> = [];
  const startTime = Date.now();

  await consumer.run({
    eachMessage: async ({ message }) => {
      messages.push({
        key: message.key?.toString() ?? null,
        value: message.value?.toString() ?? null,
      });
    },
  });

  // Poll until we have enough messages or timeout
  while (messages.length < expectedCount && Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return messages;
}
