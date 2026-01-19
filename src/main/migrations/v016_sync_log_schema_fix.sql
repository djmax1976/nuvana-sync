-- v016_sync_log_schema_fix.sql
-- Fix sync_log table schema to match DAL expectations
-- The original v002 schema has 'direction' but DAL uses 'sync_type'
-- Also adds missing columns: status, created_at, details

-- SQLite doesn't support RENAME COLUMN in older versions, so we need to:
-- 1. Create new table with correct schema
-- 2. Copy data from old table
-- 3. Drop old table
-- 4. Rename new table

-- Create new table with correct schema
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

-- Copy data from old table (direction -> sync_type)
INSERT OR IGNORE INTO sync_log_new (
  id, store_id, sync_type, status, records_sent, records_succeeded, records_failed,
  started_at, completed_at, duration_ms, error_message, error_details, created_at
)
SELECT
  id, store_id, direction, 'COMPLETED', records_sent, records_succeeded, records_failed,
  started_at, completed_at, duration_ms, error_message, error_details, started_at
FROM sync_log;

-- Drop old table and rename new one
DROP TABLE IF EXISTS sync_log;
ALTER TABLE sync_log_new RENAME TO sync_log;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_sync_log_store_time ON sync_log(store_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_type ON sync_log(store_id, sync_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_log_status ON sync_log(store_id, status, started_at DESC);
