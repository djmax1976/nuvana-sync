-- ============================================================================
-- Migration v006: Add received_by column to lottery_packs
-- ============================================================================
--
-- Purpose: Track which user received each pack for audit trail
-- Story: Pack Reception PIN Verification
--
-- SEC-010: AUTHZ - Audit trail for pack reception
-- DB-006: Store-scoped - received_by references users table
-- ============================================================================

-- Add received_by column to track who received the pack
ALTER TABLE lottery_packs ADD COLUMN received_by TEXT REFERENCES users(user_id);

-- Create index for efficient lookup by receiver
CREATE INDEX idx_lottery_packs_received_by ON lottery_packs(received_by);
