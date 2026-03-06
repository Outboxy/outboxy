import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Registry } from "prom-client";
import { createMetricsServer } from "../metrics-server.js";
import { createWorkerMetrics } from "../worker-metrics.js";

// Create a mock logger
interface MockLogger {
  info: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
}

function createMockLogger(): MockLogger {
  const mockLogger: MockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);
  return mockLogger;
}

describe("MetricsServer", () => {
  let registry: Registry;
  let logger: ReturnType<typeof createMockLogger>;
  let port: number;

  beforeEach(() => {
    registry = new Registry();
    logger = createMockLogger();
    // Let the OS assign a free port to avoid conflicts
    port = 0;
  });

  afterEach(() => {
    registry.clear();
  });

  it("should start and stop cleanly", async () => {
    const server = createMetricsServer({ port }, logger as any, registry);

    await server.start();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ port: server.getPort() }),
      "Metrics server started",
    );

    await server.stop();
    expect(logger.info).toHaveBeenCalledWith("Metrics server stopped");
  });

  it("should return actual bound port from getPort()", async () => {
    const server = createMetricsServer({ port: 0 }, logger as any, registry);
    expect(server.getPort()).toBe(0);

    await server.start();
    expect(server.getPort()).toBeGreaterThan(0);
    await server.stop();
  });

  it("should serve /metrics endpoint with Prometheus format", async () => {
    const server = createMetricsServer({ port }, logger as any, registry);
    await server.start();

    try {
      const response = await fetch(
        `http://localhost:${server.getPort()}/metrics`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/plain");

      const body = await response.text();
      // Should contain default Node.js metrics if collectDefaultMetrics was called
      expect(body).toBeDefined();
    } finally {
      await server.stop();
    }
  });

  it("should serve /health endpoint with JSON", async () => {
    const server = createMetricsServer({ port }, logger as any, registry);
    await server.start();

    try {
      const response = await fetch(
        `http://localhost:${server.getPort()}/health`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      const body = (await response.json()) as { status: string };
      expect(body.status).toBe("ok");
    } finally {
      await server.stop();
    }
  });

  it("should return 404 for unknown paths", async () => {
    const server = createMetricsServer({ port }, logger as any, registry);
    await server.start();

    try {
      const response = await fetch(
        `http://localhost:${server.getPort()}/unknown`,
      );
      expect(response.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it("should include worker metrics in /metrics output", async () => {
    const metrics = createWorkerMetrics(registry);
    const server = createMetricsServer({ port }, logger as any, registry);
    await server.start();

    try {
      // Increment a counter
      metrics.eventsPublished.inc({
        destination_type: "http",
        event_type: "test.event",
        aggregate_type: "test",
      });

      const response = await fetch(
        `http://localhost:${server.getPort()}/metrics`,
      );
      const body = await response.text();

      expect(body).toContain("outboxy_events_published_total");
      expect(body).toContain('event_type="test.event"');
    } finally {
      await server.stop();
    }
  });

  it("should use custom path when provided", async () => {
    const server = createMetricsServer(
      { port, path: "/prometheus" },
      logger as any,
      registry,
    );
    await server.start();

    try {
      // Original /metrics should 404
      const metricsResponse = await fetch(
        `http://localhost:${server.getPort()}/metrics`,
      );
      expect(metricsResponse.status).toBe(404);

      // Custom path should work
      const customResponse = await fetch(
        `http://localhost:${server.getPort()}/prometheus`,
      );
      expect(customResponse.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it("should handle stop() when server not started", async () => {
    const server = createMetricsServer({ port }, logger as any, registry);

    // Should not throw
    await server.stop();
  });
});
