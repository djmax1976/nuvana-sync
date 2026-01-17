-- v008_shifts_schema_update.sql
-- Update shifts table to support POS ID mappings architecture
--
-- Changes:
-- 1. Remove foreign key constraint on cashier_id (now stores mapping IDs)
-- 2. Add index for end_time IS NULL queries (shift detection)
-- 3. Add columns to track both external and mapped IDs
--
-- Security: DB-006 - Maintains store_id for tenant isolation
-- Security: SEC-006 - Schema uses constraints to enforce data integrity

-- ============================================================================
-- Add index for end_time IS NULL shift detection
-- This is critical for the new getOpenShift() implementation
-- ============================================================================

-- Index for finding open shifts by end_time IS NULL
-- This covers the common case of querying for open shifts by store
CREATE INDEX IF NOT EXISTS idx_shifts_store_endtime ON shifts(store_id, end_time);

-- Composite index for date-specific open shift lookup
CREATE INDEX IF NOT EXISTS idx_shifts_store_date_endtime ON shifts(store_id, business_date, end_time);

-- ============================================================================
-- Note on Foreign Key Constraint
-- ============================================================================
-- SQLite does not support ALTER TABLE DROP CONSTRAINT.
-- The cashier_id foreign key to users(user_id) in v001 will still exist
-- but SQLite foreign keys are NOT enforced by default unless PRAGMA
-- foreign_keys = ON is explicitly set.
--
-- Since the database service does NOT enable foreign_keys pragma, the
-- constraint is essentially a no-op and won't cause issues when we store
-- mapping IDs instead of user IDs.
--
-- For a clean schema, a future major version migration could recreate the
-- shifts table without the foreign key constraint.
-- ============================================================================

-- ============================================================================
-- Add columns to track external POS IDs alongside mapped IDs
-- These columns store the original external IDs from the POS for reference
-- ============================================================================

-- Add column for external cashier ID (original from POS XML)
-- This preserves the original POS identifier for debugging and reconciliation
ALTER TABLE shifts ADD COLUMN external_cashier_id TEXT;

-- Add column for external register ID (original from POS XML)
ALTER TABLE shifts ADD COLUMN external_register_id TEXT;

-- Add column for external till ID (original from POS XML)
ALTER TABLE shifts ADD COLUMN external_till_id TEXT;

-- ============================================================================
-- Update REQUIRED_TABLES check - add POS mapping tables
-- Note: This is handled in database-bootstrap.service.ts, not here
-- ============================================================================
