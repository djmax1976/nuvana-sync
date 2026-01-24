-- ============================================================================
-- Migration v023: Align lottery_games with cloud schema
-- ============================================================================
--
-- Purpose: Add missing fields from cloud LotteryGame model
--
-- Priority: P3 (Medium) - Game metadata enhancements
--
-- Cloud Schema Alignment:
-- - description: Game description text
-- - created_by_user_id: Who created the game record
-- - state_id: Optional state-level scoping for multi-state operations
-- ============================================================================

-- === Game metadata fields ===
ALTER TABLE lottery_games ADD COLUMN description TEXT;
ALTER TABLE lottery_games ADD COLUMN created_by_user_id TEXT REFERENCES users(user_id);

-- NOTE: state_id column and idx_lottery_games_state index already exist from v005_lottery_config.sql

-- Note: The status CHECK constraint should be updated to include 'DISCONTINUED'
-- but SQLite requires table recreation for constraint changes.
-- For now, the app layer will handle DISCONTINUED status validation.
-- Future migration can recreate the table with updated constraint if needed.
