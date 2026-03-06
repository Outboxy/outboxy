/**
 * @outboxy/server
 *
 * Deployment package for Outboxy API and Worker.
 * Provides CLI entry points and Docker build context.
 *
 * @packageDocumentation
 */

// Re-export factories for programmatic use
export { createDatabaseAdapter } from "./adapter-factory.js";
export {
  createPublisher,
  createPublisherFromEnv,
} from "./publisher-factory.js";
export {
  loadConfig,
  loadApiConfig,
  loadWorkerConfig,
  type ServerConfig,
} from "./config.js";

// Re-export CLI functions
export * from "./cli/index.js";

// Re-export load testing utilities
export {
  runLoadTest,
  calculateMetrics,
  validateThreshold,
  createMockServer,
  reportResult,
  reportProgress,
  createTestResult,
  formatJson,
  formatHuman,
  createMultiWorkerContext,
  startAllWorkers,
  stopAllWorkers,
  getWorkerDistribution,
  formatWorkerDistribution,
} from "./load-testing/index.js";

export type { CreateAdapterOptions } from "./adapter-factory.js";
export type {
  HttpPublisherOptions,
  KafkaPublisherOptions,
  PublisherType,
} from "./publisher-factory.js";
export type {
  LoadTestConfig,
  LoadTestResult,
  PerformanceMetrics,
  ThresholdResult,
  MockServer,
  MockServerConfig,
  TestResult,
  OutputFormat,
  MultiWorkerContext,
} from "./load-testing/index.js";
