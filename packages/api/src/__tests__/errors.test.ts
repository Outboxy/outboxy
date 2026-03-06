import { describe, it, expect } from "vitest";
import {
  NotFoundError,
  ConflictError,
  InvalidStateError,
  ValidationError,
} from "../errors.js";

describe("API Error Classes", () => {
  describe("NotFoundError", () => {
    it("has correct name and status code", () => {
      const error = new NotFoundError("Resource not found");

      expect(error.name).toBe("NotFoundError");
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe("Resource not found");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("ConflictError", () => {
    it("has correct name and status code", () => {
      const error = new ConflictError("Duplicate key");

      expect(error.name).toBe("ConflictError");
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe("Duplicate key");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("InvalidStateError", () => {
    it("has correct name and status code", () => {
      const error = new InvalidStateError("Invalid transition");

      expect(error.name).toBe("InvalidStateError");
      expect(error.statusCode).toBe(422);
      expect(error.message).toBe("Invalid transition");
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("ValidationError", () => {
    it("has correct name and status code", () => {
      const error = new ValidationError("Invalid input");

      expect(error.name).toBe("ValidationError");
      expect(error.statusCode).toBe(400);
      expect(error.message).toBe("Invalid input");
      expect(error).toBeInstanceOf(Error);
    });

    it("stores validation details", () => {
      const details = { field: "email", reason: "invalid format" };
      const error = new ValidationError("Validation failed", details);

      expect(error.details).toEqual(details);
    });

    it("defaults to empty details", () => {
      const error = new ValidationError("Validation failed");

      expect(error.details).toEqual({});
    });
  });
});
