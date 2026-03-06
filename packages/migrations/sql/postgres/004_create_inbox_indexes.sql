-- Outboxy Inbox Pattern - Index Definitions
-- PostgreSQL DDL for inbox_events indexes
--
-- Run after 003_create_inbox_tables.sql

-- =============================================================================
-- inbox_events indexes
-- =============================================================================

-- CRITICAL: Primary dedup index - constant-time idempotency lookup
-- Every receive() call hits this index
CREATE UNIQUE INDEX IF NOT EXISTS "idx_inbox_idempotency"
    ON "inbox_events" USING btree ("idempotency_key");

-- Failed event monitoring: find events that need attention
-- Partial index for efficiency (only indexes failed rows)
CREATE INDEX IF NOT EXISTS "idx_inbox_status"
    ON "inbox_events" USING btree ("status")
    WHERE status = 'failed';

-- Aggregate lookup: query all events for a specific aggregate
-- Consistent with outbox_events index pattern
CREATE INDEX IF NOT EXISTS "idx_inbox_aggregate"
    ON "inbox_events" USING btree ("aggregate_type", "aggregate_id", "received_at" DESC NULLS LAST);

-- Cleanup: efficiently find old processed events for retention cleanup
-- Used by cleanupProcessedEvents() method
CREATE INDEX IF NOT EXISTS "idx_inbox_cleanup"
    ON "inbox_events" USING btree ("processed_at")
    WHERE status = 'processed';

-- Source-based queries (optional, for observability)
CREATE INDEX IF NOT EXISTS "idx_inbox_source"
    ON "inbox_events" USING btree ("source")
    WHERE source IS NOT NULL;
