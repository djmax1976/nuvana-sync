-- ============================================================================
-- Migration v019: Add shift tracking columns to lottery_packs
-- ============================================================================
--
-- Purpose: Enable shift-level audit trail for lottery pack operations
-- This addresses the critical bug where shift_id is not captured during
-- pack activation, depletion, or return operations.
--
-- Business Requirements:
-- - Cashiers MUST have an active shift to activate packs (enforced in app logic)
-- - Managers CAN activate packs without shift (shift_id = null allowed)
-- - All operations should track the associated shift for audit purposes
--
-- Security Compliance:
-- - SEC-006: All queries using these columns must use parameterized statements
-- - SEC-010: AUTHZ - Audit trail for pack operations with user/shift context
-- - DB-006: Columns reference shifts table for referential integrity
--
-- Cloud Schema Alignment:
-- - activated_shift_id: Maps to cloud LotteryPack.activated_shift_id
-- - depleted_shift_id: Maps to cloud LotteryPack.depleted_shift_id
-- - returned_shift_id: Maps to cloud LotteryPack.returned_shift_id
-- - depleted_by: Maps to cloud LotteryPack.depleted_by
-- - returned_by: Maps to cloud LotteryPack.returned_by
-- - depletion_reason: Maps to cloud LotteryPackDepletionReason enum
-- ============================================================================

-- === CRITICAL: Shift tracking for pack lifecycle ===

-- Track which shift the pack was activated during
-- NULL for manager activations without active shift
ALTER TABLE lottery_packs ADD COLUMN activated_shift_id TEXT REFERENCES shifts(shift_id);

-- Track which shift the pack was depleted during
-- NULL if depleted outside of shift context
ALTER TABLE lottery_packs ADD COLUMN depleted_shift_id TEXT REFERENCES shifts(shift_id);

-- Track which shift the pack was returned during
-- NULL if returned outside of shift context
ALTER TABLE lottery_packs ADD COLUMN returned_shift_id TEXT REFERENCES shifts(shift_id);

-- === User tracking for depletion and return operations ===

-- Track who depleted the pack (user_id)
-- This enables the audit trail for depletion operations
ALTER TABLE lottery_packs ADD COLUMN depleted_by TEXT REFERENCES users(user_id);

-- Track who returned the pack (user_id)
-- This enables the audit trail for return operations
ALTER TABLE lottery_packs ADD COLUMN returned_by TEXT REFERENCES users(user_id);

-- === Depletion context ===

-- Reason why pack was depleted
-- Values: SHIFT_CLOSE, AUTO_REPLACED, MANUAL_SOLD_OUT, POS_LAST_TICKET
-- Maps to cloud LotteryPackDepletionReason enum
ALTER TABLE lottery_packs ADD COLUMN depletion_reason TEXT
  CHECK(depletion_reason IS NULL OR depletion_reason IN ('SHIFT_CLOSE', 'AUTO_REPLACED', 'MANUAL_SOLD_OUT', 'POS_LAST_TICKET'));

-- === Indexes for shift-based queries ===
-- These indexes support efficient querying by shift for:
-- - Shift-level lottery reports
-- - Variance calculation by shift
-- - Audit trail lookups

CREATE INDEX idx_lottery_packs_activated_shift ON lottery_packs(activated_shift_id);
CREATE INDEX idx_lottery_packs_depleted_shift ON lottery_packs(depleted_shift_id);
CREATE INDEX idx_lottery_packs_returned_shift ON lottery_packs(returned_shift_id);
CREATE INDEX idx_lottery_packs_depleted_by ON lottery_packs(depleted_by);
CREATE INDEX idx_lottery_packs_returned_by ON lottery_packs(returned_by);
