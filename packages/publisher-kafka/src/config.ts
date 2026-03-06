import { z } from "zod";

/**
 * Kafka Publisher configuration schema
 */
export const kafkaPublisherConfigSchema = z.object({
  /**
   * Comma-separated list of Kafka brokers
   * @example "broker1:9092,broker2:9092"
   */
  brokers: z.string(),

  /**
   * Kafka client identifier
   * @default "outboxy-publisher"
   */
  clientId: z.string().default("outboxy-publisher"),

  /**
   * Compression type for messages
   * @default "gzip"
   */
  compressionType: z
    .enum(["gzip", "snappy", "lz4", "zstd", "none"])
    .default("gzip"),

  /**
   * Maximum number of retries for failed operations
   * @default 3
   */
  maxRetries: z.number().int().nonnegative().default(3),

  /**
   * Request timeout in milliseconds
   * @default 30000 (30 seconds)
   */
  requestTimeoutMs: z.number().int().positive().default(30000),
});

export type KafkaPublisherConfig = z.infer<typeof kafkaPublisherConfigSchema>;
