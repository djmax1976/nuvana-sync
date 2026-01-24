-- v018_purge_invalid_sync_entities.sql
-- Purge invalid entity types from sync_queue that have no cloud API push endpoints
--
-- Context: The sync_queue was previously populated with entity types that don't have
-- corresponding push endpoints in the cloud API. These items would perpetually fail
-- and accumulate in the queue.
--
-- Valid entity types (have push endpoints in api.md):
-- - pack: /api/v1/sync/lottery/packs/receive, activate, deplete, return, move
-- - shift_opening: /api/v1/sync/lottery/shift/open
-- - shift_closing: /api/v1/sync/lottery/shift/close
-- - day_close: /api/v1/sync/lottery/day/prepare-close, commit-close, cancel-close
-- - variance_approval: /api/v1/sync/lottery/variances/approve
--
-- Invalid entity types (no push endpoints - pull-only or unsupported):
-- - lottery_bin: Pulled from cloud, never pushed
-- - day_summary: Calculated server-side, no push endpoint
-- - shift: Use shift_opening/shift_closing instead
-- - transaction: No push endpoint in API spec
-- - employee: Cloud-managed, pulled from cloud, never pushed
--
-- SEC-006: This is a data cleanup migration, not user-input driven
-- API-001: Enforcing valid entity type whitelist

-- Delete all unsynced items with invalid entity types
DELETE FROM sync_queue
WHERE synced = 0
  AND entity_type NOT IN ('pack', 'shift_opening', 'shift_closing', 'day_close', 'variance_approval');

-- Also delete synced items with invalid entity types for cleanup
-- These would have been marked as synced erroneously or are orphaned data
DELETE FROM sync_queue
WHERE entity_type NOT IN ('pack', 'shift_opening', 'shift_closing', 'day_close', 'variance_approval');
