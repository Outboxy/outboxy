import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import eventsRoutes from "../routes/events.routes.js";
import healthRoutes from "../routes/health.routes.js";
import adminRoutes from "../routes/admin.routes.js";
import routes from "../routes/index.js";

function createMockFastify() {
  const instance = {
    get: vi.fn(),
    post: vi.fn(),
    register: vi.fn().mockResolvedValue(undefined),
  };
  return instance as unknown as FastifyInstance & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
  };
}

describe("Events Routes", () => {
  it("registers GET /:id with events tag and params/response schemas", async () => {
    const fastify = createMockFastify();

    await eventsRoutes(fastify, {});

    expect(fastify.get).toHaveBeenCalledOnce();

    const [path, options] = fastify.get.mock.calls[0]!;
    expect(path).toBe("/:id");
    expect(options.schema.tags).toEqual(["events"]);
    expect(options.schema.params).toBeDefined();
    expect(options.schema.response).toHaveProperty("200");
    expect(options.schema.response).toHaveProperty("404");
  });
});

describe("Health Routes", () => {
  it("registers GET /health with health tag", async () => {
    const fastify = createMockFastify();

    await healthRoutes(fastify, {});

    const calls = fastify.get.mock.calls;
    const livenessCalls = calls.filter(([path]) => path === "/health");
    expect(livenessCalls).toHaveLength(1);

    const [, options] = livenessCalls[0]!;
    expect(options.schema.tags).toEqual(["health"]);
  });

  it("registers GET /ready with health tag", async () => {
    const fastify = createMockFastify();

    await healthRoutes(fastify, {});

    const calls = fastify.get.mock.calls;
    const readinessCalls = calls.filter(([path]) => path === "/ready");
    expect(readinessCalls).toHaveLength(1);

    const [, options] = readinessCalls[0]!;
    expect(options.schema.tags).toEqual(["health"]);
  });

  it("registers exactly 2 health routes", async () => {
    const fastify = createMockFastify();

    await healthRoutes(fastify, {});

    expect(fastify.get).toHaveBeenCalledTimes(2);
  });
});

describe("Admin Routes", () => {
  it("registers POST /replay/:id with admin tag and params/response schemas", async () => {
    const fastify = createMockFastify();

    await adminRoutes(fastify, {});

    const calls = fastify.post.mock.calls;
    const replayCalls = calls.filter(([path]) => path === "/replay/:id");
    expect(replayCalls).toHaveLength(1);

    const [, options] = replayCalls[0]!;
    expect(options.schema.tags).toEqual(["admin"]);
    expect(options.schema.params).toBeDefined();
    expect(options.schema.response).toHaveProperty("200");
    expect(options.schema.response).toHaveProperty("404");
    expect(options.schema.response).toHaveProperty("422");
  });

  it("registers POST /replay/range with admin tag and body schema", async () => {
    const fastify = createMockFastify();

    await adminRoutes(fastify, {});

    const calls = fastify.post.mock.calls;
    const rangeCalls = calls.filter(([path]) => path === "/replay/range");
    expect(rangeCalls).toHaveLength(1);

    const [, options] = rangeCalls[0]!;
    expect(options.schema.tags).toEqual(["admin"]);
    expect(options.schema.body).toBeDefined();
    expect(options.schema.response).toHaveProperty("200");
  });

  it("registers exactly 2 admin routes", async () => {
    const fastify = createMockFastify();

    await adminRoutes(fastify, {});

    expect(fastify.post).toHaveBeenCalledTimes(2);
  });
});

describe("Route Aggregator (index)", () => {
  let fastify: ReturnType<typeof createMockFastify>;

  beforeEach(() => {
    fastify = createMockFastify();
  });

  it("registers health routes without prefix", async () => {
    await routes(fastify, {});

    const registerCalls = fastify.register.mock.calls;
    const healthCall = registerCalls.find(
      ([plugin]) => plugin === healthRoutes,
    );
    expect(healthCall).toBeDefined();
    expect(healthCall?.[1]).toBeUndefined();
  });

  it("registers events routes with /events prefix", async () => {
    await routes(fastify, {});

    const registerCalls = fastify.register.mock.calls;
    const eventsCall = registerCalls.find(
      ([plugin]) => plugin === eventsRoutes,
    );
    expect(eventsCall).toBeDefined();
    expect(eventsCall?.[1]).toEqual({ prefix: "/events" });
  });

  it("registers admin routes with /admin prefix", async () => {
    await routes(fastify, {});

    const registerCalls = fastify.register.mock.calls;
    const adminCall = registerCalls.find(([plugin]) => plugin === adminRoutes);
    expect(adminCall).toBeDefined();
    expect(adminCall?.[1]).toEqual({ prefix: "/admin" });
  });

  it("registers exactly 3 route groups", async () => {
    await routes(fastify, {});

    expect(fastify.register).toHaveBeenCalledTimes(3);
  });
});
