/**
 * Load testing module
 *
 * Standalone load testing for Outboxy worker performance.
 */

export {
  runLoadTest,
  type LoadTestConfig,
  type LoadTestResult,
} from "./runner.js";
export {
  calculateMetrics,
  queryLatenciesFromDb,
  queryTestTimeWindow,
  validateThreshold,
  type LatencyData,
  type PerformanceMetrics,
  type TestTimeWindow,
  type ThresholdResult,
} from "./metrics.js";
export {
  createMockServer,
  type MockServer,
  type MockServerConfig,
} from "./mock-server.js";
export {
  reportResult,
  reportProgress,
  updateConcurrentProgress,
  finishProgressBar,
  createTestResult,
  formatJson,
  formatHuman,
  type OutputFormat,
  type TestResult,
} from "./reporter.js";
export {
  createMultiWorkerContext,
  startAllWorkers,
  stopAllWorkers,
  getWorkerDistribution,
  formatWorkerDistribution,
  type MultiWorkerContext,
} from "./multi-worker-runner.js";
