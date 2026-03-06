import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getGlobalRegistry,
  resetGlobalRegistry,
} from "../../src/metrics/registry.js";

describe("metrics registry", () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  afterEach(() => {
    resetGlobalRegistry();
  });

  describe("getGlobalRegistry", () => {
    it("returns a Registry instance", async () => {
      const { Registry } = await import("prom-client");
      const registry = getGlobalRegistry();
      expect(registry).toBeInstanceOf(Registry);
    });

    it("returns the same instance on subsequent calls (singleton)", () => {
      const registry1 = getGlobalRegistry();
      const registry2 = getGlobalRegistry();
      expect(registry1).toBe(registry2);
    });

    it("creates a new registry after reset", () => {
      const registry1 = getGlobalRegistry();
      resetGlobalRegistry();
      const registry2 = getGlobalRegistry();
      expect(registry1).not.toBe(registry2);
    });
  });

  describe("resetGlobalRegistry", () => {
    it("does nothing when registry is null (safe to call multiple times)", () => {
      expect(() => {
        resetGlobalRegistry();
        resetGlobalRegistry();
      }).not.toThrow();
    });

    it("allows metrics to be registered again after reset", async () => {
      const { Counter } = await import("prom-client");

      const registry = getGlobalRegistry();
      new Counter({
        name: "test_reset_counter",
        help: "Test counter for reset",
        registers: [registry],
      });

      resetGlobalRegistry();
      const newRegistry = getGlobalRegistry();

      const metrics = await newRegistry.getMetricsAsJSON();
      const hasTestMetric = metrics.some(
        (m: { name: string }) => m.name === "test_reset_counter",
      );
      expect(hasTestMetric).toBe(false);
    });
  });
});
