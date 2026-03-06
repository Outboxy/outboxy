-- Outboxy Database Schema - Index Definitions
-- MySQL DDL for manual installation
--
-- Run after 001_create_tables.sql
--
-- Note: MySQL does not support partial indexes like PostgreSQL.
-- Performance may differ from PostgreSQL implementation.

-- =============================================================================
-- outbox_events indexes
-- =============================================================================

-- Critical for worker polling query
-- Note: No partial index - includes all rows unlike PostgreSQL version
CREATE INDEX `idx_outbox_status_retry`
    ON `outbox_events` (`status`, `next_retry_at`);

-- Track events currently being processed
CREATE INDEX `idx_outbox_processing`
    ON `outbox_events` (`status`, `processing_started_at`);

-- Query events by aggregate (e.g., all events for Order-123)
CREATE INDEX `idx_outbox_aggregate`
    ON `outbox_events` (`aggregate_type`, `aggregate_id`, `created_at` DESC);

-- General time-based queries
CREATE INDEX `idx_outbox_created_at`
    ON `outbox_events` (`created_at` DESC);

-- Idempotency constraint
--
-- IMPORTANT: MySQL requires a full unique index - cannot be partial like PostgreSQL.
--
-- Behavioral differences from PostgreSQL:
-- - PostgreSQL: Partial index only applies to non-succeeded events, allowing key reuse after success
-- - MySQL: Global unique index means keys CANNOT be reused, even after the original event succeeds
--
-- Implications:
-- 1. Attempting to publish with the same idempotency key will fail if any previous event
--    (including succeeded events) used that key
-- 2. Configure `cleanupStaleIdempotencyKeys` to free keys by setting them to NULL after
--    a retention period
-- 3. Use idempotency key patterns that include timestamps or UUIDs for MySQL deployments
--
-- Example MySQL-compatible key pattern: `order-created-{orderId}-{timestamp}`
CREATE UNIQUE INDEX `idx_outbox_idempotency`
    ON `outbox_events` (`idempotency_key`);

-- Partition key index (for future table partitioning)
CREATE INDEX `idx_outbox_partition`
    ON `outbox_events` (`created_date`, `status`);

-- Worker identification index
CREATE INDEX `idx_outbox_worker`
    ON `outbox_events` (`processed_by_worker`);
