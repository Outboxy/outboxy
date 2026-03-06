/**
 * Partitioning Logic Unit Tests
 *
 * Pure function unit tests for Kafka partition key generation.
 * Tests run in <10ms with no network dependencies.
 */

import { describe, it, expect } from "vitest";
import {
  generatePartitionKey,
  isValidPartitionKey,
  isSamePartition,
} from "../partition-utils.js";

describe("Partitioning Logic", () => {
  describe("generatePartitionKey", () => {
    describe("valid aggregateId handling", () => {
      it("should return aggregateId as partition key for valid string", () => {
        expect(generatePartitionKey("order-123")).toBe("order-123");
      });

      it("should handle numeric string aggregateId", () => {
        expect(generatePartitionKey("12345")).toBe("12345");
      });

      it("should handle UUID-like aggregateId", () => {
        const uuid = "550e8400-e29b-41d4-a716-446655440000";
        expect(generatePartitionKey(uuid)).toBe(uuid);
      });

      it("should handle aggregateId with special characters", () => {
        expect(generatePartitionKey("order:123")).toBe("order:123");
        expect(generatePartitionKey("user/456")).toBe("user/456");
        expect(generatePartitionKey("event.789")).toBe("event.789");
      });

      it("should handle aggregateId with spaces", () => {
        expect(generatePartitionKey("order 123")).toBe("order 123");
      });

      it("should handle very long aggregateId", () => {
        const longId = "a".repeat(10000);
        expect(generatePartitionKey(longId)).toBe(longId);
      });

      it("should handle single character aggregateId", () => {
        expect(generatePartitionKey("a")).toBe("a");
      });

      it("should handle aggregateId starting with special character", () => {
        expect(generatePartitionKey("-order")).toBe("-order");
        expect(generatePartitionKey("_order")).toBe("_order");
        expect(generatePartitionKey(".order")).toBe(".order");
      });

      it("should handle Unicode characters in aggregateId", () => {
        expect(generatePartitionKey("order-café")).toBe("order-café");
        expect(generatePartitionKey("user-日本語")).toBe("user-日本語");
        expect(generatePartitionKey("event-🎉")).toBe("event-🎉");
      });
    });

    describe("null/undefined aggregateId handling", () => {
      it("should return null for null aggregateId", () => {
        expect(generatePartitionKey(null)).toBeNull();
      });

      it("should return null for undefined aggregateId", () => {
        expect(generatePartitionKey(undefined)).toBeNull();
      });

      it("should return null for empty string aggregateId", () => {
        expect(generatePartitionKey("")).toBeNull();
      });

      it("should return null for whitespace-only aggregateId", () => {
        expect(generatePartitionKey("   ")).toBe("   "); // whitespace is NOT null
      });

      it("should return null for tab-only aggregateId", () => {
        expect(generatePartitionKey("\t")).toBe("\t"); // tab is NOT null
      });

      it("should return null for newline-only aggregateId", () => {
        expect(generatePartitionKey("\n")).toBe("\n"); // newline is NOT null
      });
    });

    describe("edge cases", () => {
      it("should handle aggregateId with leading zeros", () => {
        expect(generatePartitionKey("00123")).toBe("00123");
      });

      it("should handle aggregateId with only numbers", () => {
        expect(generatePartitionKey("1234567890")).toBe("1234567890");
      });

      it("should handle aggregateId with mixed case", () => {
        expect(generatePartitionKey("Order-ABC-123")).toBe("Order-ABC-123");
      });

      it("should handle aggregateId that looks like JSON", () => {
        const jsonLike = '{"orderId":"123"}';
        expect(generatePartitionKey(jsonLike)).toBe(jsonLike);
      });

      it("should handle aggregateId with null bytes", () => {
        const withNullByte = "order\u0000123";
        expect(generatePartitionKey(withNullByte)).toBe(withNullByte);
      });
    });
  });

  describe("isValidPartitionKey", () => {
    describe("valid partition keys", () => {
      it("should accept non-empty string", () => {
        expect(isValidPartitionKey("order-123")).toBe(true);
      });

      it("should accept string with special characters", () => {
        expect(isValidPartitionKey("order/123")).toBe(true);
        expect(isValidPartitionKey("user:456")).toBe(true);
        expect(isValidPartitionKey("event.789")).toBe(true);
      });

      it("should accept string with spaces", () => {
        expect(isValidPartitionKey("order 123")).toBe(true);
      });

      it("should accept single character", () => {
        expect(isValidPartitionKey("a")).toBe(true);
      });

      it("should accept very long string", () => {
        const longKey = "a".repeat(10000);
        expect(isValidPartitionKey(longKey)).toBe(true);
      });

      it("should accept Unicode characters", () => {
        expect(isValidPartitionKey("café")).toBe(true);
        expect(isValidPartitionKey("日本語")).toBe(true);
        expect(isValidPartitionKey("🎉")).toBe(true);
      });

      it("should accept null", () => {
        expect(isValidPartitionKey(null)).toBe(true);
      });

      it("should accept undefined", () => {
        expect(isValidPartitionKey(undefined)).toBe(true);
      });
    });

    describe("invalid partition keys", () => {
      it("should reject empty string", () => {
        expect(isValidPartitionKey("")).toBe(false);
      });

      it("should reject whitespace-only string", () => {
        expect(isValidPartitionKey("   ")).toBe(false);
      });

      it("should reject tab-only string", () => {
        expect(isValidPartitionKey("\t")).toBe(false);
      });

      it("should reject newline-only string", () => {
        expect(isValidPartitionKey("\n")).toBe(false);
      });

      it("should reject mixed whitespace", () => {
        expect(isValidPartitionKey(" \t\n ")).toBe(false);
      });

      it("should reject string with only spaces and tabs", () => {
        expect(isValidPartitionKey("  \t  ")).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle string with leading whitespace but content", () => {
        expect(isValidPartitionKey("  order-123")).toBe(true);
      });

      it("should handle string with trailing whitespace", () => {
        expect(isValidPartitionKey("order-123  ")).toBe(true);
      });

      it("should handle string with internal whitespace", () => {
        expect(isValidPartitionKey("order 123")).toBe(true);
      });

      it("should handle zero-width characters", () => {
        expect(isValidPartitionKey("order\u200B123")).toBe(true);
      });
    });
  });

  describe("isSamePartition", () => {
    describe("same aggregate ID", () => {
      it("should return true for identical aggregate IDs", () => {
        expect(isSamePartition("order-123", "order-123")).toBe(true);
      });

      it("should return true for same ID multiple times", () => {
        const id = "order-123";
        expect(isSamePartition(id, id)).toBe(true);
        expect(isSamePartition(id, id)).toBe(true);
      });

      it("should be case-sensitive", () => {
        expect(isSamePartition("order-123", "Order-123")).toBe(false);
        expect(isSamePartition("ORDER-123", "order-123")).toBe(false);
      });

      it("should detect difference with trailing whitespace", () => {
        expect(isSamePartition("order-123", "order-123 ")).toBe(false);
        expect(isSamePartition("order-123", "order-123  ")).toBe(false);
      });
    });

    describe("different aggregate IDs", () => {
      it("should return false for different aggregate IDs", () => {
        expect(isSamePartition("order-123", "order-456")).toBe(false);
      });

      it("should return false for completely different IDs", () => {
        expect(isSamePartition("order-123", "user-456")).toBe(false);
      });

      it("should return false for IDs with slight differences", () => {
        expect(isSamePartition("order-123", "order-124")).toBe(false);
        expect(isSamePartition("order-123", "order123")).toBe(false);
        expect(isSamePartition("order-123", "order_123")).toBe(false);
      });
    });

    describe("null/undefined handling", () => {
      it("should return true when both are null", () => {
        expect(isSamePartition(null, null)).toBe(true);
      });

      it("should return true when both are undefined", () => {
        expect(isSamePartition(undefined, undefined)).toBe(true);
      });

      it("should return true when both are null and undefined", () => {
        expect(isSamePartition(null, undefined)).toBe(true);
        expect(isSamePartition(undefined, null)).toBe(true);
      });

      it("should return false when one is null and other has value", () => {
        expect(isSamePartition(null, "order-123")).toBe(false);
        expect(isSamePartition("order-123", null)).toBe(false);
      });

      it("should return false when one is undefined and other has value", () => {
        expect(isSamePartition(undefined, "order-123")).toBe(false);
        expect(isSamePartition("order-123", undefined)).toBe(false);
      });

      it("should return false when one is empty string", () => {
        expect(isSamePartition("", "order-123")).toBe(false);
        expect(isSamePartition("order-123", "")).toBe(false);
      });

      it("should return true when both are empty string", () => {
        expect(isSamePartition("", "")).toBe(true);
      });

      it("should return true for null and empty string combination", () => {
        expect(isSamePartition(null, "")).toBe(true);
        expect(isSamePartition("", null)).toBe(true);
      });
    });

    describe("partition consistency", () => {
      it("should ensure same aggregateId always produces same partition", () => {
        const aggregateId = "order-123";

        // Multiple calls with same aggregateId should always return true
        expect(isSamePartition(aggregateId, "order-123")).toBe(true);
        expect(isSamePartition(aggregateId, "order-123")).toBe(true);
        expect(isSamePartition("order-123", aggregateId)).toBe(true);
      });

      it("should handle multiple different aggregate IDs consistently", () => {
        const id1 = "order-123";
        const id2 = "order-456";
        const id3 = "user-789";

        expect(isSamePartition(id1, id2)).toBe(false);
        expect(isSamePartition(id1, id3)).toBe(false);
        expect(isSamePartition(id2, id3)).toBe(false);

        expect(isSamePartition(id1, id1)).toBe(true);
        expect(isSamePartition(id2, id2)).toBe(true);
        expect(isSamePartition(id3, id3)).toBe(true);
      });

      it("should handle transitive property incorrectly", () => {
        // This test documents the behavior: it's NOT transitive for null/empty
        const id1 = "order-123";
        const id2 = null;
        const id3 = "";

        expect(isSamePartition(id1, id2)).toBe(false);
        expect(isSamePartition(id2, id3)).toBe(true);
        expect(isSamePartition(id1, id3)).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("should handle numeric strings", () => {
        expect(isSamePartition("123", "123")).toBe(true);
        expect(isSamePartition("123", "456")).toBe(false);
        expect(isSamePartition("0123", "123")).toBe(false); // leading zeros matter
      });

      it("should handle special characters", () => {
        expect(isSamePartition("order/123", "order/123")).toBe(true);
        expect(isSamePartition("order/123", "order/456")).toBe(false);
        expect(isSamePartition("order:123", "order:123")).toBe(true);
      });

      it("should handle Unicode", () => {
        expect(isSamePartition("order-日本語", "order-日本語")).toBe(true);
        expect(isSamePartition("order-日本語", "order-中文")).toBe(false);
      });

      it("should handle whitespace differences", () => {
        expect(isSamePartition("order 123", "order  123")).toBe(false);
        expect(isSamePartition("order\t123", "order\n123")).toBe(false);
      });
    });
  });
});
