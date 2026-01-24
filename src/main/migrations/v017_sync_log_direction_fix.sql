-- v017_sync_log_direction_fix.sql
-- This migration is now a no-op.
-- The sync_log schema was already fixed in v016_sync_log_schema_fix.sql
-- which renamed 'direction' to 'sync_type' and added missing columns.
--
-- Keeping this as an empty migration to maintain migration version history.

-- No-op: just select 1 to make SQLite happy
SELECT 1;
