-- ============================================================================
-- Migration v033: Lottery Variances API Field Alignment
-- ============================================================================
--
-- Purpose: Rename columns to align with cloud API schema for bidirectional sync.
--
-- Priority: P2 (High) - Required for API sync compatibility
--
-- Changes:
-- 1. RENAME: expected_count -> expected (matches API field name)
-- 2. RENAME: actual_count -> actual (matches API field name)
-- 3. RENAME: variance -> difference (matches API field name - avoids SQL keyword)
-- 4. RENAME: notes -> reason (matches API field name)
-- 5. RENAME: reviewed_by -> approved_by (matches API field name)
-- 6. RENAME: reviewed_at -> approved_at (matches API field name)
--
-- Security Compliance:
-- - SEC-006: Migration uses table recreation pattern (no user input)
-- - DB-006: Store-scoped foreign keys preserved
--
-- Cloud Schema Alignment (replica_end_points.md):
-- - expected: Maps to VarianceSyncRecord.expected
-- - actual: Maps to VarianceSyncRecord.actual
-- - difference: Maps to VarianceSyncRecord.difference
-- - reason: Maps to VarianceSyncRecord.reason
-- - approved_by: Maps to VarianceSyncRecord.approved_by
-- - approved_at: Maps to VarianceSyncRecord.approved_at
--
-- NOTE: SQLite does not support ALTER TABLE RENAME COLUMN in older versions.
-- We must recreate the table to rename columns safely.
-- ============================================================================

-- Step 1: Create new table with renamed columns
-- Includes shift_id from v026 migration
CREATE TABLE lottery_variances_new (
  variance_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  day_id TEXT NOT NULL REFERENCES lottery_business_days(day_id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL REFERENCES lottery_packs(pack_id),

  -- v026: shift_id for shift-level variance tracking
  shift_id TEXT REFERENCES shifts(shift_id),

  -- RENAMED: expected_count -> expected (API alignment)
  expected INTEGER NOT NULL,

  -- RENAMED: actual_count -> actual (API alignment)
  actual INTEGER NOT NULL,

  -- RENAMED: variance -> difference (API alignment, avoids SQL keyword)
  difference INTEGER NOT NULL,

  variance_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'REVIEWED', 'RESOLVED')),

  -- RENAMED: notes -> reason (API alignment)
  reason TEXT,

  -- RENAMED: reviewed_by -> approved_by (API alignment)
  approved_by TEXT REFERENCES users(user_id),

  -- RENAMED: reviewed_at -> approved_at (API alignment)
  approved_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Step 2: Copy data with column mapping
INSERT INTO lottery_variances_new (
  variance_id, store_id, day_id, pack_id, shift_id,
  expected,
  actual,
  difference,
  variance_amount, status,
  reason,
  approved_by,
  approved_at,
  created_at
)
SELECT
  variance_id, store_id, day_id, pack_id, shift_id,
  expected_count,  -- Maps to expected
  actual_count,    -- Maps to actual
  variance,        -- Maps to difference
  variance_amount, status,
  notes,           -- Maps to reason
  reviewed_by,     -- Maps to approved_by
  reviewed_at,     -- Maps to approved_at
  created_at
FROM lottery_variances;

-- Step 3: Drop old table
DROP TABLE lottery_variances;

-- Step 4: Rename new table to original name
ALTER TABLE lottery_variances_new RENAME TO lottery_variances;

-- Step 5: Recreate indexes
CREATE INDEX idx_variances_day ON lottery_variances(day_id);
CREATE INDEX idx_variances_pack ON lottery_variances(pack_id);
CREATE INDEX idx_variances_status ON lottery_variances(store_id, status);
CREATE INDEX idx_lottery_variances_shift ON lottery_variances(shift_id);

-- Step 6: Update sync_queue payloads to use new field names
UPDATE sync_queue
SET payload = REPLACE(
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(payload,
            '"expected_count":', '"expected":'),
          '"actual_count":', '"actual":'),
        '"variance":', '"difference":'),
      '"notes":', '"reason":'),
    '"reviewed_by":', '"approved_by":'),
  '"reviewed_at":', '"approved_at":')
WHERE entity_type = 'variance' AND (
  payload LIKE '%"expected_count":%' OR
  payload LIKE '%"actual_count":%' OR
  payload LIKE '%"variance":%' OR
  payload LIKE '%"notes":%' OR
  payload LIKE '%"reviewed_by":%' OR
  payload LIKE '%"reviewed_at":%'
);

-- ============================================================================
-- End of Migration v033
-- ============================================================================
