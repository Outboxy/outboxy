/**
 * Publisher Factory
 *
 * Centralized creation of event publishers for the server package.
 * Consolidates logic from worker/src/bin/start.ts.
 */

import type { Publisher } from "@outboxy/publisher-core";
import { HttpPublisher } from "@outboxy/publisher-http";
import type { Logger } from "@outboxy/logging";
import { z } from "zod";

export interface HttpPublisherOptions {
  /** HTTP request timeout in milliseconds */
  timeoutMs?: number;
}

export interface KafkaPublisherOptions {
  /** Kafka broker addresses (comma-separated) */
  brokers: string;
  /** Kafka client ID */
  clientId?: string;
  /** Compression type */
  compressionType?: "gzip" | "snappy" | "lz4" | "zstd" | "none";
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Request timeout in milliseconds */
  requestTimeoutMs?: number;
}

export type PublisherOptions = HttpPublisherOptions | KafkaPublisherOptions;

export type PublisherType = "http" | "kafka";

const publisherEnvSchema = z.object({
  publisherType: z.enum(["http", "kafka"]).default("http"),
  httpTimeoutMs: z.coerce.number().int().positive().optional(),
  kafkaBrokers: z.string().optional(),
  kafkaClientId: z.string().optional(),
  kafkaCompressionType: z
    .enum(["gzip", "snappy", "lz4", "zstd", "none"])
    .optional(),
  kafkaMaxRetries: z.coerce.number().int().nonnegative().optional(),
  kafkaRequestTimeoutMs: z.coerce.number().int().positive().optional(),
});

/**
 * Create a publisher based on type and options
 *
 * Supports HTTP and Kafka publishers. HTTP is always available,
 * Kafka requires @outboxy/publisher-kafka to be installed.
 *
 * @param type - Publisher type ("http" or "kafka")
 * @param options - Publisher-specific options
 * @param logger - Logger instance
 * @returns Publisher instance
 * @throws Error if Kafka publisher type is requested but package is not installed
 */
export async function createPublisher(
  type: PublisherType,
  options: PublisherOptions,
  logger: Logger,
): Promise<Publisher> {
  if (type === "kafka") {
    const kafkaOptions = options as KafkaPublisherOptions;

    if (!kafkaOptions.brokers) {
      throw new Error(
        "KAFKA_BROKERS environment variable is required when PUBLISHER_TYPE=kafka",
      );
    }

    const { KafkaPublisher } = await import("@outboxy/publisher-kafka");

    return new KafkaPublisher(
      {
        brokers: kafkaOptions.brokers,
        clientId: kafkaOptions.clientId,
        compressionType: kafkaOptions.compressionType,
        maxRetries: kafkaOptions.maxRetries,
        requestTimeoutMs: kafkaOptions.requestTimeoutMs,
      },
      logger,
    );
  }

  const httpOptions = options as HttpPublisherOptions;
  return new HttpPublisher(
    {
      timeoutMs: httpOptions.timeoutMs,
    },
    logger,
  );
}

/**
 * Create publisher from environment variables
 *
 * Reads publisher configuration from environment variables:
 * - PUBLISHER_TYPE: "http" (default) or "kafka"
 * - HTTP_TIMEOUT_MS: HTTP timeout (for HTTP publisher)
 * - KAFKA_BROKERS: Kafka brokers (required for Kafka publisher)
 * - KAFKA_CLIENT_ID: Kafka client ID (optional)
 * - KAFKA_COMPRESSION_TYPE: Compression type (optional)
 * - KAFKA_MAX_RETRIES: Max retries (optional)
 * - KAFKA_REQUEST_TIMEOUT_MS: Request timeout (optional)
 *
 * @param logger - Logger instance
 * @returns Publisher instance
 */
export async function createPublisherFromEnv(
  logger: Logger,
): Promise<Publisher> {
  const config = publisherEnvSchema.parse({
    publisherType: process.env.PUBLISHER_TYPE || undefined,
    httpTimeoutMs: process.env.HTTP_TIMEOUT_MS || undefined,
    kafkaBrokers: process.env.KAFKA_BROKERS || undefined,
    kafkaClientId: process.env.KAFKA_CLIENT_ID || undefined,
    kafkaCompressionType: process.env.KAFKA_COMPRESSION_TYPE || undefined,
    kafkaMaxRetries: process.env.KAFKA_MAX_RETRIES || undefined,
    kafkaRequestTimeoutMs: process.env.KAFKA_REQUEST_TIMEOUT_MS || undefined,
  });

  if (config.publisherType === "kafka") {
    return createPublisher(
      "kafka",
      {
        brokers: config.kafkaBrokers ?? "",
        clientId: config.kafkaClientId,
        compressionType: config.kafkaCompressionType,
        maxRetries: config.kafkaMaxRetries,
        requestTimeoutMs: config.kafkaRequestTimeoutMs,
      },
      logger,
    );
  }

  return createPublisher(
    "http",
    {
      timeoutMs: config.httpTimeoutMs,
    },
    logger,
  );
}
