import { describe, it, expect } from "vitest";
import { withEnv, withoutEnv } from "@outboxy/testing-utils";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("loads defaults when no environment variables are set", () => {
    withoutEnv(
      [
        "PORT",
        "HOST",
        "LOG_LEVEL",
        "REQUEST_TIMEOUT_MS",
        "BODY_LIMIT",
        "SWAGGER_ENABLED",
        "NODE_ENV",
      ],
      () => {
        const config = loadConfig();

        expect(config.port).toBe(3000);
        expect(config.host).toBe("0.0.0.0");
        expect(config.logLevel).toBe("info");
        expect(config.requestTimeoutMs).toBe(30000);
        expect(config.bodyLimit).toBe(1048576);
        expect(config.swaggerEnabled).toBe(true);
        expect(config.nodeEnv).toBe("development");
      },
    );
  });

  it("reads PORT from environment", () => {
    withEnv({ PORT: "8080" }, () => {
      const config = loadConfig();
      expect(config.port).toBe(8080);
    });
  });

  it("reads HOST from environment", () => {
    withEnv({ HOST: "127.0.0.1" }, () => {
      const config = loadConfig();
      expect(config.host).toBe("127.0.0.1");
    });
  });

  it("reads LOG_LEVEL from environment", () => {
    withEnv({ LOG_LEVEL: "debug" }, () => {
      const config = loadConfig();
      expect(config.logLevel).toBe("debug");
    });
  });

  it("reads NODE_ENV from environment", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      const config = loadConfig();
      expect(config.nodeEnv).toBe("production");
    });
  });

  it("coerces SWAGGER_ENABLED truthy string to boolean true", () => {
    withEnv({ SWAGGER_ENABLED: "true" }, () => {
      const config = loadConfig();
      expect(config.swaggerEnabled).toBe(true);
    });
  });

  it("coerces numeric environment variables from strings", () => {
    withEnv(
      { PORT: "4000", REQUEST_TIMEOUT_MS: "60000", BODY_LIMIT: "2097152" },
      () => {
        const config = loadConfig();

        expect(config.port).toBe(4000);
        expect(config.requestTimeoutMs).toBe(60000);
        expect(config.bodyLimit).toBe(2097152);
      },
    );
  });
});
