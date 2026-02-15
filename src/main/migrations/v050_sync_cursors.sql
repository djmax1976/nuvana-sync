-- v050_sync_cursors.sql
-- Phase 5 (D5.1): Pull Consistency, Cursor Safety, and Idempotent Apply
--
-- Adds durable cursor/token storage for server-side pagination.
-- Enables resumable pulls after network failures or app restarts.
--
-- Security: DB-006 - All tables include store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints for data integrity
-- Compliance: MQ-001 - Idempotent message consumption via cursor tracking

-- ============================================================================
-- Sync Cursors Table
-- ============================================================================

-- Dedicated table for storing pagination cursors from cloud APIs
-- Separate from sync_timestamps to maintain clean separation of concerns:
-- - sync_timestamps: tracks WHEN we last synced (ISO timestamps)
-- - sync_cursors: tracks WHERE we left off (server-provided cursors/sequences)
--
-- DB-006: Scoped by store_id for tenant isolation
CREATE TABLE IF NOT EXISTS sync_cursors (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  -- Entity type/action being synced (e.g., 'bins', 'packs_received', 'users')
  entity_type TEXT NOT NULL,
  -- Server-provided opaque cursor token for resumable pagination
  cursor_value TEXT,
  -- Server-provided sequence number for ordering
  sequence_number INTEGER,
  -- Server timestamp from last successful response
  server_time TEXT,
  -- Tracks if there are more pages to fetch (from hasMore response)
  has_more INTEGER NOT NULL DEFAULT 0 CHECK(has_more IN (0, 1)),
  -- Tracks if cursor was completed (all pages fetched)
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
  -- Number of pages fetched in current batch
  pages_fetched INTEGER NOT NULL DEFAULT 0 CHECK(pages_fetched >= 0),
  -- Total records pulled in current batch
  records_pulled INTEGER NOT NULL DEFAULT 0 CHECK(records_pulled >= 0),
  -- When this cursor was created (start of pull operation)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- When cursor was last updated
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one active cursor per store per entity type
  UNIQUE(store_id, entity_type)
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Index for efficient cursor lookup by entity type
CREATE INDEX IF NOT EXISTS idx_sync_cursors_entity
  ON sync_cursors(store_id, entity_type);

-- Index for finding incomplete cursors (for resumable sync)
CREATE INDEX IF NOT EXISTS idx_sync_cursors_incomplete
  ON sync_cursors(store_id, completed)
  WHERE completed = 0 AND has_more = 1;

-- ============================================================================
-- Extend Sync Timestamps with Applied Sequence Tracking
-- ============================================================================

-- Add column to track the highest applied sequence number for idempotent apply
-- This prevents re-applying already-processed records during overlapping pulls
ALTER TABLE sync_timestamps ADD COLUMN last_applied_sequence INTEGER;

-- Add column to track the highest cloud sequence seen for convergence
ALTER TABLE sync_timestamps ADD COLUMN last_seen_sequence INTEGER;

-- ============================================================================
-- Sync Applied Records Table (for exactly-once apply tracking)
-- ============================================================================

-- Tracks which cloud records have been applied locally
-- Used for D5.2/D5.4: Idempotent apply across repeated/overlapping pulls
-- Records are deduplicated by their cloud record hash
--
-- DESIGN: Rolling window with TTL - old records are pruned after 24h
-- This prevents unbounded growth while maintaining idempotency for recent operations
--
-- DB-006: Scoped by store_id for tenant isolation
-- MQ-001: Enables exactly-once apply semantics
CREATE TABLE IF NOT EXISTS sync_applied_records (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  -- Entity type for the record (e.g., 'pack', 'bin', 'user')
  entity_type TEXT NOT NULL,
  -- Cloud record identifier (pack_id, bin_id, etc.)
  cloud_record_id TEXT NOT NULL,
  -- Hash of the record payload for detecting duplicate apply attempts
  payload_hash TEXT NOT NULL,
  -- Cloud sequence number when this record was received
  cloud_sequence INTEGER,
  -- When the record was applied locally
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one application record per store + entity + cloud_record_id
  UNIQUE(store_id, entity_type, cloud_record_id)
);

-- Index for efficient lookup during apply
CREATE INDEX IF NOT EXISTS idx_sync_applied_records_lookup
  ON sync_applied_records(store_id, entity_type, cloud_record_id);

-- Index for TTL cleanup (records older than 24 hours can be pruned)
CREATE INDEX IF NOT EXISTS idx_sync_applied_records_ttl
  ON sync_applied_records(applied_at);

-- Index for sequence-based queries
CREATE INDEX IF NOT EXISTS idx_sync_applied_records_sequence
  ON sync_applied_records(store_id, entity_type, cloud_sequence);
