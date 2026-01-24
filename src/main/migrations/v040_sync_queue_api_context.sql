-- v040_sync_queue_api_context.sql
-- Add API call context fields to sync_queue for better troubleshooting
--
-- This migration adds:
-- 1. sync_direction: PUSH (to cloud) or PULL (from cloud)
-- 2. api_endpoint: The API path that was called
-- 3. http_status: The HTTP response status code
-- 4. response_body: Truncated response body (for error diagnosis)
--
-- Security: DB-006 - Maintains store_id tenant isolation
-- Security: API-008 - Response body is truncated to avoid storing sensitive data

-- Add sync direction field (default PUSH for existing records)
ALTER TABLE sync_queue ADD COLUMN sync_direction TEXT NOT NULL DEFAULT 'PUSH' CHECK(sync_direction IN ('PUSH', 'PULL'));

-- Add API endpoint that was called
ALTER TABLE sync_queue ADD COLUMN api_endpoint TEXT;

-- Add HTTP status code from the response
ALTER TABLE sync_queue ADD COLUMN http_status INTEGER;

-- Add truncated response body for error diagnosis (max 500 chars stored)
ALTER TABLE sync_queue ADD COLUMN response_body TEXT;

-- Index for direction-based filtering in Sync Monitor
CREATE INDEX idx_sync_queue_direction ON sync_queue(store_id, sync_direction, created_at DESC);
