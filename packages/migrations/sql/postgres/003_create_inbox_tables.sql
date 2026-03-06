-- Outboxy Inbox Pattern - Table Definitions
-- PostgreSQL DDL for inbox_events table
--
-- Usage:
--   psql -d your_database -f 003_create_inbox_tables.sql
--   psql -d your_database -f 004_create_inbox_indexes.sql
--
-- Or run with previous migrations:
--   cat sql/postgres/*.sql | psql -d your_database

-- =============================================================================
-- inbox_events: Transactional inbox for idempotent event consumption
-- =============================================================================
-- Purpose: Provide idempotent processing via deduplication of received events by tracking
-- which events have already been handled via idempotency keys.
--
-- Unlike outbox_events, inbox_events has no worker - the consumer's
-- transaction is the integration layer. Insert happens atomically with
-- business logic in the same transaction.
CREATE TABLE IF NOT EXISTS "inbox_events" (
    -- Primary identifier
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Idempotency key (REQUIRED - this is the whole point of inbox)
    -- Consumer chooses what constitutes uniqueness:
    -- - Transport-level: kafka:orders:0:12345 (partition + offset)
    -- - Business-level: order-abc123-created
    -- - Hybrid: payment-svc:charge-xyz789
    "idempotency_key" varchar(255) NOT NULL,

    -- Source (optional, for observability)
    -- Tracks where the event came from (e.g., "webhook", "kafka:orders", "stripe")
    "source" varchar(255),

    -- Event metadata (consistent with outbox_events)
    "aggregate_type" varchar(255) NOT NULL,
    "aggregate_id" varchar(255) NOT NULL,
    "event_type" varchar(255) NOT NULL,
    "event_version" integer DEFAULT 1 NOT NULL,

    -- Payload
    "payload" jsonb NOT NULL,
    "headers" jsonb DEFAULT '{}'::jsonb,
    "metadata" jsonb DEFAULT '{}'::jsonb,

    -- Status (simpler than outbox - only 2 states)
    -- 'processed' = event was handled successfully
    -- 'failed' = business logic failed, needs attention (but NOT retried automatically)
    "status" varchar(20) DEFAULT 'processed' NOT NULL,
    "error" text,

    -- Timestamps
    "received_at" timestamp DEFAULT now() NOT NULL,
    "processed_at" timestamp DEFAULT now(),

    -- Check constraints
    CONSTRAINT "check_inbox_status" CHECK (status IN ('processed', 'failed'))
);

-- Comment for documentation
COMMENT ON TABLE "inbox_events" IS 'Transactional inbox for idempotent event consumption. Provides idempotent processing via deduplication.';
COMMENT ON COLUMN "inbox_events"."idempotency_key" IS 'Unique key for deduplication. Required. Consumer chooses the key strategy.';
COMMENT ON COLUMN "inbox_events"."source" IS 'Optional source identifier for observability (e.g., webhook, kafka:topic, stripe)';
COMMENT ON COLUMN "inbox_events"."status" IS 'processed = successfully handled, failed = business error (requires attention)';
