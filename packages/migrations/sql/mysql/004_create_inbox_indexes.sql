-- Outboxy Inbox Pattern - Index Definitions
-- MySQL DDL for inbox_events indexes
--
-- Run after 003_create_inbox_tables.sql
--
-- Note: MySQL does not support partial indexes like PostgreSQL.
-- Performance may differ from PostgreSQL implementation.

-- =============================================================================
-- inbox_events indexes
-- =============================================================================

-- CRITICAL: Primary dedup index - constant-time idempotency lookup
-- Every receive() call hits this index
-- (Already created as UNIQUE KEY in table definition, but creating here for idempotency)
-- CREATE UNIQUE INDEX `idx_inbox_idempotency` ON `inbox_events` (`idempotency_key`);

-- Failed event monitoring: find events that need attention
-- Note: No partial index - includes all rows unlike PostgreSQL version
CREATE INDEX `idx_inbox_status`
    ON `inbox_events` (`status`);

-- Aggregate lookup: query all events for a specific aggregate
-- Consistent with outbox_events index pattern
CREATE INDEX `idx_inbox_aggregate`
    ON `inbox_events` (`aggregate_type`, `aggregate_id`, `received_at` DESC);

-- Cleanup: efficiently find old processed events for retention cleanup
-- Used by cleanupProcessedEvents() method
-- Note: No partial index - includes all processed_at values
CREATE INDEX `idx_inbox_cleanup`
    ON `inbox_events` (`processed_at`);

-- Source-based queries (optional, for observability)
CREATE INDEX `idx_inbox_source`
    ON `inbox_events` (`source`);
