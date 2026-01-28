-- ============================================================================
-- Migration v043: Remove cloud_user_id from users
-- ============================================================================
--
-- Purpose: Align local users schema by removing the redundant
-- cloud_user_id column and using the cloud's ID directly as the
-- primary key.
--
-- Background:
-- The local implementation was generating new UUIDs for user_id and
-- storing the cloud's ID separately in cloud_user_id. This causes
-- sync issues where the cloud expects cloud IDs but local FKs use local IDs.
--
-- Changes:
-- 1. Temporarily disable FK constraints
-- 2. Update ALL child table FKs to reference cloud_user_id values
-- 3. Copy cloud_user_id to user_id
-- 4. Drop cloud_user_id column
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
-- This is required because we update child table FKs to new values before
-- updating the parent table's PK column.
-- Note: PRAGMA foreign_keys = OFF doesn't work inside transactions,
-- but defer_foreign_keys does - it delays FK checking until commit.

PRAGMA defer_foreign_keys = ON;

-- ==========================================================================
-- Step 1: Update all child tables to use cloud IDs
-- ==========================================================================

-- 1a. shifts.cashier_id
UPDATE shifts
SET cashier_id = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = shifts.cashier_id AND users.cloud_user_id IS NOT NULL
)
WHERE cashier_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = shifts.cashier_id AND users.cloud_user_id IS NOT NULL
  );

-- 1b. lottery_packs - multiple user FK columns
UPDATE lottery_packs
SET received_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_packs.received_by AND users.cloud_user_id IS NOT NULL
)
WHERE received_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_packs.received_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_packs
SET activated_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_packs.activated_by AND users.cloud_user_id IS NOT NULL
)
WHERE activated_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_packs.activated_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_packs
SET depleted_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_packs.depleted_by AND users.cloud_user_id IS NOT NULL
)
WHERE depleted_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_packs.depleted_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_packs
SET returned_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_packs.returned_by AND users.cloud_user_id IS NOT NULL
)
WHERE returned_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_packs.returned_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_packs
SET serial_override_approved_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_packs.serial_override_approved_by AND users.cloud_user_id IS NOT NULL
)
WHERE serial_override_approved_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_packs.serial_override_approved_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_packs
SET mark_sold_approved_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_packs.mark_sold_approved_by AND users.cloud_user_id IS NOT NULL
)
WHERE mark_sold_approved_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_packs.mark_sold_approved_by AND users.cloud_user_id IS NOT NULL
  );

-- 1c. lottery_business_days - multiple user FK columns
UPDATE lottery_business_days
SET opened_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_business_days.opened_by AND users.cloud_user_id IS NOT NULL
)
WHERE opened_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_business_days.opened_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_business_days
SET closed_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_business_days.closed_by AND users.cloud_user_id IS NOT NULL
)
WHERE closed_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_business_days.closed_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_business_days
SET pending_close_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_business_days.pending_close_by AND users.cloud_user_id IS NOT NULL
)
WHERE pending_close_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_business_days.pending_close_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_business_days
SET confirmed_close_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_business_days.confirmed_close_by AND users.cloud_user_id IS NOT NULL
)
WHERE confirmed_close_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_business_days.confirmed_close_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_business_days
SET reopened_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_business_days.reopened_by AND users.cloud_user_id IS NOT NULL
)
WHERE reopened_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_business_days.reopened_by AND users.cloud_user_id IS NOT NULL
  );

-- 1d. lottery_shift_openings.recorded_by
UPDATE lottery_shift_openings
SET recorded_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_shift_openings.recorded_by AND users.cloud_user_id IS NOT NULL
)
WHERE recorded_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_shift_openings.recorded_by AND users.cloud_user_id IS NOT NULL
  );

-- 1e. lottery_shift_closings - multiple user FK columns
UPDATE lottery_shift_closings
SET recorded_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_shift_closings.recorded_by AND users.cloud_user_id IS NOT NULL
)
WHERE recorded_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_shift_closings.recorded_by AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_shift_closings
SET cashier_id = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_shift_closings.cashier_id AND users.cloud_user_id IS NOT NULL
)
WHERE cashier_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_shift_closings.cashier_id AND users.cloud_user_id IS NOT NULL
  );

UPDATE lottery_shift_closings
SET manual_entry_authorized_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_shift_closings.manual_entry_authorized_by AND users.cloud_user_id IS NOT NULL
)
WHERE manual_entry_authorized_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_shift_closings.manual_entry_authorized_by AND users.cloud_user_id IS NOT NULL
  );

-- 1f. lottery_variances.approved_by
UPDATE lottery_variances
SET approved_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_variances.approved_by AND users.cloud_user_id IS NOT NULL
)
WHERE approved_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_variances.approved_by AND users.cloud_user_id IS NOT NULL
  );

-- 1g. lottery_activations.activated_by
UPDATE lottery_activations
SET activated_by = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_activations.activated_by AND users.cloud_user_id IS NOT NULL
)
WHERE activated_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_activations.activated_by AND users.cloud_user_id IS NOT NULL
  );

-- 1h. lottery_games.created_by_user_id
UPDATE lottery_games
SET created_by_user_id = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = lottery_games.created_by_user_id AND users.cloud_user_id IS NOT NULL
)
WHERE created_by_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = lottery_games.created_by_user_id AND users.cloud_user_id IS NOT NULL
  );

-- 1i. pos_cashier_mappings.internal_user_id
UPDATE pos_cashier_mappings
SET internal_user_id = (
  SELECT cloud_user_id FROM users
  WHERE users.user_id = pos_cashier_mappings.internal_user_id AND users.cloud_user_id IS NOT NULL
)
WHERE internal_user_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM users
    WHERE users.user_id = pos_cashier_mappings.internal_user_id AND users.cloud_user_id IS NOT NULL
  );

-- ==========================================================================
-- Step 2: Copy cloud_user_id to user_id
-- ==========================================================================

UPDATE users
SET user_id = cloud_user_id
WHERE cloud_user_id IS NOT NULL;

-- ==========================================================================
-- Step 3: Drop the index on cloud_user_id (MUST be before column drop)
-- ==========================================================================

DROP INDEX IF EXISTS idx_users_cloud_id;

-- ==========================================================================
-- Step 4: Drop the cloud_user_id column
-- ==========================================================================

ALTER TABLE users DROP COLUMN cloud_user_id;

-- ==========================================================================
-- Step 5: Foreign key constraints
-- ==========================================================================
-- Note: defer_foreign_keys automatically resets to OFF after transaction commit.
-- FK constraints will be checked at commit time.

-- ============================================================================
-- End of Migration v043
-- ============================================================================
