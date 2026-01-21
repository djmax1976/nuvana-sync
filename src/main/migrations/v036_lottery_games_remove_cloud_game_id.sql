-- ============================================================================
-- Migration v036: Remove cloud_game_id from lottery_games
-- ============================================================================
--
-- Purpose: Align local lottery_games schema with cloud schema by removing the
-- redundant cloud_game_id column and using the cloud's game_id directly as
-- the primary key.
--
-- Background:
-- The local implementation was generating new UUIDs for game_id and storing
-- the cloud's ID separately in cloud_game_id. This caused JOIN failures with
-- lottery_packs which reference the cloud's game_id.
--
-- Changes:
-- 1. Create new table with cloud_game_id removed
-- 2. Copy data, using cloud_game_id as the new game_id
-- 3. Drop old table and rename new table
-- 4. Recreate indexes
--
-- Security Compliance:
-- - SEC-006: No user input; migration uses literal SQL only
-- - DB-006: Tenant isolation maintained via store_id column
--
-- Performance:
-- - Recreates indexes for optimal query performance
-- - Uses indexed columns in all operations
--
-- Rollback:
-- - Not recommended; would require re-sync from cloud
-- - Backup database before running migration
--
-- ============================================================================

-- Step 1: Create new table without cloud_game_id column
-- Schema matches cloud LotteryGame model from schema.prisma
CREATE TABLE lottery_games_new (
  game_id TEXT PRIMARY KEY,
  store_id TEXT,
  game_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  pack_value REAL NOT NULL DEFAULT 300,
  tickets_per_pack INTEGER,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK(status IN ('ACTIVE', 'INACTIVE', 'DISCONTINUED')),
  state_id TEXT,
  created_by_user_id TEXT,
  deleted_at TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy data from old table
-- Use cloud_game_id as the new game_id (this is the fix)
-- For any rows without cloud_game_id, keep existing game_id (edge case)
INSERT INTO lottery_games_new (
  game_id,
  store_id,
  game_code,
  name,
  description,
  price,
  pack_value,
  tickets_per_pack,
  status,
  state_id,
  created_by_user_id,
  deleted_at,
  synced_at,
  created_at,
  updated_at
)
SELECT
  COALESCE(cloud_game_id, game_id),  -- Use cloud_game_id as game_id
  store_id,
  game_code,
  name,
  description,
  price,
  pack_value,
  tickets_per_pack,
  status,
  state_id,
  created_by_user_id,
  deleted_at,
  synced_at,
  created_at,
  updated_at
FROM lottery_games;

-- Step 3: Drop old table
DROP TABLE lottery_games;

-- Step 4: Rename new table
ALTER TABLE lottery_games_new RENAME TO lottery_games;

-- Step 5: Recreate indexes for query performance
-- Index on store_id for tenant isolation queries (DB-006)
CREATE INDEX idx_lottery_games_store_id ON lottery_games(store_id);

-- Index on state_id for state-scoped game queries
CREATE INDEX idx_lottery_games_state_id ON lottery_games(state_id);

-- Index on game_code for lookups
CREATE INDEX idx_lottery_games_game_code ON lottery_games(game_code);

-- Index on status for filtering
CREATE INDEX idx_lottery_games_status ON lottery_games(status);

-- Index on name for search
CREATE INDEX idx_lottery_games_name ON lottery_games(name);

-- Composite index for common query pattern: active games in store/state
CREATE INDEX idx_lottery_games_store_status ON lottery_games(store_id, status);
CREATE INDEX idx_lottery_games_state_status ON lottery_games(state_id, status);

-- ============================================================================
-- End of Migration v036
-- ============================================================================
