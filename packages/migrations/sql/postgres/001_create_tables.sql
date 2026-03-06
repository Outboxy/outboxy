-- Outboxy Database Schema - Table Definitions
-- PostgreSQL DDL for manual installation
--
-- Usage:
--   psql -d your_database -f 001_create_tables.sql
--   psql -d your_database -f 002_create_indexes.sql
--
-- Or run both:
--   cat sql/postgres/*.sql | psql -d your_database

-- =============================================================================
-- outbox_config: Dynamic configuration storage
-- =============================================================================
CREATE TABLE IF NOT EXISTS "outbox_config" (
    "id" serial PRIMARY KEY NOT NULL,
    "key" varchar(255) NOT NULL,
    "value" jsonb NOT NULL,
    "description" text,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "updated_by" varchar(255),
    CONSTRAINT "outbox_config_key_unique" UNIQUE("key")
);

-- =============================================================================
-- outbox_events: Main transactional outbox table
-- =============================================================================
CREATE TABLE IF NOT EXISTS "outbox_events" (
    -- Primary identifier
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

    -- Event metadata
    "aggregate_type" varchar(255) NOT NULL,
    "aggregate_id" varchar(255) NOT NULL,
    "event_type" varchar(255) NOT NULL,
    "event_version" integer DEFAULT 1 NOT NULL,

    -- Payload
    "payload" jsonb NOT NULL,
    "headers" jsonb DEFAULT '{}'::jsonb,

    -- Destination
    "destination_url" varchar(1000) NOT NULL,
    "destination_type" varchar(50) DEFAULT 'http' NOT NULL,

    -- Idempotency
    "idempotency_key" varchar(255),

    -- Status tracking
    "status" varchar(50) DEFAULT 'pending' NOT NULL,

    -- Retry logic
    "retry_count" integer DEFAULT 0 NOT NULL,
    "max_retries" integer DEFAULT 5 NOT NULL,
    "next_retry_at" timestamp,
    "backoff_multiplier" numeric(3, 2) DEFAULT '2.0',

    -- Error tracking
    "last_error" varchar(1000),
    "error_details" jsonb,

    -- Timestamps
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "processing_started_at" timestamp,
    "processed_at" timestamp,

    -- Metadata (can store tracing info like trace_id, span_id)
    "metadata" jsonb DEFAULT '{}'::jsonb,

    -- Worker identification
    "processed_by_worker" varchar(255),

    -- Soft delete
    "deleted_at" timestamp,

    -- Partition key (generated column for future partitioning)
    "created_date" timestamp GENERATED ALWAYS AS ((created_at::date)) STORED NOT NULL,

    -- Check constraints
    CONSTRAINT "check_status" CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'dlq', 'cancelled')),
    CONSTRAINT "check_retry_count" CHECK (retry_count >= 0),
    CONSTRAINT "check_destination_type" CHECK (destination_type IN ('http', 'kafka', 'sqs', 'rabbitmq', 'pubsub'))
);

