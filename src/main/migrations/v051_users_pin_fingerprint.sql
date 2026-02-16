-- ============================================================================
-- Migration: v051_users_pin_fingerprint
-- Description: Add SHA-256 PIN fingerprint column for cloud PIN uniqueness validation
--
-- Purpose:
--   The cloud requires SHA-256(plain_pin) for duplicate PIN detection.
--   This fingerprint is computed BEFORE bcrypt hashing and stored separately.
--   - pin_hash: bcrypt hash for secure authentication (different each time)
--   - sha256_pin_fingerprint: SHA-256 of plain PIN for uniqueness (deterministic)
--
-- Security:
--   SEC-001: bcrypt remains the authentication mechanism
--   DB-006: Fingerprint enables store-scoped PIN uniqueness in cloud
--
-- Note:
--   Existing users will have NULL fingerprints after migration.
--   They will get fingerprints when their PIN is updated, or recreate them.
--   New users created after this migration will have fingerprints automatically.
-- ============================================================================

-- Add SHA-256 PIN fingerprint column
-- 64 characters = SHA-256 hex digest length
ALTER TABLE users ADD COLUMN sha256_pin_fingerprint TEXT;

-- Index for efficient lookups during PIN uniqueness validation
CREATE INDEX idx_users_pin_fingerprint ON users(store_id, sha256_pin_fingerprint);
