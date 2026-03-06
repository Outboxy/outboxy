export { KafkaPublisher } from "./kafka.publisher.js";
export {
  kafkaPublisherConfigSchema,
  type KafkaPublisherConfig,
} from "./config.js";
export {
  isRetryableKafkaError,
  NON_RETRYABLE_PATTERNS,
} from "./error-classification.js";
export { extractTopicFromUrl, isValidTopicName } from "./topic-utils.js";
export {
  generatePartitionKey,
  isValidPartitionKey,
  isSamePartition,
} from "./partition-utils.js";
export type {
  Publisher,
  PublishResult,
  OutboxEvent,
} from "@outboxy/publisher-core";
