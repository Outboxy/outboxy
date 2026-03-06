import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import swaggerPlugin from "../plugins/swagger.plugin.js";

describe("Swagger Plugin", () => {
  describe("when enabled (default)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify({ logger: false });
      await app.register(swaggerPlugin, { enabled: true });
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
    });

    it("serves swagger JSON at /docs/json", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/docs/json",
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty("info");
      expect(body.info.title).toBe("Outboxy API");
    });

    it("serves swagger UI at /docs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/docs",
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("when disabled via options", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify({ logger: false });
      await app.register(swaggerPlugin, { enabled: false });
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
    });

    it("does not register swagger routes when disabled", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/docs",
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
