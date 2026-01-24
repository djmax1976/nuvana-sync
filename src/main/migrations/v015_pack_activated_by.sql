-- ============================================================================
-- Migration v015: Add activated_by column to lottery_packs
-- ============================================================================
--
-- Purpose: Track which user activated each pack for audit trail
-- Story: Pack Activation Audit Trail
--
-- SEC-010: AUTHZ - Audit trail for pack activation
-- DB-006: Store-scoped - activated_by references users table
-- ============================================================================

-- Add activated_by column to track who activated the pack
ALTER TABLE lottery_packs ADD COLUMN activated_by TEXT REFERENCES users(user_id);

-- Create index for efficient lookup by activator
CREATE INDEX idx_lottery_packs_activated_by ON lottery_packs(activated_by);
