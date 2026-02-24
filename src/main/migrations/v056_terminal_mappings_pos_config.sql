-- Migration v055: Add POS Connection Configuration to Terminal Mappings
--
-- CORRECTION: This migration adds POS connection config to pos_terminal_mappings table,
-- NOT the stores table. Each terminal can have its own connection configuration.
--
-- Columns Added:
--   - pos_type: Enterprise POS system type enum (GILBARCO_NAXML, SQUARE_REST, etc.)
--   - connection_type: Connection method (FILE, API, NETWORK, WEBHOOK, MANUAL)
--   - connection_config: JSON configuration specific to connection type
--
-- NOTE: The existing `pos_system_type` column ('gilbarco', 'verifone', etc.) is retained
-- for backward compatibility with POS data parsing. The new `pos_type` column uses
-- the enterprise enum values that match the cloud schema.
--
-- Security Compliance:
--   - SEC-006: All queries use parameterized statements (enforced at DAL layer)
--   - DB-006: Table already has store_id FK for tenant isolation
--   - API-001: Values validated via Zod schemas before persistence
--   - DB-002: CHECK constraints enforce valid enum values at database level
--
-- Reference: Cloud schema prisma/schema.prisma POSTerminal model (lines 1391-1421)
--
-- @version 055
-- @date 2026-02-18

-- ============================================================================
-- Add POS Configuration Columns to pos_terminal_mappings
-- ============================================================================

-- POS System Type (Enterprise Enum) - identifies the POS vendor/protocol
-- This is the enterprise-grade enum that matches the cloud POSTerminal.pos_type
-- NULL indicates not yet configured or using legacy pos_system_type only
-- Valid values enforced via CHECK constraint (matches POSSystemTypeSchema)
ALTER TABLE pos_terminal_mappings ADD COLUMN pos_type TEXT CHECK(
    pos_type IS NULL OR pos_type IN (
        'GILBARCO_PASSPORT',
        'GILBARCO_NAXML',
        'VERIFONE_RUBY2',
        'VERIFONE_COMMANDER',
        'SQUARE_REST',
        'CLOVER_REST',
        'NCR_RADIANT',
        'INFOR_POS',
        'ORACLE_SIMPHONY',
        'CUSTOM_API',
        'FILE_BASED',
        'MANUAL',
        'MANUAL_ENTRY',
        'LOTTERY',
        'UNKNOWN'
    )
);

-- Connection Type - how the desktop app connects to this terminal/POS
-- NULL indicates not yet configured (defaults to MANUAL behavior)
-- Valid values enforced via CHECK constraint (matches POSConnectionTypeSchema)
ALTER TABLE pos_terminal_mappings ADD COLUMN connection_type TEXT CHECK(
    connection_type IS NULL OR connection_type IN (
        'NETWORK',
        'API',
        'WEBHOOK',
        'FILE',
        'MANUAL'
    )
);

-- Connection Configuration - JSON string with connection-specific settings
-- Structure depends on connection_type:
--   FILE: { "import_path": "...", "file_pattern": "*.xml", "poll_interval_seconds": 60 }
--   API: { "base_url": "https://...", "api_key": "...", "location_id": "..." }
--   NETWORK: { "host": "192.168.1.100", "port": 5000, "timeout_ms": 30000 }
--   WEBHOOK: { "webhook_secret": "...", "expected_source_ips": [...] }
--   MANUAL: NULL (no configuration needed)
-- NULL is valid and expected for MANUAL connection type
ALTER TABLE pos_terminal_mappings ADD COLUMN connection_config TEXT;

-- ============================================================================
-- Index for connection type queries
-- Supports queries like "find all FILE-based terminals for a store"
-- Uses covering index pattern for optimal performance
-- ============================================================================
CREATE INDEX idx_pos_terminal_connection_type ON pos_terminal_mappings(store_id, connection_type)
    WHERE connection_type IS NOT NULL;
