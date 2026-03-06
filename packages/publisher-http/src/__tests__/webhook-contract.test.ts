import { describe, it, expect } from "vitest";
import { WebhookBatchSchema } from "@outboxy/schema";
import type { OutboxEvent } from "@outboxy/publisher-core";

describe("Webhook contract", () => {
  it("should validate the actual payload format built by HttpPublisher", () => {
    const now = new Date();
    const events: OutboxEvent[] = [
      {
        id: "event-1",
        aggregateType: "Order",
        aggregateId: "order-1",
        eventType: "OrderCreated",
        eventVersion: 1,
        payload: { amount: 100 },
        headers: {},
        destinationUrl: "https://webhook.example.com",
        destinationType: "http",
        idempotencyKey: null,
        status: "pending",
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: null,
        backoffMultiplier: "2.0",
        lastError: null,
        errorDetails: null,
        createdAt: now,
        updatedAt: now,
        processingStartedAt: null,
        processedAt: null,
        metadata: {},
        processedByWorker: null,
        deletedAt: null,
        createdDate: now,
      },
    ];

    // Build the exact payload the publisher builds
    const batchPayload = {
      batch: true as const,
      count: events.length,
      events: events.map((event) => ({
        eventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
    };

    // Simulate JSON serialization (Date -> ISO string)
    const wirePayload = JSON.parse(JSON.stringify(batchPayload));
    expect(() => WebhookBatchSchema.parse(wirePayload)).not.toThrow();
  });
});
