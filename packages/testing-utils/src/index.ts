export type { TestContainerConfig } from "./globalSetup.js";

export {
  getTestContainerConfig,
  getTestPgConnectionString,
  getTestPgConnectionStringWithSchema,
  getTestMySqlConnectionString,
  getTestMySqlConfig,
  getTestKafkaBroker,
} from "./setupTests.js";

export {
  createIsolatedTestPool,
  truncateAllTables,
  cleanupAllTestPools,
  type TestPoolConfig,
  type IsolatedTestPool,
} from "./test-pool-manager.js";

export {
  createIsolatedTestMySqlPool,
  truncateAllTablesMySql,
  cleanupAllTestMySqlPools,
  type TestMySqlPoolConfig,
  type IsolatedTestMySqlPool,
} from "./test-mysql-pool-manager.js";

// Re-exported so test files can annotate pool variables without depending on pg directly
export type { Pool, PoolClient } from "pg";

export {
  waitFor,
  waitForCondition,
  waitForStatus,
  waitForCount,
  waitForMinCount,
  waitForEventsProcessed,
  waitForProcessingStarted,
  waitForOutboxEventStatus,
  type WaitForOptions,
  type WaitForEventsOptions,
  type OutboxEventRow,
} from "./wait-helpers.js";

export {
  retryWithBackoff,
  waitForServiceReady,
  isConnectionError,
  type RetryOptions,
} from "./retry-helpers.js";

export {
  getTestKafka,
  createTestConsumer,
  createTestProducer,
  cleanupTestConsumer,
  cleanupTestProducer,
  cleanupAllKafkaResources,
  waitForKafkaMessages,
} from "./test-kafka-manager.js";

export {
  createMockWebhookServer,
  type MockWebhookServer,
  type MockWebhookRequest,
  type CreateMockWebhookServerOptions,
} from "./mock-webhook-server.js";

export {
  insertTestEvents,
  type InsertTestEventsOptions,
} from "./event-helpers.js";

export { withEnv, withoutEnv } from "./env-helpers.js";
