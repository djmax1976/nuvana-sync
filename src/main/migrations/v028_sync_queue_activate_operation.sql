-- Migration v028: Add ACTIVATE operation to sync_queue
--
-- The ACTIVATE operation is used for direct pack activation calls that
-- bypass the cloud_pack_id requirement by calling the /packs/activate
-- endpoint which can create-and-activate in one call.
--
-- SQLite doesn't support ALTER CONSTRAINT, so we need to recreate the table.

-- Step 1: Create new table with updated constraint
CREATE TABLE sync_queue_new (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'DELETE', 'ACTIVATE')),
  payload TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  synced INTEGER NOT NULL DEFAULT 0,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_sync_error TEXT,
  last_attempt_at TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(store_id)
);

-- Step 2: Copy data from old table to new table
INSERT INTO sync_queue_new
SELECT * FROM sync_queue;

-- Step 3: Drop old table
DROP TABLE sync_queue;

-- Step 4: Rename new table to original name
ALTER TABLE sync_queue_new RENAME TO sync_queue;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_sync_queue_store_synced ON sync_queue(store_id, synced);
CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
