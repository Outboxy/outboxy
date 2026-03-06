-- Outboxy Database Schema - Index Definitions
-- PostgreSQL DDL for manual installation
--
-- Run after 001_create_tables.sql

-- =============================================================================
-- outbox_events indexes
-- =============================================================================

-- Critical for worker polling query (WHERE status IN ('pending', 'failed'))
CREATE INDEX IF NOT EXISTS "idx_outbox_status_retry"
    ON "outbox_events" USING btree ("created_at", "next_retry_at")
    WHERE status IN ('pending', 'failed') AND deleted_at IS NULL;

-- Track events currently being processed
CREATE INDEX IF NOT EXISTS "idx_outbox_processing"
    ON "outbox_events" USING btree ("status", "processing_started_at")
    WHERE status = 'processing' AND deleted_at IS NULL;

-- Query events by aggregate (e.g., all events for Order-123)
CREATE INDEX IF NOT EXISTS "idx_outbox_aggregate"
    ON "outbox_events" USING btree ("aggregate_type", "aggregate_id", "created_at" DESC NULLS LAST);

-- General time-based queries
CREATE INDEX IF NOT EXISTS "idx_outbox_created_at"
    ON "outbox_events" USING btree ("created_at" DESC NULLS LAST);

-- Unique idempotency constraint (partial - only for non-succeeded events)
-- Allows duplicate idempotency_key values for succeeded events (replay support)
CREATE UNIQUE INDEX IF NOT EXISTS "idx_outbox_idempotency"
    ON "outbox_events" USING btree ("idempotency_key")
    WHERE idempotency_key IS NOT NULL AND status != 'succeeded';

-- Partition key index (for future table partitioning)
CREATE INDEX IF NOT EXISTS "idx_outbox_partition"
    ON "outbox_events" USING btree ("created_date", "status");

-- Worker identification index
CREATE INDEX IF NOT EXISTS "idx_outbox_worker"
    ON "outbox_events" USING btree ("processed_by_worker")
    WHERE processed_by_worker IS NOT NULL;

