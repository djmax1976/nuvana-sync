-- v005_lottery_config.sql
-- Lottery configuration values table and lottery_games enhancements
--
-- Security: DB-006 - Config values are global (no store_id needed - read-only from cloud)
-- Security: SEC-006 - Schema uses constraints to enforce data integrity
-- Note: Data is synced from cloud on-demand, not seeded locally

-- ============================================================================
-- Lottery Configuration Values
-- ============================================================================

-- Configuration values for lottery dropdowns (ticket prices, pack values)
-- These values are fetched from cloud and cached locally
-- No store_id - these are global configuration values
CREATE TABLE lottery_config_values (
  config_value_id TEXT PRIMARY KEY,
  config_type TEXT NOT NULL CHECK(config_type IN ('TICKET_PRICE', 'PACK_VALUE')),
  amount REAL NOT NULL CHECK(amount > 0),
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unique constraint: one amount per config type
  UNIQUE(config_type, amount)
);

-- Index for active config values by type (most common query pattern)
CREATE INDEX idx_lottery_config_type_active ON lottery_config_values(config_type, is_active, display_order);

-- ============================================================================
-- Store Enhancements
-- ============================================================================

-- Add state_id and state_code to stores table
-- Fetched from cloud during API key validation
ALTER TABLE stores ADD COLUMN state_id TEXT;
ALTER TABLE stores ADD COLUMN state_code TEXT;

-- ============================================================================
-- Lottery Games Enhancements
-- ============================================================================

-- Add state_id column to lottery_games for state-scoped games
-- This supports games synced from cloud (state-scoped) vs locally created (store-scoped)
-- NULL state_id + store_id = store-scoped game (created locally)
-- state_id + NULL store_id = state-scoped game (synced from cloud) - NOT USED IN MVP
-- For MVP: All local games have store_id set, state_id is for compliance/reporting
ALTER TABLE lottery_games ADD COLUMN state_id TEXT;

-- Index for state-scoped game lookup
CREATE INDEX idx_lottery_games_state ON lottery_games(state_id);

-- Combined index for game code lookup with state priority
CREATE INDEX idx_lottery_games_code_state ON lottery_games(game_code, state_id, status);
