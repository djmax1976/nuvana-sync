-- Migration v054: Shift Receipt Images Table
--
-- Creates storage for payout receipt images captured during shift/day close.
-- Images are associated with shifts and used in View pages (PayoutModal).
--
-- Document Types:
--   - CASH_PAYOUT: Receipt for individual cash payout
--   - LOTTERY_REPORT: Scanned lottery terminal report
--   - GAMING_REPORT: Scanned gaming machine report
--
-- Security Compliance:
--   - SEC-006: All queries use parameterized statements
--   - DB-006: Tenant isolation via store_id on all records
--   - DB-007: Encryption at rest via SQLCipher
--   - CDP-001: SHA-256 hash for integrity and deduplication
--
-- @version 054
-- @date 2026-02-17

-- ============================================================================
-- Create shift_receipt_images table
-- ============================================================================
-- Stores metadata about images uploaded during shift close.
-- Actual image files stored at: userData/images/{store_id}/{shift_id}/{image_hash}.{ext}

CREATE TABLE IF NOT EXISTS shift_receipt_images (
    -- Primary identifier
    id TEXT PRIMARY KEY NOT NULL,

    -- Foreign key to shifts table (image belongs to this shift)
    shift_id TEXT NOT NULL,

    -- DB-006: Tenant isolation - store_id required for all queries
    store_id TEXT NOT NULL,

    -- CDP-001: SHA-256 hash of image bytes for integrity and deduplication
    image_hash TEXT NOT NULL,

    -- Original filename from user upload
    file_name TEXT NOT NULL,

    -- File size in bytes (for validation and display)
    file_size INTEGER NOT NULL CHECK(file_size > 0 AND file_size <= 10485760),

    -- MIME type (validated: image/jpeg, image/png, image/webp)
    mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg', 'image/png', 'image/webp')),

    -- Document type categorization
    document_type TEXT NOT NULL CHECK(document_type IN ('CASH_PAYOUT', 'LOTTERY_REPORT', 'GAMING_REPORT')),

    -- For CASH_PAYOUT: optional reference to specific payout entry
    payout_index INTEGER,

    -- When the image was uploaded (ISO 8601)
    uploaded_at TEXT NOT NULL,

    -- Standard timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- Foreign key constraint (shift must exist)
    FOREIGN KEY (shift_id) REFERENCES shifts(shift_id) ON DELETE CASCADE,

    -- Ensure tenant isolation at database level
    FOREIGN KEY (store_id) REFERENCES stores(store_id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Primary query pattern: Get all images for a shift
CREATE INDEX IF NOT EXISTS idx_receipt_images_shift
ON shift_receipt_images(shift_id);

-- DB-006: Tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_receipt_images_store
ON shift_receipt_images(store_id);

-- Deduplication: Check if image already exists
CREATE INDEX IF NOT EXISTS idx_receipt_images_hash
ON shift_receipt_images(store_id, shift_id, image_hash);

-- Query by document type
CREATE INDEX IF NOT EXISTS idx_receipt_images_type
ON shift_receipt_images(store_id, shift_id, document_type);

-- ============================================================================
-- Unique Constraints
-- ============================================================================

-- Prevent duplicate uploads of same image for same shift
CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_images_unique
ON shift_receipt_images(store_id, shift_id, image_hash);

-- For LOTTERY_REPORT and GAMING_REPORT, only one per shift
-- (handled in application logic since SQLite doesn't support partial unique indexes easily)
