/**
 * Kafka partitioning utilities
 *
 * Pure functions for generating and validating Kafka partition keys.
 * These functions are intentionally stateless for easy unit testing.
 */

/**
 * Generate a partition key from an aggregate ID
 *
 * **Partitioning strategy**:
 * - Uses the aggregateId as the partition key
 * - Ensures all events for the same aggregate go to the same partition
 * - This provides ordering guarantees per aggregate within a topic
 *
 * **Null handling**:
 * - If aggregateId is null, undefined, or empty string, returns null
 * - Kafka will use the DefaultPartitioner to distribute these events
 *
 * **Note on whitespace**: This function passes through whitespace-only strings
 * as valid partition keys (e.g., "   " returns "   "). This is intentional:
 * aggregateId values come from user data and should be preserved as-is.
 * Use `isValidPartitionKey()` to validate if a partition key is meaningful.
 *
 * @param aggregateId - The aggregate ID from the outbox event
 * @returns A string partition key, or null if aggregateId is invalid
 *
 * @example
 * ```ts
 * generatePartitionKey("order-123") // "order-123"
 * generatePartitionKey("user-456") // "user-456"
 * generatePartitionKey(null) // null
 * generatePartitionKey("") // null
 * generatePartitionKey(undefined) // null
 * ```
 */
export function generatePartitionKey(
  aggregateId: string | null | undefined,
): string | null {
  // Null or undefined aggregateId means no partition key
  if (aggregateId === null || aggregateId === undefined) {
    return null;
  }

  // Empty string is treated as no partition key
  if (aggregateId === "") {
    return null;
  }

  // Valid aggregateId becomes the partition key
  return aggregateId;
}

/**
 * Validate a partition key value
 *
 * **Partition key requirements**:
 * - Must be a non-empty string (null is allowed for no partitioning)
 * - UTF-8 encoded strings are recommended
 * - Very large keys may impact performance
 *
 * @param partitionKey - The partition key to validate
 * @returns true if the partition key is valid, false otherwise
 *
 * @example
 * ```ts
 * isValidPartitionKey("order-123") // true
 * isValidPartitionKey(null) // true (null is valid for no partitioning)
 * isValidPartitionKey("") // false
 * isValidPartitionKey("   ") // false
 * ```
 */
export function isValidPartitionKey(
  partitionKey: string | null | undefined,
): boolean {
  // null or undefined are valid (means no partition key)
  if (partitionKey === null || partitionKey === undefined) {
    return true;
  }

  // Empty string or whitespace-only is invalid
  if (partitionKey.trim().length === 0) {
    return false;
  }

  // Non-empty string is valid
  return true;
}

/**
 * Check if two aggregate IDs will produce the same partition key
 *
 * **Use case**: Verify ordering guarantees for event streams
 *
 * @param aggregateId1 - First aggregate ID
 * @param aggregateId2 - Second aggregate ID
 * @returns true if both aggregate IDs map to the same partition
 *
 * @example
 * ```ts
 * // Same aggregate ID → same partition
 * isSamePartition("order-123", "order-123") // true
 *
 * // Different aggregate IDs → potentially different partitions
 * isSamePartition("order-123", "order-456") // false
 *
 * // Both null → same partition (no partitioning)
 * isSamePartition(null, null) // true
 * ```
 */
export function isSamePartition(
  aggregateId1: string | null | undefined,
  aggregateId2: string | null | undefined,
): boolean {
  const key1 = generatePartitionKey(aggregateId1);
  const key2 = generatePartitionKey(aggregateId2);

  // Both null → same partition (DefaultPartitioner)
  if (key1 === null && key2 === null) {
    return true;
  }

  // One null, one not → different partitions
  if (key1 === null || key2 === null) {
    return false;
  }

  // String comparison for partition keys
  return key1 === key2;
}
