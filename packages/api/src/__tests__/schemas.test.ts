import { describe, it, expect } from "vitest";
import {
  errorResponseSchema,
  uuidSchema,
  paginationQuerySchema,
  dateRangeSchema,
  eventStatusEnum,
  destinationTypeEnum,
} from "../schemas/common.schemas.js";
import {
  getEventParamsSchema,
  eventStatusResponseSchema,
} from "../schemas/event.schemas.js";
import {
  replayEventParamsSchema,
  replayRangeBodySchema,
  replayEventResponseSchema,
  replayRangeResponseSchema,
} from "../schemas/admin.schemas.js";

describe("Common Schemas", () => {
  describe("uuidSchema", () => {
    it("accepts valid UUIDs", () => {
      const validUuid = "550e8400-e29b-41d4-a716-446655440000";
      expect(uuidSchema.parse(validUuid)).toBe(validUuid);
    });

    it("rejects invalid UUIDs", () => {
      expect(() => uuidSchema.parse("not-a-uuid")).toThrow();
      expect(() => uuidSchema.parse("")).toThrow();
      expect(() => uuidSchema.parse("123")).toThrow();
    });
  });

  describe("paginationQuerySchema", () => {
    it("applies defaults", () => {
      const result = paginationQuerySchema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("accepts valid values", () => {
      const result = paginationQuerySchema.parse({ page: 5, limit: 50 });
      expect(result.page).toBe(5);
      expect(result.limit).toBe(50);
    });

    it("coerces string values", () => {
      const result = paginationQuerySchema.parse({ page: "3", limit: "25" });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(25);
    });

    it("rejects page <= 0", () => {
      expect(() => paginationQuerySchema.parse({ page: 0 })).toThrow();
      expect(() => paginationQuerySchema.parse({ page: -1 })).toThrow();
    });

    it("rejects limit > 100", () => {
      expect(() => paginationQuerySchema.parse({ limit: 101 })).toThrow();
    });
  });

  describe("dateRangeSchema", () => {
    it("accepts valid ISO dates", () => {
      const result = dateRangeSchema.parse({
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-31T23:59:59Z",
      });
      expect(result.startDate).toBe("2024-01-01T00:00:00Z");
      expect(result.endDate).toBe("2024-01-31T23:59:59Z");
    });

    it("rejects invalid date formats", () => {
      expect(() =>
        dateRangeSchema.parse({
          startDate: "2024-01-01",
          endDate: "2024-01-31",
        }),
      ).toThrow();
    });
  });

  describe("eventStatusEnum", () => {
    it("accepts valid statuses", () => {
      const validStatuses = [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "dlq",
        "cancelled",
      ];
      validStatuses.forEach((status) => {
        expect(eventStatusEnum.parse(status)).toBe(status);
      });
    });

    it("rejects invalid statuses", () => {
      expect(() => eventStatusEnum.parse("invalid")).toThrow();
      expect(() => eventStatusEnum.parse("PENDING")).toThrow();
    });
  });

  describe("destinationTypeEnum", () => {
    it("accepts valid destination types", () => {
      const validTypes = ["http", "kafka", "sqs", "rabbitmq", "pubsub"];
      validTypes.forEach((type) => {
        expect(destinationTypeEnum.parse(type)).toBe(type);
      });
    });

    it("rejects invalid destination types", () => {
      expect(() => destinationTypeEnum.parse("invalid")).toThrow();
      expect(() => destinationTypeEnum.parse("HTTP")).toThrow();
    });
  });

  describe("errorResponseSchema", () => {
    it("validates error response", () => {
      const result = errorResponseSchema.parse({
        statusCode: 404,
        error: "Not Found",
        message: "Resource not found",
      });
      expect(result.statusCode).toBe(404);
      expect(result.error).toBe("Not Found");
      expect(result.message).toBe("Resource not found");
    });

    it("accepts optional fields", () => {
      const result = errorResponseSchema.parse({
        statusCode: 400,
        error: "Validation Error",
        message: "Invalid input",
        requestId: "req-123",
        details: { field: "email" },
      });
      expect(result.requestId).toBe("req-123");
      expect(result.details).toEqual({ field: "email" });
    });
  });
});

describe("Event Schemas", () => {
  describe("getEventParamsSchema", () => {
    it("accepts valid UUID", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = getEventParamsSchema.parse({ id: uuid });
      expect(result.id).toBe(uuid);
    });

    it("rejects invalid UUID", () => {
      expect(() => getEventParamsSchema.parse({ id: "invalid" })).toThrow();
    });
  });

  describe("eventStatusResponseSchema", () => {
    it("validates complete event response", () => {
      const event = {
        id: "550e8400-e29b-41d4-a716-446655440000",
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        eventVersion: 1,
        payload: { orderId: "123" },
        headers: { "x-trace-id": "trace-1" },
        destinationUrl: "https://webhook.example.com",
        destinationType: "http",
        idempotencyKey: "idem-key-123",
        status: "pending",
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: null,
        lastError: null,
        metadata: {},
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        processingStartedAt: null,
        processedAt: null,
      };

      const result = eventStatusResponseSchema.parse(event);
      expect(result.id).toBe(event.id);
      expect(result.status).toBe("pending");
      expect(result.destinationType).toBe("http");
    });
  });
});

describe("Admin Schemas", () => {
  describe("replayEventParamsSchema", () => {
    it("accepts valid UUID", () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const result = replayEventParamsSchema.parse({ id: uuid });
      expect(result.id).toBe(uuid);
    });
  });

  describe("replayRangeBodySchema", () => {
    it("applies defaults", () => {
      const result = replayRangeBodySchema.parse({
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-31T23:59:59Z",
      });
      expect(result.status).toBe("dlq");
      expect(result.limit).toBe(100);
    });

    it("accepts all fields", () => {
      const result = replayRangeBodySchema.parse({
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-31T23:59:59Z",
        status: "failed",
        aggregateType: "Order",
        limit: 50,
      });
      expect(result.status).toBe("failed");
      expect(result.aggregateType).toBe("Order");
      expect(result.limit).toBe(50);
    });

    it("rejects startDate >= endDate", () => {
      expect(() =>
        replayRangeBodySchema.parse({
          startDate: "2024-01-31T00:00:00Z",
          endDate: "2024-01-01T00:00:00Z",
        }),
      ).toThrow("startDate must be before endDate");
    });

    it("rejects invalid status", () => {
      expect(() =>
        replayRangeBodySchema.parse({
          startDate: "2024-01-01T00:00:00Z",
          endDate: "2024-01-31T23:59:59Z",
          status: "pending",
        }),
      ).toThrow();
    });

    it("rejects limit > 1000", () => {
      expect(() =>
        replayRangeBodySchema.parse({
          startDate: "2024-01-01T00:00:00Z",
          endDate: "2024-01-31T23:59:59Z",
          limit: 1001,
        }),
      ).toThrow();
    });
  });

  describe("replayEventResponseSchema", () => {
    it("validates replay response", () => {
      const result = replayEventResponseSchema.parse({
        id: "550e8400-e29b-41d4-a716-446655440000",
        previousStatus: "dlq",
        newStatus: "pending",
        replayedAt: "2024-01-01T00:00:00Z",
      });
      expect(result.previousStatus).toBe("dlq");
      expect(result.newStatus).toBe("pending");
    });
  });

  describe("replayRangeResponseSchema", () => {
    it("validates range replay response", () => {
      const result = replayRangeResponseSchema.parse({
        replayedCount: 5,
        eventIds: [
          "550e8400-e29b-41d4-a716-446655440000",
          "550e8400-e29b-41d4-a716-446655440001",
        ],
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-31T23:59:59Z",
        status: "dlq",
      });
      expect(result.replayedCount).toBe(5);
      expect(result.eventIds).toHaveLength(2);
    });
  });
});
