import { vi } from "vitest";
import type { InboxSqlDialect, SqlDialect } from "@outboxy/dialect-core";
import type { QueryFn } from "../../types.js";

type MockQueryRow = { id: string; [key: string]: string };

export function mockQueryFn() {
  return vi.fn<(sql: string, params: unknown[]) => Promise<MockQueryRow[]>>();
}

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const DEFAULT_DESTINATION_URL = "https://webhook.example.com";

export const BASE_OUTBOX_EVENT = {
  aggregateType: "Order",
  aggregateId: "123",
  eventType: "OrderCreated",
  payload: { orderId: "123" },
} as const;

export function makeAdapter(queryFn: QueryFn) {
  return (_executor: unknown) => queryFn;
}

export function makeOutboxDialect(
  overrides: Partial<SqlDialect> = {},
): SqlDialect {
  return {
    name: "postgresql",
    supportsReturning: true,
    maxParameters: 65535,
    placeholder: (i) => `$${i}`,
    buildInsert: () => ({ sql: "INSERT INTO outbox_events", params: [] }),
    buildBulkInsert: () => ({
      sql: "INSERT INTO outbox_events BULK",
      params: [],
    }),
    ...overrides,
  } as SqlDialect;
}

export function makeInboxDialect(
  overrides: Partial<InboxSqlDialect> = {},
): InboxSqlDialect {
  return {
    name: "postgresql",
    supportsReturning: true,
    maxParameters: 65535,
    placeholder: (i) => `$${i}`,
    buildInboxInsert: () => ({ sql: "INSERT INTO inbox_events", params: [] }),
    buildInboxBulkInsert: () => ({
      sql: "INSERT INTO inbox_events BULK",
      params: [],
    }),
    buildMarkFailed: () => ({
      sql: "UPDATE inbox_events SET status = failed",
      params: [],
    }),
    buildFindByIdempotencyKeys: () => ({
      sql: "SELECT id, idempotency_key FROM inbox_events",
      params: [],
    }),
    buildCleanupProcessedEvents: () => ({
      sql: "DELETE FROM inbox_events",
      params: [],
    }),
    ...overrides,
  } as InboxSqlDialect;
}
