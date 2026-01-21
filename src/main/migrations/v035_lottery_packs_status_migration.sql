-- ============================================================================
-- Migration v035: Lottery Packs Status Value Migration
-- ============================================================================
--
-- Purpose: Update lottery_packs status values to match API-aligned naming
-- convention established in v029 schema changes.
--
-- Background:
-- Migration v029 renamed columns and updated the CHECK constraint to use new
-- status values ('ACTIVE', 'DEPLETED'), but did NOT migrate existing data
-- from old values ('ACTIVATED', 'SETTLED'). This migration corrects that.
--
-- Changes:
-- 1. UPDATE: status 'ACTIVATED' -> 'ACTIVE'
-- 2. UPDATE: status 'SETTLED' -> 'DEPLETED'
--
-- Security Compliance:
-- - SEC-006: No user input; hardcoded literal values only
-- - DB-006: Tenant isolation not affected; all stores updated uniformly
-- - No injection risk: UPDATE statements use literal string comparisons
--
-- Performance:
-- - Uses indexed column (status) in WHERE clause
-- - idx_packs_store_status index supports this query pattern
-- - Bounded operation: only updates rows matching specific status values
--
-- Idempotency:
-- - Safe to run multiple times; WHERE clause ensures no double-updates
-- - After first run, no rows match old status values
--
-- Rollback:
-- - UPDATE lottery_packs SET status = 'ACTIVATED' WHERE status = 'ACTIVE';
-- - UPDATE lottery_packs SET status = 'SETTLED' WHERE status = 'DEPLETED';
-- ============================================================================

-- Step 1: Migrate ACTIVATED -> ACTIVE
-- Affects packs that are currently in bins being sold
UPDATE lottery_packs
SET status = 'ACTIVE', updated_at = datetime('now')
WHERE status = 'ACTIVATED';

-- Step 2: Migrate SETTLED -> DEPLETED
-- Affects packs that were sold out / finished
UPDATE lottery_packs
SET status = 'DEPLETED', updated_at = datetime('now')
WHERE status = 'SETTLED';

-- ============================================================================
-- End of Migration v035
-- ============================================================================
