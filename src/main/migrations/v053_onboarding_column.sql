-- ============================================================================
-- Migration: v053_onboarding_column
-- Description: Add is_onboarding column to lottery_business_days for onboarding state persistence
--
-- Purpose:
--   Persist onboarding mode state in database instead of volatile React state.
--   During onboarding (first-ever lottery day), stores can activate packs
--   without requiring them to exist in inventory first.
--
-- Business Rules (BIZ-012-FIX):
--   - is_onboarding = 1: Store is in onboarding mode (first-ever day, setting up packs)
--   - is_onboarding = 0: Normal operation (requires pack in inventory before activation)
--   - Only one OPEN day with is_onboarding=1 should exist per store at a time
--   - Onboarding ends only via explicit user action (lottery:completeOnboarding)
--
-- Security:
--   SEC-006: DDL statements are static, no user input interpolation
--   DB-006: Index includes store_id for tenant-isolated queries
--
-- Note:
--   Existing days will have is_onboarding = 0 (default) after migration.
--   Only newly initialized first-ever days will have is_onboarding = 1.
-- ============================================================================

-- Add is_onboarding column with DEFAULT 0 (not onboarding)
-- INTEGER type in SQLite for boolean (0 = false, 1 = true)
ALTER TABLE lottery_business_days ADD COLUMN is_onboarding INTEGER NOT NULL DEFAULT 0;

-- Index for efficient lookups when querying onboarding status
-- Composite index on (store_id, is_onboarding) supports:
-- 1. findOnboardingDay(storeId) - WHERE store_id = ? AND is_onboarding = 1
-- 2. getOnboardingStatus queries with tenant isolation
CREATE INDEX idx_lottery_days_onboarding ON lottery_business_days(store_id, is_onboarding);
