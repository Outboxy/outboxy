/**
 * Kafka topic extraction utilities
 *
 * Pure functions for extracting and validating Kafka topics from destination URLs.
 * These functions are intentionally stateless for easy unit testing.
 */

/**
 * Extract Kafka topic from destinationUrl
 *
 * **Supported formats**:
 * - `"kafka://topic-name"` → `"topic-name"`
 * - `"topic-name"` → `"topic-name"` (assumes kafka if publisherType is kafka)
 *
 * **Invalid formats** (handled by validation layer):
 * - Empty string
 * - String with only whitespace
 * - Special characters that violate Kafka topic naming rules
 *
 * @param url - The destination URL from the outbox event
 * @returns The extracted Kafka topic name
 *
 * @example
 * ```ts
 * extractTopicFromUrl("kafka://orders") // "orders"
 * extractTopicFromUrl("orders") // "orders"
 * extractTopicFromUrl("kafka://user-events") // "user-events"
 * ```
 */
export function extractTopicFromUrl(url: string): string {
  if (url.startsWith("kafka://")) {
    return url.replace("kafka://", "");
  }
  return url;
}

/**
 * Validate Kafka topic name according to Kafka naming rules
 *
 * **Kafka topic naming rules**:
 * - Must be between 1 and 249 characters
 * - Can only contain ASCII letters, digits, `.`, `_`, and `-`
 * - Cannot start with `.` or `_` (reserved for internal topics)
 * - Cannot be empty or contain only whitespace
 *
 * @param topic - The topic name to validate
 * @returns true if the topic name is valid, false otherwise
 *
 * @example
 * ```ts
 * isValidTopicName("orders") // true
 * isValidTopicName("user-events") // true
 * isValidTopicName("") // false
 * isValidTopicName(".internal") // false
 * isValidTopicName("topic with spaces") // false
 * ```
 */
export function isValidTopicName(topic: string): boolean {
  // Empty or whitespace-only strings are invalid
  if (!topic || topic.trim().length === 0) {
    return false;
  }

  // Must be 1-249 characters (Kafka constraint)
  if (topic.length > 249 || topic.length < 1) {
    return false;
  }

  // Cannot start with . or _ (reserved for internal Kafka topics)
  if (topic.startsWith(".") || topic.startsWith("_")) {
    return false;
  }

  // Can only contain ASCII letters, digits, ., _, and -
  const validPattern = /^[a-zA-Z0-9._-]+$/;
  if (!validPattern.test(topic)) {
    return false;
  }

  return true;
}
