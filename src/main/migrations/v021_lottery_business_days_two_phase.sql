-- ============================================================================
-- Migration v021: Add two-phase commit fields to lottery_business_days
-- ============================================================================
--
-- Purpose: Support two-phase commit workflow for day close operations
-- This enables the "prepare close" -> "confirm close" workflow to prevent
-- accidental day closes and allow manager review before finalizing.
--
-- Priority: P2 (High) - Required for enterprise day close workflow
--
-- Business Requirements:
-- - Day close can be initiated (prepared) without being final
-- - Prepared close data can be reviewed and modified before confirmation
-- - Pending closes expire after a configurable timeout
-- - Confirmation requires explicit manager approval
--
-- Two-Phase Commit Workflow:
-- 1. PREPARE: User initiates close, system captures pending_close_data as JSON
-- 2. REVIEW: Manager reviews and can modify pending data
-- 3. CONFIRM: Manager confirms, system applies pending data and sets closed_at
-- 4. EXPIRE: If not confirmed within timeout, pending data is cleared
--
-- Security Compliance:
-- - SEC-006: All queries using these columns must use parameterized statements
-- - SEC-010: AUTHZ - Track who prepared and who confirmed the close
-- - DB-006: Columns reference users table for referential integrity
--
-- Cloud Schema Alignment (lines 2042-2049):
-- - pending_close_data: JSON blob with day close data
-- - pending_close_by: User who prepared the close
-- - pending_close_at: When close was prepared
-- - pending_close_expires_at: Expiration timestamp for pending close
-- ============================================================================

-- === Two-Phase Commit Fields ===

-- JSON blob containing pending close data
-- Structure: {
--   packs_closed: [{pack_id, closing_serial, tickets_sold, sales_amount}],
--   daily_totals: {total_activated, total_depleted, total_returned, total_sales},
--   notes: string
-- }
ALTER TABLE lottery_business_days ADD COLUMN pending_close_data TEXT;

-- User who initiated (prepared) the close
ALTER TABLE lottery_business_days ADD COLUMN pending_close_by TEXT REFERENCES users(user_id);

-- Timestamp when close was prepared
ALTER TABLE lottery_business_days ADD COLUMN pending_close_at TEXT;

-- Expiration timestamp - pending close automatically cleared if not confirmed by this time
-- Default timeout is typically 30 minutes (configured in app)
ALTER TABLE lottery_business_days ADD COLUMN pending_close_expires_at TEXT;

-- === Confirmation Fields ===

-- User who confirmed (finalized) the close - may differ from pending_close_by
-- This supports the dual-control workflow where one person prepares and another confirms
ALTER TABLE lottery_business_days ADD COLUMN confirmed_close_by TEXT REFERENCES users(user_id);

-- Timestamp when close was confirmed/finalized
ALTER TABLE lottery_business_days ADD COLUMN confirmed_close_at TEXT;

-- === Additional audit fields from cloud schema ===

-- NOTE: opened_by column already exists in v003_lottery_tables.sql

-- Notes field for day-level comments
ALTER TABLE lottery_business_days ADD COLUMN notes TEXT;

-- === Rollback Support ===

-- If a day close needs to be undone (rare, requires special permission)
ALTER TABLE lottery_business_days ADD COLUMN reopened_at TEXT;
ALTER TABLE lottery_business_days ADD COLUMN reopened_by TEXT REFERENCES users(user_id);
ALTER TABLE lottery_business_days ADD COLUMN reopen_reason TEXT;

-- === Indexes for two-phase commit queries ===

-- Find pending closes that need confirmation or have expired
CREATE INDEX idx_lottery_business_days_pending ON lottery_business_days(pending_close_at)
  WHERE pending_close_data IS NOT NULL;

-- Find by confirmation status
CREATE INDEX idx_lottery_business_days_confirmed ON lottery_business_days(confirmed_close_at);
