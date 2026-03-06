import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const testSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  host: z.string().default("0.0.0.0"),
  name: z.string(),
});

describe("loadAndValidateConfig", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // restoreMocks: true requires fresh spy each test
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
  });

  it("should return validated config for valid input", async () => {
    const { loadAndValidateConfig } = await import("../config-loader.js");

    const result = loadAndValidateConfig(
      testSchema,
      { port: "8080", host: "localhost", name: "test-service" },
      { serviceName: "test", exitOnFailure: false },
    );

    expect(result).toEqual({
      port: 8080,
      host: "localhost",
      name: "test-service",
    });
  });

  it("should apply schema defaults for missing optional fields", async () => {
    const { loadAndValidateConfig } = await import("../config-loader.js");

    const result = loadAndValidateConfig(
      testSchema,
      { name: "my-service" },
      { serviceName: "test", exitOnFailure: false },
    );

    expect(result.port).toBe(3000);
    expect(result.host).toBe("0.0.0.0");
    expect(result.name).toBe("my-service");
  });

  it("should coerce string to number for numeric fields", async () => {
    const { loadAndValidateConfig } = await import("../config-loader.js");

    const result = loadAndValidateConfig(
      testSchema,
      { port: "9090", name: "service" },
      { serviceName: "test", exitOnFailure: false },
    );

    expect(result.port).toBe(9090);
    expect(typeof result.port).toBe("number");
  });

  it("should throw ZodError when exitOnFailure is false and validation fails", async () => {
    const { loadAndValidateConfig } = await import("../config-loader.js");

    expect(() =>
      loadAndValidateConfig(
        testSchema,
        { port: "not-a-number", name: "service" },
        { serviceName: "test", exitOnFailure: false },
      ),
    ).toThrow(z.ZodError);
  });

  it("should throw ZodError for missing required field when exitOnFailure is false", async () => {
    const { loadAndValidateConfig } = await import("../config-loader.js");

    expect(() =>
      loadAndValidateConfig(
        testSchema,
        {},
        { serviceName: "test", exitOnFailure: false },
      ),
    ).toThrow(z.ZodError);
  });

  it("should call process.exit(1) when exitOnFailure is true and validation fails", async () => {
    const { loadAndValidateConfig } = await import("../config-loader.js");

    expect(() =>
      loadAndValidateConfig(
        testSchema,
        {},
        { serviceName: "test", exitOnFailure: true },
      ),
    ).toThrow("process.exit called");

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should default exitOnFailure to true", async () => {
    const { loadAndValidateConfig } = await import("../config-loader.js");

    expect(() =>
      loadAndValidateConfig(testSchema, {}, { serviceName: "test" }),
    ).toThrow("process.exit called");

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should re-throw non-ZodError errors", async () => {
    const { loadAndValidateConfig } = await import("../config-loader.js");

    const badSchema = {
      parse: () => {
        throw new TypeError("unexpected error");
      },
    } as unknown as z.ZodSchema;

    expect(() =>
      loadAndValidateConfig(
        badSchema,
        { name: "service" },
        { serviceName: "test", exitOnFailure: false },
      ),
    ).toThrow(TypeError);

    expect(mockExit).not.toHaveBeenCalled();
  });
});
