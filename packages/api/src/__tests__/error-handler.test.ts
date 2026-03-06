import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import errorHandlerPlugin from "../plugins/error-handler.plugin.js";
import {
  NotFoundError,
  ConflictError,
  InvalidStateError,
  ValidationError,
} from "../errors.js";
import { ConstraintViolationError } from "@outboxy/db-adapter-core";

describe("Error Handler Plugin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    // Test routes that throw different errors
    app.get("/not-found", async () => {
      throw new NotFoundError("Resource not found");
    });

    app.get("/conflict", async () => {
      throw new ConflictError("Duplicate key");
    });

    app.get("/invalid-state", async () => {
      throw new InvalidStateError("Invalid transition");
    });

    app.get("/validation", async () => {
      throw new ValidationError("Invalid input", { field: "email" });
    });

    app.get("/zod-error", async () => {
      const schema = z.object({ name: z.string() });
      schema.parse({ name: 123 });
    });

    app.get("/pg-unique", async () => {
      throw new ConstraintViolationError(
        "duplicate key unique constraint",
        "events_idempotency_key_unique",
      );
    });

    app.get("/pg-check", async () => {
      throw new ConstraintViolationError(
        "check constraint violation",
        "events_status_check",
      );
    });

    app.get("/internal", async () => {
      throw new Error("Something went wrong");
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("handles NotFoundError with 404", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/not-found",
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe("Not Found");
    expect(body.message).toBe("Resource not found");
    expect(body.requestId).toBeDefined();
  });

  it("handles ConflictError with 409", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/conflict",
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBe("Duplicate key");
  });

  it("handles InvalidStateError with 422", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/invalid-state",
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.statusCode).toBe(422);
    expect(body.error).toBe("Unprocessable Entity");
    expect(body.message).toBe("Invalid transition");
  });

  it("handles ValidationError with 400", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/validation",
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe("Validation Error");
    expect(body.message).toBe("Invalid input");
    expect(body.details).toEqual({ field: "email" });
  });

  it("handles ZodError with 400", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/zod-error",
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe("Validation Error");
    expect(body.message).toBe("Request validation failed");
    expect(body.details).toBeDefined();
  });

  it("handles PostgreSQL unique constraint violation with 409", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/pg-unique",
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.statusCode).toBe(409);
    expect(body.error).toBe("Conflict");
    expect(body.message).toBe("Resource already exists (duplicate key)");
  });

  it("handles PostgreSQL check constraint violation with 400", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/pg-check",
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe("Bad Request");
    expect(body.message).toBe("Invalid data (constraint violation)");
  });

  it("handles unknown errors with 500", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/internal",
    });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe("Internal Server Error");
    expect(body.requestId).toBeDefined();
  });
});
