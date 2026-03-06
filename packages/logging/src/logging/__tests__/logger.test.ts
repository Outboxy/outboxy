import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createLogger,
  createBootstrapLogger,
  createTestLogger,
} from "../logger.js";
import { LogCapture } from "./log-capture.js";

describe("createLogger", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should create a pino logger with expected methods", () => {
    const logger = createLogger({
      service: "test-service",
      level: "info",
    });

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.fatal).toBe("function");
  });

  it("should respect the log level configuration", () => {
    const logger = createLogger({
      service: "test-service",
      level: "error",
    });

    expect(logger.level).toBe("error");
  });

  it("should default to info level when not specified", () => {
    const logger = createLogger({
      service: "test-service",
    });

    expect(logger.level).toBe("info");
  });

  it("should output valid JSON with base fields", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      {
        service: "test-service",
        level: "info",
        version: "1.0.0",
        prettyPrint: false,
      },
      capture.stream,
    );

    logger.info("Test message");

    const log = capture.getLastLog();
    expect(log).toMatchObject({
      level: "info",
      service: "test-service",
      version: "1.0.0",
      msg: "Test message",
    });
    expect(log?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("should use default version from environment when not specified", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      {
        service: "test-service",
        level: "info",
        prettyPrint: false,
      },
      capture.stream,
    );

    logger.info("Test");

    const log = capture.getLastLog();
    expect(log?.version).toBeDefined();
  });

  it("should create logger with pretty print when enabled", () => {
    const logger = createLogger({
      service: "test-service",
      level: "info",
      prettyPrint: true,
    });

    expect(logger.level).toBe("info");
  });

  it("should include child logger context in output", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      { service: "test-service", level: "info", prettyPrint: false },
      capture.stream,
    );

    const childLogger = logger.child({
      eventId: "test-event-123",
      traceId: "trace-456",
    });

    childLogger.info("Child log message");

    const log = capture.getLastLog();
    expect(log).toMatchObject({
      eventId: "test-event-123",
      traceId: "trace-456",
      service: "test-service",
      msg: "Child log message",
    });
  });
});

describe("createBootstrapLogger", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should create a logger with default error level", () => {
    delete process.env.LOG_LEVEL;

    const logger = createBootstrapLogger("test-service");

    expect(logger).toBeDefined();
    expect(logger.level).toBe("error");
  });

  it("should respect LOG_LEVEL environment variable", () => {
    process.env.LOG_LEVEL = "debug";

    const logger = createBootstrapLogger("test-service");

    expect(logger.level).toBe("debug");
  });

  it("should fall back to error level for invalid LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "invalid-level";

    const logger = createBootstrapLogger("test-service");

    expect(logger.level).toBe("error");
  });

  it("should handle case-insensitive LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "DEBUG";

    const logger = createBootstrapLogger("test-service");

    expect(logger.level).toBe("debug");
  });
});

describe("createTestLogger", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should create a silent logger by default", () => {
    delete process.env.TEST_LOG_LEVEL;

    const logger = createTestLogger();

    expect(logger).toBeDefined();
    expect(logger.level).toBe("silent");
  });

  it("should respect TEST_LOG_LEVEL environment variable", () => {
    process.env.TEST_LOG_LEVEL = "debug";

    const logger = createTestLogger();

    expect(logger.level).toBe("debug");
  });
});

describe("child logger context propagation", () => {
  it("should merge contexts in nested child loggers", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      { service: "outboxy-worker", level: "info", prettyPrint: false },
      capture.stream,
    );

    const eventLogger = logger.child({ eventId: "event-123" });
    const publishLogger = eventLogger.child({ publisher: "http" });

    publishLogger.info("Publishing event");

    const log = capture.getLastLog();
    expect(log).toMatchObject({
      service: "outboxy-worker",
      eventId: "event-123",
      publisher: "http",
      msg: "Publishing event",
    });
  });

  it("should preserve parent context when child adds more fields", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      { service: "test", level: "info", prettyPrint: false },
      capture.stream,
    );

    const parentLogger = logger.child({
      traceId: "trace-abc",
      spanId: "span-123",
    });
    const childLogger = parentLogger.child({
      operation: "publish",
    });

    childLogger.info("Operation complete");

    const log = capture.getLastLog();
    expect(log).toMatchObject({
      traceId: "trace-abc",
      spanId: "span-123",
      operation: "publish",
      msg: "Operation complete",
    });
  });
});

describe("log level filtering", () => {
  it("should not output logs below configured level", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      { service: "test", level: "warn", prettyPrint: false },
      capture.stream,
    );

    logger.debug("Debug - should not appear");
    logger.info("Info - should not appear");
    logger.warn("Warn - should appear");
    logger.error("Error - should appear");

    expect(capture.getLogs()).toHaveLength(2);
    expect(capture.getLogs()[0]?.level).toBe("warn");
    expect(capture.getLogs()[1]?.level).toBe("error");
  });

  it("should output all logs when level is trace", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      { service: "test", level: "trace", prettyPrint: false },
      capture.stream,
    );

    logger.trace("Trace message");
    logger.debug("Debug message");
    logger.info("Info message");

    expect(capture.getLogs()).toHaveLength(3);
  });
});

describe("log message formatting", () => {
  it("should include additional properties in log output", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      { service: "test", level: "info", prettyPrint: false },
      capture.stream,
    );

    logger.info({ requestId: "req-123", durationMs: 45 }, "Request completed");

    const log = capture.getLastLog();
    expect(log).toMatchObject({
      requestId: "req-123",
      durationMs: 45,
      msg: "Request completed",
    });
  });

  it("should serialize error objects with err key", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      { service: "test", level: "info", prettyPrint: false },
      capture.stream,
    );

    const error = new Error("Something went wrong");
    logger.error({ err: error }, "Operation failed");

    const log = capture.getLastLog();
    expect(log?.err).toMatchObject({
      type: "Error",
      message: "Something went wrong",
    });
    expect(log?.err?.stack).toBeDefined();
  });

  it("should handle logging without message", () => {
    const capture = new LogCapture();
    const logger = createLogger(
      { service: "test", level: "info", prettyPrint: false },
      capture.stream,
    );

    logger.info({ eventId: "123", status: "processed" });

    const log = capture.getLastLog();
    expect(log).toMatchObject({
      eventId: "123",
      status: "processed",
    });
  });
});
