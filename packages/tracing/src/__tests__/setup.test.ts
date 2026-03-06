import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockState = vi.hoisted(() => ({
  sdkStart: vi.fn(),
  sdkShutdown: vi.fn().mockResolvedValue(undefined),
  NodeSDK: vi.fn(),
  OTLPTraceExporter: vi.fn(),
  HttpInstrumentation: vi.fn(),
  UndiciInstrumentation: vi.fn(),
  PgInstrumentation: vi.fn(),
  resourceFromAttributes: vi.fn(),
}));

vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: function MockNodeSDK(config: unknown) {
    mockState.NodeSDK(config);
    return {
      start: mockState.sdkStart,
      shutdown: mockState.sdkShutdown,
    };
  },
}));

vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: function MockExporter(config: unknown) {
    mockState.OTLPTraceExporter(config);
    return { type: "otlp-http", config };
  },
}));

vi.mock("@opentelemetry/instrumentation-http", () => ({
  HttpInstrumentation: function MockHttpInstr() {
    mockState.HttpInstrumentation();
    return { type: "http" };
  },
}));

vi.mock("@opentelemetry/instrumentation-undici", () => ({
  UndiciInstrumentation: function MockUndiciInstr() {
    mockState.UndiciInstrumentation();
    return { type: "undici" };
  },
}));

vi.mock("@opentelemetry/instrumentation-pg", () => ({
  PgInstrumentation: function MockPgInstr() {
    mockState.PgInstrumentation();
    return { type: "pg" };
  },
}));

vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: (attrs: unknown) => {
    mockState.resourceFromAttributes(attrs);
    return { type: "resource", attributes: attrs };
  },
}));

vi.mock("@opentelemetry/semantic-conventions", () => ({
  ATTR_SERVICE_NAME: "service.name",
}));

describe("tracing setup", () => {
  const envKeysToRestore = [
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SERVICE_NAME",
  ] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    savedEnv = Object.fromEntries(
      envKeysToRestore.map((k) => [k, process.env[k]]),
    );
  });

  afterEach(() => {
    for (const key of envKeysToRestore) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("should not initialize SDK when OTEL_EXPORTER_OTLP_ENDPOINT is not set", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    await import("../setup.js");

    expect(mockState.sdkStart).not.toHaveBeenCalled();
    expect(mockState.NodeSDK).not.toHaveBeenCalled();
  });

  it("should initialize SDK when OTEL_EXPORTER_OTLP_ENDPOINT is set", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";

    await import("../setup.js");

    expect(mockState.NodeSDK).toHaveBeenCalled();
    expect(mockState.sdkStart).toHaveBeenCalled();
  });

  it("should configure OTLPTraceExporter with correct endpoint URL", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";

    await import("../setup.js");

    expect(mockState.OTLPTraceExporter).toHaveBeenCalledWith(
      expect.objectContaining({ url: "http://localhost:4318/v1/traces" }),
    );
  });

  it("should use OTEL_SERVICE_NAME env var for service name", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    process.env.OTEL_SERVICE_NAME = "my-custom-service";

    await import("../setup.js");

    expect(mockState.resourceFromAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ "service.name": "my-custom-service" }),
    );
  });

  it("should default service name to 'outboxy' when OTEL_SERVICE_NAME not set", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    delete process.env.OTEL_SERVICE_NAME;

    await import("../setup.js");

    expect(mockState.resourceFromAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ "service.name": "outboxy" }),
    );
  });

  it("should configure NodeSDK with http, undici, and pg instrumentations", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";

    await import("../setup.js");

    const sdkConfig = mockState.NodeSDK.mock.calls[0]![0] as {
      instrumentations: Array<{ type: string }>;
    };
    const instrumentationTypes = sdkConfig.instrumentations.map((i) => i.type);
    expect(instrumentationTypes).toContain("http");
    expect(instrumentationTypes).toContain("undici");
    expect(instrumentationTypes).toContain("pg");
  });

  async function importWithSignalSpy(): Promise<ReturnType<typeof vi.spyOn>> {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    const spy = vi.spyOn(process, "on");
    await import("../setup.js");
    return spy;
  }

  function findSignalHandler(
    spy: ReturnType<typeof vi.spyOn>,
    signal: string,
  ): (() => void) | undefined {
    const call = spy.mock.calls.find((c: unknown[]) => c[0] === signal);
    return call?.[1] as (() => void) | undefined;
  }

  it.each(["SIGTERM", "SIGINT"])(
    "should register %s shutdown handler when endpoint set",
    async (signal) => {
      const spy = await importWithSignalSpy();
      const calls = spy.mock.calls.filter((c: unknown[]) => c[0] === signal);
      expect(calls.length).toBeGreaterThan(0);
    },
  );

  it.each(["SIGTERM", "SIGINT"])(
    "should call sdk.shutdown when %s fires",
    async (signal) => {
      const spy = await importWithSignalSpy();
      const handler = findSignalHandler(spy, signal);
      expect(handler).toBeDefined();

      handler!();

      expect(mockState.sdkShutdown).toHaveBeenCalled();
    },
  );

  it("should swallow sdk.shutdown errors gracefully", async () => {
    mockState.sdkShutdown.mockRejectedValueOnce(new Error("shutdown failed"));

    const spy = await importWithSignalSpy();
    const handler = findSignalHandler(spy, "SIGTERM");

    await expect(
      new Promise<void>((resolve) => {
        handler!();
        setTimeout(resolve, 10);
      }),
    ).resolves.toBeUndefined();
  });
});
