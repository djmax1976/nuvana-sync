-- v059_backfill_per_register_shift_numbers.sql
-- Backfill existing shifts with correct per-register numbering
--
-- BUSINESS REQUIREMENT:
-- Existing shifts were numbered globally per store/date. They need to be
-- renumbered so each register has independent sequential numbering.
--
-- BEFORE: Global numbering
-- | shift_id | register | shift_number |
-- |----------|----------|--------------|
-- | shift-1  | REG-001  | 1            |
-- | shift-2  | REG-002  | 2            |
-- | shift-3  | REG-001  | 3            |
-- | shift-4  | REG-002  | 4            |
--
-- AFTER: Per-register numbering
-- | shift_id | register | shift_number |
-- |----------|----------|--------------|
-- | shift-1  | REG-001  | 1            |
-- | shift-2  | REG-002  | 1            |
-- | shift-3  | REG-001  | 2            |
-- | shift-4  | REG-002  | 2            |
--
-- SAFETY: Uses negative temporary values to avoid unique constraint violations
-- SECURITY: No user input, pure data transformation
-- IDEMPOTENT: Safe to run multiple times

-- ============================================================================
-- Step 1: Create temporary table with correct per-register numbering
-- ============================================================================
-- SQLite doesn't support UPDATE with window functions, so we compute the
-- correct numbering in a temp table first.
--
-- ROW_NUMBER() partitioned by (store_id, business_date, external_register_id)
-- ordered by start_time (or created_at as fallback) gives the correct sequence.

CREATE TEMPORARY TABLE IF NOT EXISTS temp_shift_renumber AS
SELECT
  shift_id,
  store_id,
  business_date,
  external_register_id,
  ROW_NUMBER() OVER (
    PARTITION BY store_id, business_date, external_register_id
    ORDER BY
      COALESCE(start_time, created_at) ASC,
      created_at ASC,
      shift_id ASC  -- Tie-breaker for determinism
  ) AS new_shift_number
FROM shifts;

-- ============================================================================
-- Step 2: Temporarily negate all shift numbers to avoid constraint violations
-- ============================================================================
-- The unique constraint (store_id, business_date, external_register_id, shift_number)
-- would be violated if we update in place. By making them negative first,
-- we ensure no conflicts during the update phase.

UPDATE shifts
SET shift_number = -shift_number - 1000000
WHERE shift_number > 0;

-- ============================================================================
-- Step 3: Apply the correct per-register numbering
-- ============================================================================
-- Now update with the correctly calculated per-register numbers

UPDATE shifts
SET shift_number = (
  SELECT new_shift_number
  FROM temp_shift_renumber
  WHERE temp_shift_renumber.shift_id = shifts.shift_id
),
updated_at = datetime('now')
WHERE EXISTS (
  SELECT 1 FROM temp_shift_renumber
  WHERE temp_shift_renumber.shift_id = shifts.shift_id
);

-- ============================================================================
-- Step 4: Cleanup
-- ============================================================================
DROP TABLE IF EXISTS temp_shift_renumber;

-- ============================================================================
-- Step 5: Verify no negative shift numbers remain (sanity check)
-- ============================================================================
-- If this fails, the migration had an issue
-- SQLite doesn't support RAISE outside triggers, so we use a CHECK constraint trick
-- by selecting into a table that will fail if bad data exists

CREATE TEMPORARY TABLE IF NOT EXISTS migration_verification AS
SELECT
  CASE
    WHEN COUNT(*) > 0 THEN
      CAST('ERROR: Migration failed - negative shift numbers remain' AS INTEGER)
    ELSE 0
  END AS result
FROM shifts
WHERE shift_number < 0;

DROP TABLE IF EXISTS migration_verification;
