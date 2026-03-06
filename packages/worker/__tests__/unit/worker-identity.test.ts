import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import { resolveWorkerId } from "../../src/utils/worker-identity.js";

describe("resolveWorkerId", () => {
  const savedHostnameEnv = process.env.HOSTNAME;

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedHostnameEnv === undefined) {
      delete process.env.HOSTNAME;
    } else {
      process.env.HOSTNAME = savedHostnameEnv;
    }
  });

  describe("Priority 1: explicit configWorkerId", () => {
    it("returns the provided configWorkerId with source=env", () => {
      const result = resolveWorkerId("explicit-worker-id");
      expect(result.id).toBe("explicit-worker-id");
      expect(result.source).toBe("env");
    });

    it("uses configWorkerId even when HOSTNAME is set", () => {
      process.env.HOSTNAME = "k8s-pod-abc123-xyz";
      const result = resolveWorkerId("my-custom-worker");
      expect(result.id).toBe("my-custom-worker");
      expect(result.source).toBe("env");
    });
  });

  describe("Priority 2: HOSTNAME env var (K8s pod name)", () => {
    beforeEach(() => {
      delete process.env.HOSTNAME;
    });

    it("uses HOSTNAME when it contains a hyphen", () => {
      process.env.HOSTNAME = "outboxy-worker-abc12-xyz";
      const result = resolveWorkerId(undefined);
      expect(result.id).toBe("outboxy-worker-abc12-xyz");
      expect(result.source).toBe("hostname");
    });

    it("uses os.hostname() fallback when HOSTNAME env var is not set", () => {
      delete process.env.HOSTNAME;
      vi.spyOn(os, "hostname").mockReturnValue("my-host-machine");
      const result = resolveWorkerId(undefined);
      expect(result.id).toBe("my-host-machine");
      expect(result.source).toBe("hostname");
    });
  });

  describe("Priority 3: auto-generated UUID", () => {
    beforeEach(() => {
      delete process.env.HOSTNAME;
    });

    it("generates a UUID-based ID when hostname has no hyphens", () => {
      process.env.HOSTNAME = "mymachine";
      const result = resolveWorkerId(undefined);
      expect(result.id).toMatch(/^worker-[a-f0-9]{8}$/);
      expect(result.source).toBe("uuid");
    });

    it("generates a UUID-based ID when hostname is empty string", () => {
      process.env.HOSTNAME = "";
      vi.spyOn(os, "hostname").mockReturnValue("plainhost");
      const result = resolveWorkerId(undefined);
      expect(result.id).toMatch(/^worker-[a-f0-9]{8}$/);
      expect(result.source).toBe("uuid");
    });

    it("generates unique IDs for each call", () => {
      process.env.HOSTNAME = "nohyphen";
      const result1 = resolveWorkerId(undefined);
      const result2 = resolveWorkerId(undefined);
      expect(result1.id).not.toBe(result2.id);
    });
  });
});
