/**
 * Idempotency Key Validation Unit Tests
 *
 * Tests SDK validation of idempotency keys to ensure:
 * - Length limits match database constraints (255 chars)
 * - Format requirements are enforced
 * - Empty/null values are rejected
 * - Special characters are handled correctly
 *
 * These are unit tests - no database or I/O operations.
 */

import { describe, it, expect } from "vitest";
import { OutboxyClient } from "../../index.js";
import { OutboxyValidationError } from "../../errors.js";
import { PostgreSqlDialect } from "@outboxy/dialect-postgres";

describe("Idempotency Key Validation", () => {
  // Mock adapter that simulates successful database operations
  // Returns array of IDs matching the number of events in a batch
  const mockAdapter = () => async (_sql: string, _params: unknown[]) => {
    // For bulk insert, detect if there are multiple events by checking parameter count
    // Each event has ~12-13 parameters, so we can estimate
    const estimatedEventCount = Math.ceil(_params.length / 13);
    const ids = Array.from(
      { length: Math.max(1, estimatedEventCount) },
      (_, i) => ({
        id: `test-event-id-${i}`,
      }),
    );
    return ids;
  };

  const createTestClient = () =>
    new OutboxyClient({
      dialect: new PostgreSqlDialect(),
      adapter: mockAdapter,
      defaultDestinationUrl: "https://webhook.example.com",
    });

  describe("Length validation", () => {
    it("should accept idempotency key at exactly 255 characters", async () => {
      const client = createTestClient();
      const maxLengthKey = "a".repeat(255);

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: maxLengthKey,
      };

      const executor = {} as unknown;

      // Should not throw validation error
      await expect(client.publish(event, executor)).resolves.toBeDefined();
    });

    it("should reject idempotency key exceeding 255 characters", async () => {
      const client = createTestClient();
      const tooLongKey = "a".repeat(256);

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: tooLongKey,
      };

      const executor = {} as unknown;

      await expect(client.publish(event, executor)).rejects.toThrow(
        OutboxyValidationError,
      );
      await expect(client.publish(event, executor)).rejects.toThrow(
        "Idempotency key cannot exceed 255 characters",
      );
    });

    it("should reject idempotency key with exactly 0 characters (empty string)", async () => {
      const client = createTestClient();

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "",
      };

      const executor = {} as unknown;

      await expect(client.publish(event, executor)).rejects.toThrow(
        OutboxyValidationError,
      );
      await expect(client.publish(event, executor)).rejects.toThrow(
        "Idempotency key cannot be empty",
      );
    });

    it("should include field name in validation error for length violation", async () => {
      const client = createTestClient();
      const tooLongKey = "x".repeat(300);

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: tooLongKey,
      };

      const executor = {} as unknown;

      try {
        await client.publish(event, executor);
        expect.fail("Should have thrown OutboxyValidationError");
      } catch (error) {
        expect(error).toBeInstanceOf(OutboxyValidationError);
        if (error instanceof OutboxyValidationError) {
          expect(error.field).toBe("idempotencyKey");
        }
      }
    });
  });

  describe("Special character handling", () => {
    it("should accept valid alphanumeric characters", async () => {
      const client = createTestClient();

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "order-123-ABC-456",
      };

      const executor = {} as unknown;

      // Should not throw validation error
      await expect(client.publish(event, executor)).resolves.toBeDefined();
    });

    it("should accept dashes and underscores", async () => {
      const client = createTestClient();

      const dashKey = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "order-created-123",
      };

      const underscoreKey = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "order_created_123",
      };

      const mixedKey = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "order-created_123_test",
      };

      const executor = {} as unknown;

      // All should pass validation
      await expect(client.publish(dashKey, executor)).resolves.toBeDefined();
      await expect(
        client.publish(underscoreKey, executor),
      ).resolves.toBeDefined();
      await expect(client.publish(mixedKey, executor)).resolves.toBeDefined();
    });

    it("should reject spaces in idempotency key", async () => {
      const client = createTestClient();

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "order 123",
      };

      const executor = {} as unknown;

      await expect(client.publish(event, executor)).rejects.toThrow(
        "Idempotency key must contain only alphanumeric characters, dashes, underscores, dots, colons, and forward slashes",
      );
    });

    it("should reject special characters (@, #, $, etc.)", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const specialChars = ["@", "#", "$", "%", "^", "&", "*", "(", ")"];

      for (const char of specialChars) {
        const event = {
          aggregateType: "Order",
          aggregateId: "123",
          eventType: "OrderCreated",
          payload: { orderId: "123" },
          idempotencyKey: `order${char}123`,
        };

        await expect(client.publish(event, executor)).rejects.toThrow(
          OutboxyValidationError,
        );
        await expect(client.publish(event, executor)).rejects.toThrow(
          "Idempotency key must contain only alphanumeric characters, dashes, underscores, dots, colons, and forward slashes",
        );
      }
    });

    it("should accept dots, colons, and forward slashes", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const validKeys = [
        "order.123",
        "kafka:partition:0",
        "user/123/created",
        "order.v2:user-123/create",
      ];

      for (const key of validKeys) {
        const event = {
          aggregateType: "Order",
          aggregateId: "123",
          eventType: "OrderCreated",
          payload: { orderId: "123" },
          idempotencyKey: key,
        };

        await expect(client.publish(event, executor)).resolves.toBeDefined();
      }
    });

    it("should reject backslashes and semicolons", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const invalidKeys = ["order\\123", "order;123"];

      for (const key of invalidKeys) {
        const event = {
          aggregateType: "Order",
          aggregateId: "123",
          eventType: "OrderCreated",
          payload: { orderId: "123" },
          idempotencyKey: key,
        };

        await expect(client.publish(event, executor)).rejects.toThrow(
          OutboxyValidationError,
        );
      }
    });

    it("should reject unicode characters", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const unicodeKeys = ["order-café", "订单-123", "тест-123"];

      for (const key of unicodeKeys) {
        const event = {
          aggregateType: "Order",
          aggregateId: "123",
          eventType: "OrderCreated",
          payload: { orderId: "123" },
          idempotencyKey: key,
        };

        await expect(client.publish(event, executor)).rejects.toThrow(
          OutboxyValidationError,
        );
      }
    });
  });

  describe("Empty and null handling", () => {
    it("should allow undefined idempotency key (optional field)", async () => {
      const client = createTestClient();

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        // idempotencyKey not provided
      };

      const executor = {} as unknown;

      // Should not throw validation error
      await expect(client.publish(event, executor)).resolves.toBeDefined();
    });

    it("should reject empty string idempotency key", async () => {
      const client = createTestClient();

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "",
      };

      const executor = {} as unknown;

      await expect(client.publish(event, executor)).rejects.toThrow(
        OutboxyValidationError,
      );
      await expect(client.publish(event, executor)).rejects.toThrow(
        "Idempotency key cannot be empty",
      );
    });
  });

  describe("Valid format acceptance", () => {
    it("should accept simple lowercase keys", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "ordercreated123",
      };

      await expect(client.publish(event, executor)).resolves.toBeDefined();
    });

    it("should accept simple uppercase keys", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "ORDERCREATED123",
      };

      await expect(client.publish(event, executor)).resolves.toBeDefined();
    });

    it("should accept mixed case keys", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "OrderCreated123",
      };

      await expect(client.publish(event, executor)).resolves.toBeDefined();
    });

    it("should accept numeric-only keys", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "123456789",
      };

      await expect(client.publish(event, executor)).resolves.toBeDefined();
    });

    it("should accept UUID-like format", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const event = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "order-123-a1b2c3d4-e5f6-7890",
      };

      await expect(client.publish(event, executor)).resolves.toBeDefined();
    });

    it("should accept common idempotency key patterns", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const validPatterns = [
        "order-created-123",
        "user_updated_456",
        "payment-123-processed",
        "OrderCreated-123-20240101",
        "ORDER_123_USER_456",
        "123-order-created",
        "order_123_v2",
      ];

      for (const key of validPatterns) {
        const event = {
          aggregateType: "Order",
          aggregateId: "123",
          eventType: "OrderCreated",
          payload: { orderId: "123" },
          idempotencyKey: key,
        };

        await expect(client.publish(event, executor)).resolves.toBeDefined();
      }
    });

    it("should accept keys with leading/trailing separators", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const leadingDash = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "-order-123",
      };

      const trailingUnderscore = {
        aggregateType: "Order",
        aggregateId: "123",
        eventType: "OrderCreated",
        payload: { orderId: "123" },
        idempotencyKey: "order_123_",
      };

      await expect(
        client.publish(leadingDash, executor),
      ).resolves.toBeDefined();
      await expect(
        client.publish(trailingUnderscore, executor),
      ).resolves.toBeDefined();
    });
  });

  describe("Batch validation", () => {
    it("should validate idempotency keys in batch publish", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const events = [
        {
          aggregateType: "Order",
          aggregateId: "1",
          eventType: "OrderCreated",
          payload: { orderId: "1" },
          idempotencyKey: "order-1",
        },
        {
          aggregateType: "Order",
          aggregateId: "2",
          eventType: "OrderCreated",
          payload: { orderId: "2" },
          idempotencyKey: "order-2",
        },
        {
          aggregateType: "Order",
          aggregateId: "3",
          eventType: "OrderCreated",
          payload: { orderId: "3" },
          idempotencyKey: "invalid key!", // Invalid: contains space and exclamation
        },
      ];

      await expect(client.publishBatch(events, executor)).rejects.toThrow(
        OutboxyValidationError,
      );
    });

    it("should validate idempotency key length in batch publish", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const events = [
        {
          aggregateType: "Order",
          aggregateId: "1",
          eventType: "OrderCreated",
          payload: { orderId: "1" },
          idempotencyKey: "order-1",
        },
        {
          aggregateType: "Order",
          aggregateId: "2",
          eventType: "OrderCreated",
          payload: { orderId: "2" },
          idempotencyKey: "x".repeat(300), // Too long
        },
      ];

      await expect(client.publishBatch(events, executor)).rejects.toThrow(
        "Idempotency key cannot exceed 255 characters",
      );
    });

    it("should accept all valid idempotency keys in batch", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const events = [
        {
          aggregateType: "Order",
          aggregateId: "1",
          eventType: "OrderCreated",
          payload: { orderId: "1" },
          idempotencyKey: "order-1",
        },
        {
          aggregateType: "Order",
          aggregateId: "2",
          eventType: "OrderCreated",
          payload: { orderId: "2" },
          idempotencyKey: "order_2",
        },
        {
          aggregateType: "Order",
          aggregateId: "3",
          eventType: "OrderCreated",
          payload: { orderId: "3" },
          idempotencyKey: "ORDER-3",
        },
      ];

      // Should not throw validation error
      const result = await client.publishBatch(events, executor);
      expect(result).toHaveLength(3);
    });
  });

  describe("Error field attribution", () => {
    it("should include field name in all validation errors", async () => {
      const client = createTestClient();
      const executor = {} as unknown;

      const testCases = [
        {
          key: "",
          expectedMessage: "cannot be empty",
        },
        {
          key: "a".repeat(256),
          expectedMessage: "cannot exceed 255 characters",
        },
        {
          key: "invalid key!",
          expectedMessage: "must contain only alphanumeric",
        },
      ];

      for (const testCase of testCases) {
        const event = {
          aggregateType: "Order",
          aggregateId: "123",
          eventType: "OrderCreated",
          payload: { orderId: "123" },
          idempotencyKey: testCase.key,
        };

        try {
          await client.publish(event, executor);
          expect.fail(`Should have thrown for key: "${testCase.key}"`);
        } catch (error) {
          expect(error).toBeInstanceOf(OutboxyValidationError);
          if (error instanceof OutboxyValidationError) {
            expect(error.field).toBe("idempotencyKey");
            expect(error.message).toContain(testCase.expectedMessage);
          }
        }
      }
    });
  });
});
