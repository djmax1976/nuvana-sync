-- ============================================================================
-- Migration v022: Add dual-auth and entry method fields to lottery_shift_closings
-- ============================================================================
--
-- Purpose: Support dual-authorization for manual serial entries and track entry method
-- This enables security controls for manual data entry during shift closings.
--
-- Priority: P2 (High) - Required for enterprise security controls
--
-- Business Requirements:
-- - Track whether serial was scanned or manually entered
-- - Manual entries require authorization from a manager
-- - Capture who authorized and when for audit trail
-- - Link closings to cashier for accountability
--
-- Dual-Auth Workflow:
-- 1. Cashier enters closing serial (SCAN or MANUAL)
-- 2. If MANUAL entry, system requires manager authorization
-- 3. Manager reviews and authorizes the manual entry
-- 4. Authorization recorded with timestamp for audit
--
-- Security Compliance:
-- - SEC-006: All queries using these columns must use parameterized statements
-- - SEC-010: AUTHZ - Dual-control for manual entries
-- - DB-006: Columns reference users table for referential integrity
--
-- Cloud Schema Alignment (lines 1858-1880):
-- - cashier_id: User who performed the closing
-- - entry_method: SCAN or MANUAL
-- - manual_entry_authorized_by: Manager who approved manual entry
-- - manual_entry_authorized_at: When authorization was granted
-- ============================================================================

-- === Cashier accountability ===
-- Track which cashier performed the shift closing
ALTER TABLE lottery_shift_closings ADD COLUMN cashier_id TEXT REFERENCES users(user_id);

-- === Entry method tracking ===
-- SCAN: Serial was scanned from barcode (automated, trusted)
-- MANUAL: Serial was manually typed (requires authorization)
ALTER TABLE lottery_shift_closings ADD COLUMN entry_method TEXT
  CHECK(entry_method IS NULL OR entry_method IN ('SCAN', 'MANUAL'));

-- === Manual entry authorization ===
-- When entry_method = 'MANUAL', these fields track authorization
-- manual_entry_authorized_by: Manager who approved the manual entry
-- manual_entry_authorized_at: Timestamp when authorization was granted
ALTER TABLE lottery_shift_closings ADD COLUMN manual_entry_authorized_by TEXT REFERENCES users(user_id);
ALTER TABLE lottery_shift_closings ADD COLUMN manual_entry_authorized_at TEXT;

-- === Indexes for audit queries ===
-- Find closings by cashier
CREATE INDEX idx_lottery_closings_cashier ON lottery_shift_closings(cashier_id);

-- Find manual entries that may need review
CREATE INDEX idx_lottery_closings_manual_auth ON lottery_shift_closings(manual_entry_authorized_by);

-- Find entries by method for audit
CREATE INDEX idx_lottery_closings_entry_method ON lottery_shift_closings(entry_method)
  WHERE entry_method = 'MANUAL';
