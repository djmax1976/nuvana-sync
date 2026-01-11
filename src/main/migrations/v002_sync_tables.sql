-- v002_sync_tables.sql
-- Sync infrastructure tables for cloud synchronization
--
-- Security: DB-006 - All tables include store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity

-- ============================================================================
-- Sync Queue
-- ============================================================================

-- Queue for pending cloud uploads
-- Records are added when data changes locally and removed after successful sync
-- DB-006: Scoped by store_id
CREATE TABLE sync_queue (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE')),
  payload TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  synced INTEGER NOT NULL DEFAULT 0 CHECK(synced IN (0, 1)),
  sync_attempts INTEGER NOT NULL DEFAULT 0 CHECK(sync_attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_sync_error TEXT,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

-- Index for fetching unsynced records efficiently
-- Ordered by priority (desc) and created_at (asc) for FIFO with priority
CREATE INDEX idx_sync_queue_unsynced ON sync_queue(synced, priority DESC, created_at ASC);

-- Index for entity lookup (deduplication)
CREATE INDEX idx_sync_queue_entity ON sync_queue(entity_type, entity_id, synced);

-- Index for failed record retry logic
CREATE INDEX idx_sync_queue_retry ON sync_queue(synced, sync_attempts, last_attempt_at);

-- ============================================================================
-- Sync Log
-- ============================================================================

-- Historical log of sync operations
-- Used for debugging and monitoring sync health
-- DB-006: Scoped by store_id
CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('PUSH', 'PULL')),
  records_sent INTEGER NOT NULL DEFAULT 0 CHECK(records_sent >= 0),
  records_succeeded INTEGER NOT NULL DEFAULT 0 CHECK(records_succeeded >= 0),
  records_failed INTEGER NOT NULL DEFAULT 0 CHECK(records_failed >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  error_details TEXT
);

-- Index for recent sync history
CREATE INDEX idx_sync_log_store_time ON sync_log(store_id, started_at DESC);

-- Index for sync type filtering
CREATE INDEX idx_sync_log_type ON sync_log(store_id, sync_type, started_at DESC);

-- ============================================================================
-- Processed Files
-- ============================================================================

-- Track processed NAXML files for deduplication
-- Prevents re-processing of already-imported files
-- Security: CDP-001 - Uses SHA-256 hash for file integrity
-- DB-006: Scoped by store_id
CREATE TABLE processed_files (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK(file_size >= 0),
  document_type TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  record_count INTEGER NOT NULL DEFAULT 0 CHECK(record_count >= 0),
  status TEXT NOT NULL DEFAULT 'SUCCESS' CHECK(status IN ('SUCCESS', 'FAILED', 'PARTIAL')),
  error_message TEXT,
  processing_duration_ms INTEGER,
  -- Unique constraint: one hash per store prevents duplicate processing
  UNIQUE(store_id, file_hash)
);

-- Index for hash lookup (deduplication check)
CREATE INDEX idx_processed_files_hash ON processed_files(file_hash);

-- Index for file history by date
CREATE INDEX idx_processed_files_date ON processed_files(store_id, processed_at DESC);

-- Index for document type filtering
CREATE INDEX idx_processed_files_type ON processed_files(store_id, document_type, processed_at DESC);

-- Index for failed file retry
CREATE INDEX idx_processed_files_status ON processed_files(store_id, status);

-- ============================================================================
-- Sync Timestamps
-- ============================================================================

-- Track last sync timestamps for each entity type
-- Used for incremental bi-directional sync
-- DB-006: Scoped by store_id
CREATE TABLE sync_timestamps (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  last_push_at TEXT,
  last_pull_at TEXT,
  last_push_id TEXT,
  last_pull_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one record per store per entity type
  UNIQUE(store_id, entity_type)
);

-- Index for entity type lookup
CREATE INDEX idx_sync_timestamps_entity ON sync_timestamps(entity_type);

-- ============================================================================
-- Sync Conflicts
-- ============================================================================

-- Track sync conflicts for manual resolution
-- Occurs when same record modified both locally and on cloud
-- DB-006: Scoped by store_id
CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_data TEXT NOT NULL,
  remote_data TEXT NOT NULL,
  local_modified_at TEXT NOT NULL,
  remote_modified_at TEXT NOT NULL,
  resolution TEXT CHECK(resolution IN ('LOCAL_WINS', 'REMOTE_WINS', 'MERGED', 'PENDING')),
  resolved_at TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for pending conflicts
CREATE INDEX idx_sync_conflicts_pending ON sync_conflicts(store_id, resolution);

-- Index for entity lookup
CREATE INDEX idx_sync_conflicts_entity ON sync_conflicts(entity_type, entity_id);

-- ============================================================================
-- API Rate Limiting
-- ============================================================================

-- Track API call counts for rate limiting compliance
-- Prevents exceeding cloud API rate limits
CREATE TABLE api_rate_limits (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  window_start TEXT NOT NULL,
  window_size_seconds INTEGER NOT NULL DEFAULT 60,
  call_count INTEGER NOT NULL DEFAULT 0 CHECK(call_count >= 0),
  max_calls INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one record per endpoint per time window
  UNIQUE(endpoint, window_start)
);

-- Index for rate limit lookup
CREATE INDEX idx_api_rate_limits_endpoint ON api_rate_limits(endpoint, window_start DESC);

-- Cleanup old rate limit records (keep last 24 hours)
-- This should be run periodically by the application
