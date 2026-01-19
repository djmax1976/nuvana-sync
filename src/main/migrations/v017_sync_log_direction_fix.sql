-- v017_sync_log_direction_fix.sql
-- Fix sync_log table to rename 'direction' to 'sync_type' for DAL compatibility
-- The v016 migration added status column but didn't fix the direction/sync_type mismatch

-- SQLite approach: Create new table, copy data, drop old, rename new

-- Create new table with correct schema (sync_type instead of direction)
CREATE TABLE IF NOT EXISTS sync_log_new (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL CHECK(sync_type IN ('PUSH', 'PULL')),
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  records_sent INTEGER NOT NULL DEFAULT 0 CHECK(records_sent >= 0),
  records_succeeded INTEGER NOT NULL DEFAULT 0 CHECK(records_succeeded >= 0),
  records_failed INTEGER NOT NULL DEFAULT 0 CHECK(records_failed >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER,
  error_message TEXT,
  error_details TEXT,
  created_at TEXT,
  details TEXT
);

-- Copy data from old table
-- Check if 'direction' column exists (old schema) or 'sync_type' exists (if already migrated)
INSERT OR IGNORE INTO sync_log_new (
  id, store_id, sync_type, status, records_sent, records_succeeded, records_failed,
  started_at, completed_at, duration_ms, error_message, error_details, created_at, details
)
SELECT
  id,
  store_id,
  COALESCE(sync_type, direction, 'PUSH') as sync_type,
  COALESCE(status, 'COMPLETED') as status,
  records_sent,
  records_succeeded,
  records_failed,
  started_at,
  completed_at,
  duration_ms,
  error_message,
  error_details,
  COALESCE(created_at, started_at) as created_at,
  details
FROM sync_log;

-- Drop old table and rename new one
DROP TABLE IF EXISTS sync_log;
ALTER TABLE sync_log_new RENAME TO sync_log;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_sync_log_store_time ON sync_log(store_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_type ON sync_log(store_id, sync_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(store_id, status, started_at DESC);
