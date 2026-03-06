import type { FastifyPluginAsync, FastifyError } from "fastify";
import { ZodError } from "zod";
import fp from "fastify-plugin";
import { ConstraintViolationError } from "@outboxy/db-adapter-core";
import {
  NotFoundError,
  ConflictError,
  InvalidStateError,
  ValidationError,
} from "../errors.js";

/**
 * Centralized error handling plugin
 *
 * Converts errors to appropriate HTTP responses with consistent format.
 */
const errorHandlerPlugin: FastifyPluginAsync = async (fastify) => {
  const isProduction = process.env.NODE_ENV === "production";

  fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const requestId = request.id;

    // Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Validation Error",
        message: "Request validation failed",
        details: error.flatten(),
        requestId,
      });
    }

    // Custom application errors
    if (error instanceof NotFoundError) {
      return reply.status(404).send({
        statusCode: 404,
        error: "Not Found",
        message: error.message,
        requestId,
      });
    }

    if (error instanceof ConflictError) {
      return reply.status(409).send({
        statusCode: 409,
        error: "Conflict",
        message: error.message,
        requestId,
      });
    }

    if (error instanceof InvalidStateError) {
      return reply.status(422).send({
        statusCode: 422,
        error: "Unprocessable Entity",
        message: error.message,
        requestId,
      });
    }

    if (error instanceof ValidationError) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Validation Error",
        message: error.message,
        details: error.details,
        requestId,
      });
    }

    // Fastify schema validation errors
    if ("validation" in error && error.validation) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Validation Error",
        message: error.message,
        details: error.validation,
        requestId,
      });
    }

    // Database constraint violations (normalized from all DB adapters)
    if (error instanceof ConstraintViolationError) {
      const isUniqueViolation = error.message.toLowerCase().includes("unique");
      return reply.status(isUniqueViolation ? 409 : 400).send({
        statusCode: isUniqueViolation ? 409 : 400,
        error: isUniqueViolation ? "Conflict" : "Bad Request",
        message: isUniqueViolation
          ? "Resource already exists (duplicate key)"
          : "Invalid data (constraint violation)",
        requestId,
      });
    }

    // Log unexpected errors
    fastify.log.error({ err: error, requestId }, "Unhandled error");

    return reply.status(500).send({
      statusCode: 500,
      error: "Internal Server Error",
      message: isProduction ? "An unexpected error occurred" : error.message,
      requestId,
    });
  });
};

export default fp(errorHandlerPlugin, {
  name: "error-handler",
  fastify: "5.x",
});
