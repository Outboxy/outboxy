import { describe, it, expect } from "vitest";
import { WebhookBatchSchema, WebhookEventSchema } from "../webhook.js";

describe("WebhookEventSchema", () => {
  it("should parse a valid event", () => {
    const event = {
      eventId: "evt-123",
      eventType: "OrderCreated",
      aggregateType: "Order",
      aggregateId: "order-456",
      payload: { amount: 100 },
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    expect(WebhookEventSchema.parse(event)).toEqual(event);
  });

  it("should reject missing required fields", () => {
    expect(() => WebhookEventSchema.parse({ eventId: "x" })).toThrow();
  });

  it("should reject invalid createdAt format", () => {
    expect(() =>
      WebhookEventSchema.parse({
        eventId: "evt-1",
        eventType: "Test",
        aggregateType: "Test",
        aggregateId: "1",
        payload: {},
        createdAt: "not-a-date",
      }),
    ).toThrow();
  });
});

describe("WebhookBatchSchema", () => {
  const validEvent = {
    eventId: "evt-1",
    eventType: "OrderCreated",
    aggregateType: "Order",
    aggregateId: "order-1",
    payload: { amount: 100 },
    createdAt: "2024-01-01T00:00:00.000Z",
  };

  it("should parse a valid batch", () => {
    const batch = {
      batch: true,
      count: 2,
      events: [validEvent, { ...validEvent, eventId: "evt-2" }],
    };
    expect(WebhookBatchSchema.parse(batch)).toEqual(batch);
  });

  it("should parse a single-event batch", () => {
    const batch = {
      batch: true,
      count: 1,
      events: [validEvent],
    };
    expect(WebhookBatchSchema.parse(batch)).toEqual(batch);
  });

  it("should reject count mismatch", () => {
    const batch = {
      batch: true,
      count: 5,
      events: [validEvent],
    };
    expect(() => WebhookBatchSchema.parse(batch)).toThrow("count must match");
  });

  it("should reject missing required fields", () => {
    expect(() => WebhookBatchSchema.parse({ batch: true })).toThrow();
  });

  it("should reject batch: false", () => {
    const batch = { batch: false, count: 1, events: [validEvent] };
    expect(() => WebhookBatchSchema.parse(batch)).toThrow();
  });

  it("should reject invalid createdAt format in events", () => {
    const batch = {
      batch: true,
      count: 1,
      events: [{ ...validEvent, createdAt: "invalid" }],
    };
    expect(() => WebhookBatchSchema.parse(batch)).toThrow();
  });
});
