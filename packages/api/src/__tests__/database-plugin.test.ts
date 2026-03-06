import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { DatabaseAdapter } from "@outboxy/db-adapter-core";
import databasePlugin from "../plugins/database.plugin.js";
import { createMockAdapter } from "./helpers.js";

describe("Database Plugin", () => {
  let app: FastifyInstance;
  const mockAdapter = createMockAdapter();

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(databasePlugin, { adapter: mockAdapter });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("decorates fastify instance with the exact adapter instance", () => {
    expect((app as unknown as Record<string, unknown>).adapter).toBe(
      mockAdapter,
    );
  });

  it("preserves adapter's eventService reference on the decorated instance", () => {
    const adapter = (app as unknown as Record<string, unknown>)
      .adapter as DatabaseAdapter;
    expect(adapter.eventService).toBe(mockAdapter.eventService);
  });
});
