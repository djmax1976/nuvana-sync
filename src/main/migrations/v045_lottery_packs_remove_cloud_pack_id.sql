-- ============================================================================
-- Migration v045: Remove cloud_pack_id from lottery_packs
-- ============================================================================
--
-- Purpose: Align local lottery_packs schema by removing the redundant
-- cloud_pack_id column and using the cloud's ID directly as the primary key.
--
-- Background:
-- The local implementation was generating new UUIDs for pack_id and
-- storing the cloud's ID separately in cloud_pack_id. This causes
-- sync issues where the cloud expects cloud IDs but local FKs use local IDs.
--
-- Changes:
-- 1. Temporarily disable FK constraints
-- 2. Update child table FKs to reference cloud_pack_id values
-- 3. Copy cloud_pack_id to pack_id
-- 4. Drop cloud_pack_id column
-- 5. Drop related index
-- 6. Re-enable FK constraints
--
-- Security Compliance:
-- - SEC-006: No user input; migration uses literal SQL only
-- - DB-006: Tenant isolation maintained via store_id column
--
-- ============================================================================

-- ==========================================================================
-- Step 0: Defer foreign key constraint checking until commit
-- ==========================================================================
-- Note: PRAGMA foreign_keys = OFF doesn't work inside transactions,
-- but defer_foreign_keys does - it delays FK checking until commit.

PRAGMA defer_foreign_keys = ON;

-- ==========================================================================
-- Step 1: Update all child tables to use cloud IDs
-- ==========================================================================

-- 1a. lottery_shift_openings.pack_id
UPDATE lottery_shift_openings
SET pack_id = (
  SELECT cloud_pack_id FROM lottery_packs
  WHERE lottery_packs.pack_id = lottery_shift_openings.pack_id
    AND lottery_packs.cloud_pack_id IS NOT NULL
)
WHERE pack_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_packs
    WHERE lottery_packs.pack_id = lottery_shift_openings.pack_id
      AND lottery_packs.cloud_pack_id IS NOT NULL
  );

-- 1b. lottery_shift_closings.pack_id
UPDATE lottery_shift_closings
SET pack_id = (
  SELECT cloud_pack_id FROM lottery_packs
  WHERE lottery_packs.pack_id = lottery_shift_closings.pack_id
    AND lottery_packs.cloud_pack_id IS NOT NULL
)
WHERE pack_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_packs
    WHERE lottery_packs.pack_id = lottery_shift_closings.pack_id
      AND lottery_packs.cloud_pack_id IS NOT NULL
  );

-- 1c. lottery_day_packs.pack_id
UPDATE lottery_day_packs
SET pack_id = (
  SELECT cloud_pack_id FROM lottery_packs
  WHERE lottery_packs.pack_id = lottery_day_packs.pack_id
    AND lottery_packs.cloud_pack_id IS NOT NULL
)
WHERE pack_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_packs
    WHERE lottery_packs.pack_id = lottery_day_packs.pack_id
      AND lottery_packs.cloud_pack_id IS NOT NULL
  );

-- 1d. lottery_variances.pack_id
UPDATE lottery_variances
SET pack_id = (
  SELECT cloud_pack_id FROM lottery_packs
  WHERE lottery_packs.pack_id = lottery_variances.pack_id
    AND lottery_packs.cloud_pack_id IS NOT NULL
)
WHERE pack_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_packs
    WHERE lottery_packs.pack_id = lottery_variances.pack_id
      AND lottery_packs.cloud_pack_id IS NOT NULL
  );

-- 1e. lottery_activations.pack_id
UPDATE lottery_activations
SET pack_id = (
  SELECT cloud_pack_id FROM lottery_packs
  WHERE lottery_packs.pack_id = lottery_activations.pack_id
    AND lottery_packs.cloud_pack_id IS NOT NULL
)
WHERE pack_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_packs
    WHERE lottery_packs.pack_id = lottery_activations.pack_id
      AND lottery_packs.cloud_pack_id IS NOT NULL
  );

-- ==========================================================================
-- Step 2: Copy cloud_pack_id to pack_id
-- ==========================================================================

UPDATE lottery_packs
SET pack_id = cloud_pack_id
WHERE cloud_pack_id IS NOT NULL;

-- ==========================================================================
-- Step 3: Drop the index on cloud_pack_id (MUST be before column drop)
-- ==========================================================================

DROP INDEX IF EXISTS idx_lottery_packs_cloud_id;

-- ==========================================================================
-- Step 4: Drop the cloud_pack_id column
-- ==========================================================================

ALTER TABLE lottery_packs DROP COLUMN cloud_pack_id;

-- ==========================================================================
-- Step 5: Foreign key constraints
-- ==========================================================================
-- Note: defer_foreign_keys automatically resets to OFF after transaction commit.
-- FK constraints will be checked at commit time.

-- ============================================================================
-- End of Migration v045
-- ============================================================================
