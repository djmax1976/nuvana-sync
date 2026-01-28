-- ============================================================================
-- Migration v044: Remove cloud_day_id from lottery_business_days
-- ============================================================================
--
-- Purpose: Align local lottery_business_days schema by removing the redundant
-- cloud_day_id column and using the cloud's ID directly as the primary key.
--
-- Background:
-- The local implementation was generating new UUIDs for day_id and
-- storing the cloud's ID separately in cloud_day_id. This causes
-- sync issues where the cloud expects cloud IDs but local FKs use local IDs.
--
-- Changes:
-- 1. Temporarily disable FK constraints
-- 2. Update child table FKs to reference cloud_day_id values
-- 3. Copy cloud_day_id to day_id
-- 4. Drop cloud_day_id column
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

-- 1a. lottery_day_packs.day_id
UPDATE lottery_day_packs
SET day_id = (
  SELECT cloud_day_id FROM lottery_business_days
  WHERE lottery_business_days.day_id = lottery_day_packs.day_id
    AND lottery_business_days.cloud_day_id IS NOT NULL
)
WHERE day_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_business_days
    WHERE lottery_business_days.day_id = lottery_day_packs.day_id
      AND lottery_business_days.cloud_day_id IS NOT NULL
  );

-- 1b. lottery_variances.day_id
UPDATE lottery_variances
SET day_id = (
  SELECT cloud_day_id FROM lottery_business_days
  WHERE lottery_business_days.day_id = lottery_variances.day_id
    AND lottery_business_days.cloud_day_id IS NOT NULL
)
WHERE day_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_business_days
    WHERE lottery_business_days.day_id = lottery_variances.day_id
      AND lottery_business_days.cloud_day_id IS NOT NULL
  );

-- 1c. lottery_activations.day_id
UPDATE lottery_activations
SET day_id = (
  SELECT cloud_day_id FROM lottery_business_days
  WHERE lottery_business_days.day_id = lottery_activations.day_id
    AND lottery_business_days.cloud_day_id IS NOT NULL
)
WHERE day_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_business_days
    WHERE lottery_business_days.day_id = lottery_activations.day_id
      AND lottery_business_days.cloud_day_id IS NOT NULL
  );

-- 1d. lottery_packs.returned_day_id
UPDATE lottery_packs
SET returned_day_id = (
  SELECT cloud_day_id FROM lottery_business_days
  WHERE lottery_business_days.day_id = lottery_packs.returned_day_id
    AND lottery_business_days.cloud_day_id IS NOT NULL
)
WHERE returned_day_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM lottery_business_days
    WHERE lottery_business_days.day_id = lottery_packs.returned_day_id
      AND lottery_business_days.cloud_day_id IS NOT NULL
  );

-- ==========================================================================
-- Step 2: Copy cloud_day_id to day_id
-- ==========================================================================

UPDATE lottery_business_days
SET day_id = cloud_day_id
WHERE cloud_day_id IS NOT NULL;

-- ==========================================================================
-- Step 3: Drop the index on cloud_day_id (MUST be before column drop)
-- ==========================================================================

DROP INDEX IF EXISTS idx_lottery_business_days_cloud_id;

-- ==========================================================================
-- Step 4: Drop the cloud_day_id column
-- ==========================================================================

ALTER TABLE lottery_business_days DROP COLUMN cloud_day_id;

-- ==========================================================================
-- Step 5: Foreign key constraints
-- ==========================================================================
-- Note: defer_foreign_keys automatically resets to OFF after transaction commit.
-- FK constraints will be checked at commit time.

-- ============================================================================
-- End of Migration v044
-- ============================================================================
