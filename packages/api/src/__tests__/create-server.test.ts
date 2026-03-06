import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createServer } from "../index.js";
import { createMockAdapter } from "./helpers.js";

describe("createServer", () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server?.close();
  });

  async function buildServer(): Promise<FastifyInstance> {
    server = await createServer({
      adapter: createMockAdapter(),
      config: { swaggerEnabled: false, nodeEnv: "test" },
    });
    return server;
  }

  it("creates a Fastify server instance with inject method", async () => {
    const srv = await buildServer();
    expect(typeof srv.inject).toBe("function");
  });

  it("responds to liveness probe at /health with status ok", async () => {
    const srv = await buildServer();

    const response = await srv.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });

  it("responds to readiness probe at /ready with status ok and db info", async () => {
    const srv = await buildServer();

    const response = await srv.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("ok");
    expect(body.database.healthy).toBe(true);
    expect(body.database.totalConnections).toBe(1);
  });

  it("responds 404 for unknown routes", async () => {
    const srv = await buildServer();

    const response = await srv.inject({ method: "GET", url: "/nonexistent" });

    expect(response.statusCode).toBe(404);
  });
});
