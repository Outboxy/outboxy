import { Kafka, type Producer, Partitioners, CompressionTypes } from "kafkajs";
import type { Logger } from "@outboxy/logging";
import type {
  Publisher,
  PublishResult,
  OutboxEvent,
} from "@outboxy/publisher-core";
import type { KafkaPublisherConfig } from "./config.js";
import { kafkaPublisherConfigSchema } from "./config.js";
import { isRetryableKafkaError } from "./error-classification.js";
import { extractTopicFromUrl } from "./topic-utils.js";
import { generatePartitionKey } from "./partition-utils.js";

/**
 * Kafka publisher implementation
 *
 * Publishes events to Kafka topics using kafkajs library.
 *
 * **Topic Resolution**:
 * - Extracts topic from event.destinationUrl (format: "kafka://topic-name")
 * - Falls back to using destinationUrl directly if not prefixed
 *
 * **Partitioning Strategy**:
 * - Uses event.aggregateId as partition key for ordering per aggregate
 * - Ensures all events for the same aggregate go to the same partition (ordering guarantee)
 *
 * **Error Handling**:
 * - Network errors, broker unavailable → retryable (worker will retry)
 * - Auth errors, invalid topic → non-retryable (moved to DLQ)
 */
export class KafkaPublisher implements Publisher {
  private readonly config: KafkaPublisherConfig;
  private kafka: Kafka;
  private producer: Producer | null = null;

  constructor(
    config: Partial<KafkaPublisherConfig> &
      Pick<KafkaPublisherConfig, "brokers">,
    private readonly logger?: Logger,
  ) {
    this.config = kafkaPublisherConfigSchema.parse(config);
    const brokers = this.config.brokers.split(",").map((b) => b.trim());

    this.kafka = new Kafka({
      clientId: this.config.clientId,
      brokers,
      retry: {
        retries: this.config.maxRetries,
      },
      requestTimeout: this.config.requestTimeoutMs,
    });
  }

  async initialize(): Promise<void> {
    this.logger?.info("Initializing Kafka producer...");

    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      retry: {
        retries: this.config.maxRetries,
      },
    });

    await this.producer.connect();
    this.logger?.info("Kafka producer connected");
  }

  async shutdown(): Promise<void> {
    if (this.producer) {
      this.logger?.info("Disconnecting Kafka producer...");
      await this.producer.disconnect();
      this.producer = null;
      this.logger?.info("Kafka producer disconnected");
    }
  }

  async publish(events: OutboxEvent[]): Promise<Map<string, PublishResult>> {
    const results = new Map<string, PublishResult>();

    if (!this.producer) {
      throw new Error(
        "Kafka producer not initialized. Call initialize() first.",
      );
    }

    const eventsByTopic = this.groupByTopic(events);

    const topicPromises = Array.from(eventsByTopic.entries()).map(
      async ([topic, topicEvents]) => {
        try {
          await this.producer!.send({
            topic,
            compression: this.getCompressionType(),
            messages: topicEvents.map((event) => ({
              key: generatePartitionKey(event.aggregateId),
              value: JSON.stringify({
                eventType: event.eventType,
                aggregateType: event.aggregateType,
                aggregateId: event.aggregateId,
                payload: event.payload,
                createdAt: event.createdAt,
              }),
              headers: {
                "x-outbox-event-id": event.id,
                "x-outbox-event-type": event.eventType,
                "x-outbox-aggregate-type": event.aggregateType,
              },
            })),
          });

          for (const event of topicEvents) {
            results.set(event.id, { success: true, retryable: false });
          }

          this.logger?.debug(
            { topic, eventCount: topicEvents.length },
            "Kafka batch publish succeeded",
          );
        } catch (error) {
          const retryable = isRetryableKafkaError(error);

          for (const event of topicEvents) {
            results.set(event.id, {
              success: false,
              error: error as Error,
              retryable,
            });
          }

          this.logger?.error(
            { err: error, topic, eventCount: topicEvents.length },
            "Kafka batch publish failed",
          );
        }
      },
    );

    await Promise.all(topicPromises);
    return results;
  }

  private groupByTopic(events: OutboxEvent[]): Map<string, OutboxEvent[]> {
    const groups = new Map<string, OutboxEvent[]>();

    for (const event of events) {
      const topic = extractTopicFromUrl(event.destinationUrl);
      const existing = groups.get(topic) ?? [];
      existing.push(event);
      groups.set(topic, existing);
    }

    return groups;
  }

  /**
   * Map compression type from config to kafkajs CompressionTypes enum
   */
  private getCompressionType(): CompressionTypes {
    const typeMap: Record<
      KafkaPublisherConfig["compressionType"],
      CompressionTypes
    > = {
      gzip: CompressionTypes.GZIP,
      snappy: CompressionTypes.Snappy,
      lz4: CompressionTypes.LZ4,
      zstd: CompressionTypes.ZSTD,
      none: CompressionTypes.None,
    };

    return typeMap[this.config.compressionType];
  }
}
