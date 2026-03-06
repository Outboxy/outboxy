import { describe, it, expect, afterEach, vi } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { Module } from "@nestjs/common";
import { OutboxyModule } from "../src/outboxy.module.js";
import { OUTBOXY_CLIENT, INBOXY_CLIENT } from "../src/constants.js";

// Mock adapter for testing
const mockAdapter = () => async () => [];

// Mock dialect for testing
const mockDialect = {
  name: "postgresql" as const,
  maxParameters: 65535,
  supportsReturning: true,
  placeholder: (index: number) => `$${index}`,
  buildInsert: () => ({ sql: "", params: [] }),
  buildBulkInsert: () => ({ sql: "", params: [] }),
};

// Mock inbox dialect for testing
const mockInboxDialect = {
  name: "postgresql" as const,
  maxParameters: 65535,
  supportsReturning: true,
  placeholder: (index: number) => `$${index}`,
  buildInboxInsert: () => ({ sql: "", params: [] }),
  buildInboxBulkInsert: () => ({ sql: "", params: [] }),
  buildMarkFailed: () => ({ sql: "", params: [] }),
  buildFindByIdempotencyKeys: () => ({ sql: "", params: [] }),
  buildCleanupProcessedEvents: () => ({ sql: "", params: [] }),
};

// Mock the SDK
vi.mock("@outboxy/sdk", () => ({
  OutboxyClient: vi.fn().mockImplementation(function () {
    return {
      publish: vi.fn().mockResolvedValue("mock-id"),
      publishBatch: vi.fn().mockResolvedValue(["mock-id"]),
      transactional: vi.fn().mockImplementation((fn) => fn({})),
      healthCheck: vi.fn().mockResolvedValue(true),
    };
  }),
  InboxyClient: vi.fn().mockImplementation(function () {
    return {
      receive: vi
        .fn()
        .mockResolvedValue({ eventId: "mock-id", status: "processed" }),
      receiveBatch: vi
        .fn()
        .mockResolvedValue([{ eventId: "mock-id", status: "processed" }]),
      markFailed: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe("OutboxyModule", () => {
  describe("forRootAsync", () => {
    let module: TestingModule;

    afterEach(async () => {
      if (module) {
        await module.close();
      }
    });

    it("should create module with useFactory and adapter", async () => {
      module = await Test.createTestingModule({
        imports: [
          OutboxyModule.forRootAsync({
            useFactory: () => ({
              dialect: mockDialect,
              adapter: mockAdapter,
            }),
          }),
        ],
      }).compile();

      expect(module.get(OUTBOXY_CLIENT)).toBeDefined();
    });

    it("should support inject option", async () => {
      const ADAPTER_TOKEN = "ADAPTER_TOKEN";

      @Module({
        providers: [
          {
            provide: ADAPTER_TOKEN,
            useValue: mockAdapter,
          },
        ],
        exports: [ADAPTER_TOKEN],
      })
      class AdapterModule {}

      module = await Test.createTestingModule({
        imports: [
          AdapterModule,
          OutboxyModule.forRootAsync({
            imports: [AdapterModule],
            inject: [ADAPTER_TOKEN],
            useFactory: (...args: unknown[]) => ({
              dialect: mockDialect,
              adapter: args[0] as typeof mockAdapter,
            }),
          }),
        ],
      }).compile();

      expect(module.get(OUTBOXY_CLIENT)).toBeDefined();
    });

    it("should create global module when isGlobal is true", async () => {
      const dynamicModule = OutboxyModule.forRootAsync({
        useFactory: () => ({
          dialect: mockDialect,
          adapter: mockAdapter,
        }),
        isGlobal: true,
      });

      expect(dynamicModule.global).toBe(true);
    });

    it("should not be global by default", async () => {
      const dynamicModule = OutboxyModule.forRootAsync({
        useFactory: () => ({
          dialect: mockDialect,
          adapter: mockAdapter,
        }),
      });

      expect(dynamicModule.global).toBeUndefined();
    });

    it("should provide undefined INBOXY_CLIENT when inbox is not enabled", async () => {
      module = await Test.createTestingModule({
        imports: [
          OutboxyModule.forRootAsync({
            useFactory: () => ({
              dialect: mockDialect,
              adapter: mockAdapter,
            }),
          }),
        ],
      }).compile();

      const inboxClient = module.get(INBOXY_CLIENT);
      expect(inboxClient).toBeUndefined();
    });

    it("should provide InboxyClient when inbox is enabled", async () => {
      module = await Test.createTestingModule({
        imports: [
          OutboxyModule.forRootAsync({
            useFactory: () => ({
              dialect: mockDialect,
              adapter: mockAdapter,
              inbox: { enabled: true, dialect: mockInboxDialect },
            }),
          }),
        ],
      }).compile();

      const inboxClient = module.get(INBOXY_CLIENT);
      expect(inboxClient).toBeDefined();
    });

    it("should export both OUTBOXY_CLIENT and INBOXY_CLIENT", async () => {
      const dynamicModule = OutboxyModule.forRootAsync({
        useFactory: () => ({
          dialect: mockDialect,
          adapter: mockAdapter,
        }),
      });

      expect(dynamicModule.exports).toEqual([OUTBOXY_CLIENT, INBOXY_CLIENT]);
    });
  });
});
