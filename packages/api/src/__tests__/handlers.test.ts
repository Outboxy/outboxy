import { describe, it, expect, vi } from "vitest";
import {
  livenessHandler,
  readinessHandler,
} from "../handlers/health.handlers.js";
import { getEventStatusHandler } from "../handlers/events.handlers.js";
import {
  replayEventHandler,
  replayRangeHandler,
} from "../handlers/admin.handlers.js";
import { NotFoundError, InvalidStateError } from "../errors.js";

// Mock Fastify request/reply factories
function createMockReply() {
  const reply = {
    send: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
  return reply;
}

function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-123",
    params: {},
    body: {},
    server: {
      adapter: {
        checkHealth: vi.fn(),
        eventService: {
          getEventById: vi.fn(),
          replayEvent: vi.fn(),
          replayEventsInRange: vi.fn(),
        },
      },
    },
    ...overrides,
  };
}

describe("Health Handlers", () => {
  describe("livenessHandler", () => {
    it("returns ok status", async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      await livenessHandler(request as never, reply as never);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "ok",
          timestamp: expect.any(String),
          version: expect.any(String),
        }),
      );
    });
  });

  describe("readinessHandler", () => {
    it("returns ok when database is healthy", async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      request.server.adapter.checkHealth.mockResolvedValue({
        healthy: true,
        totalConnections: 10,
        idleConnections: 5,
        waitingClients: 0,
      });

      await readinessHandler(request as never, reply as never);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "ok",
          database: {
            healthy: true,
            totalConnections: 10,
            idleConnections: 5,
            waitingClients: 0,
          },
        }),
      );
    });

    it("returns 503 when database is unhealthy", async () => {
      const request = createMockRequest();
      const reply = createMockReply();

      request.server.adapter.checkHealth.mockResolvedValue({
        healthy: false,
        error: "Connection timeout",
        totalConnections: 0,
        idleConnections: 0,
        waitingClients: 5,
      });

      await readinessHandler(request as never, reply as never);

      expect(reply.status).toHaveBeenCalledWith(503);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "unhealthy",
          database: {
            healthy: false,
            error: "Connection timeout",
            totalConnections: 0,
            idleConnections: 0,
            waitingClients: 5,
          },
        }),
      );
    });
  });
});

describe("Event Handlers", () => {
  describe("getEventStatusHandler", () => {
    const eventId = "550e8400-e29b-41d4-a716-446655440000";

    it("returns event details when found", async () => {
      const mockEvent = {
        id: eventId,
        aggregateType: "Order",
        aggregateId: "order-123",
        eventType: "OrderCreated",
        eventVersion: 1,
        payload: { orderId: "123" },
        headers: {},
        destinationUrl: "https://webhook.example.com",
        destinationType: "http",
        idempotencyKey: null,
        status: "pending",
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: null,
        lastError: null,
        metadata: {},
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        processingStartedAt: null,
        processedAt: null,
      };

      const request = createMockRequest({
        params: { id: eventId },
      });
      const reply = createMockReply();

      request.server.adapter.eventService.getEventById.mockResolvedValue(
        mockEvent,
      );

      await getEventStatusHandler(request as never, reply as never);

      expect(
        request.server.adapter.eventService.getEventById,
      ).toHaveBeenCalledWith(eventId);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          id: eventId,
          status: "pending",
          aggregateType: "Order",
        }),
      );
    });

    it("throws NotFoundError when event not found", async () => {
      const request = createMockRequest({
        params: { id: eventId },
      });
      const reply = createMockReply();

      request.server.adapter.eventService.getEventById.mockResolvedValue(null);

      await expect(
        getEventStatusHandler(request as never, reply as never),
      ).rejects.toThrow(NotFoundError);
    });
  });
});

describe("Admin Handlers", () => {
  describe("replayEventHandler", () => {
    const eventId = "550e8400-e29b-41d4-a716-446655440000";

    it("replays event successfully", async () => {
      const request = createMockRequest({
        params: { id: eventId },
      });
      const reply = createMockReply();

      request.server.adapter.eventService.replayEvent.mockResolvedValue({
        id: eventId,
        previousStatus: "dlq",
        newStatus: "pending",
        replayedAt: new Date("2024-01-01"),
      });

      await replayEventHandler(request as never, reply as never);

      expect(reply.send).toHaveBeenCalledWith({
        id: eventId,
        previousStatus: "dlq",
        newStatus: "pending",
        replayedAt: "2024-01-01T00:00:00.000Z",
      });
    });

    it("throws NotFoundError when event not found", async () => {
      const request = createMockRequest({
        params: { id: eventId },
      });
      const reply = createMockReply();

      request.server.adapter.eventService.replayEvent.mockResolvedValue(null);
      request.server.adapter.eventService.getEventById.mockResolvedValue(null);

      await expect(
        replayEventHandler(request as never, reply as never),
      ).rejects.toThrow(NotFoundError);
    });

    it("throws InvalidStateError when event cannot be replayed", async () => {
      const request = createMockRequest({
        params: { id: eventId },
      });
      const reply = createMockReply();

      request.server.adapter.eventService.replayEvent.mockResolvedValue(null);
      request.server.adapter.eventService.getEventById.mockResolvedValue({
        id: eventId,
        status: "pending",
      });

      await expect(
        replayEventHandler(request as never, reply as never),
      ).rejects.toThrow(InvalidStateError);
    });
  });

  describe("replayRangeHandler", () => {
    it("replays events in range successfully", async () => {
      const request = createMockRequest({
        body: {
          startDate: "2024-01-01T00:00:00Z",
          endDate: "2024-01-31T23:59:59Z",
          status: "dlq",
          limit: 100,
        },
      });
      const reply = createMockReply();

      request.server.adapter.eventService.replayEventsInRange.mockResolvedValue(
        {
          replayedCount: 5,
          eventIds: ["id-1", "id-2", "id-3", "id-4", "id-5"],
        },
      );

      await replayRangeHandler(request as never, reply as never);

      expect(
        request.server.adapter.eventService.replayEventsInRange,
      ).toHaveBeenCalledWith({
        startDate: new Date("2024-01-01T00:00:00Z"),
        endDate: new Date("2024-01-31T23:59:59Z"),
        status: "dlq",
        aggregateType: undefined,
        limit: 100,
      });

      expect(reply.send).toHaveBeenCalledWith({
        replayedCount: 5,
        eventIds: ["id-1", "id-2", "id-3", "id-4", "id-5"],
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-31T23:59:59Z",
        status: "dlq",
      });
    });
  });
});
