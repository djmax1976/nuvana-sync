-- ============================================================================
-- Migration: v048_remove_business_days_unique_constraint
-- Description: Remove UNIQUE(store_id, business_date) constraint to support
--              close-to-close model where multiple business days can exist
--              for the same calendar date.
-- ============================================================================

-- SQLite doesn't support DROP CONSTRAINT, so we need to recreate the table

-- Step 1: Create new table without the unique constraint
CREATE TABLE lottery_business_days_new (
  day_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'PENDING_CLOSE', 'CLOSED')),
  opened_at TEXT,
  closed_at TEXT,
  opened_by TEXT REFERENCES users(user_id),
  closed_by TEXT REFERENCES users(user_id),
  total_sales REAL NOT NULL DEFAULT 0 CHECK(total_sales >= 0),
  total_packs_sold INTEGER NOT NULL DEFAULT 0 CHECK(total_packs_sold >= 0),
  total_packs_activated INTEGER NOT NULL DEFAULT 0 CHECK(total_packs_activated >= 0),
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  -- REMOVED: UNIQUE(store_id, business_date) - multiple days per date now allowed
);

-- Step 2: Copy data from old table
INSERT INTO lottery_business_days_new (
  day_id, store_id, business_date, status, opened_at, closed_at,
  opened_by, closed_by, total_sales, total_packs_sold, total_packs_activated,
  synced_at, created_at, updated_at
)
SELECT
  day_id, store_id, business_date, status, opened_at, closed_at,
  opened_by, closed_by, total_sales, total_packs_sold, total_packs_activated,
  synced_at, created_at, updated_at
FROM lottery_business_days;

-- Step 3: Drop old table
DROP TABLE lottery_business_days;

-- Step 4: Rename new table to original name
ALTER TABLE lottery_business_days_new RENAME TO lottery_business_days;

-- Step 5: Recreate indexes
CREATE INDEX idx_lottery_days_date ON lottery_business_days(business_date);
CREATE INDEX idx_lottery_days_status ON lottery_business_days(store_id, status);
-- Add index for store+date lookups (not unique, just for performance)
CREATE INDEX idx_lottery_days_store_date ON lottery_business_days(store_id, business_date);
