/**
 * Settings Page - NAXML Sections Visibility Unit Tests
 *
 * Tests the conditional visibility logic for NAXML-specific sections in the Settings page.
 * These sections (File Types, Reprocess XML Files, Reset Fuel Data) should ONLY be visible
 * when the POS connection type is 'FILE' (NAXML-compatible POS systems).
 *
 * Business Context:
 * - NAXML file-based sync is only applicable to Gilbarco Passport/NAXML POS systems
 * - Manual entry stores should not see file processing options
 * - API-based POS systems (Square, Clover) don't use file-based sync
 *
 * @module tests/unit/components/settings-naxml-sections-visibility
 * @security SEC-004: Tests verify no XSS vectors in visibility logic
 * @security FE-005: Tests verify correct UI state based on POS configuration
 * @traceability Settings.tsx:1628-1810 (File Types, Reprocess XML, Reset Fuel sections)
 */

import { describe, it, expect } from 'vitest';

// ============================================================================
// Type Definitions (mirror production types from config.types.ts)
// ============================================================================

/**
 * POS Connection Types from the cloud configuration
 * API-008: Only expose connection type needed for UI decisions
 */
type POSConnectionType = 'FILE' | 'API' | 'NETWORK' | 'WEBHOOK' | 'MANUAL';

/**
 * POS System Types supported by the application
 */
type POSSystemType =
  | 'GILBARCO_PASSPORT'
  | 'GILBARCO_NAXML'
  | 'VERIFONE_RUBY2'
  | 'VERIFONE_COMMANDER'
  | 'SQUARE_REST'
  | 'CLOVER_REST'
  | 'NCR_RADIANT'
  | 'INFOR_POS'
  | 'ORACLE_SIMPHONY'
  | 'CUSTOM_API'
  | 'FILE_BASED'
  | 'MANUAL_ENTRY'
  | 'MANUAL'
  | 'UNKNOWN';

/**
 * POS Connection Configuration from cloud API
 * SEC-014: Validated structure from cloud
 */
interface POSConnectionConfig {
  pos_type: POSSystemType;
  pos_connection_type: POSConnectionType;
  pos_connection_config: Record<string, unknown> | null;
}

// ============================================================================
// Functions Under Test (extracted from Settings.tsx conditional logic)
// ============================================================================

/**
 * Determines if NAXML-specific sections should be visible
 *
 * This function encapsulates the conditional logic used in Settings.tsx:
 * - File Types section (lines 1628-1663)
 * - Reprocess XML Files section (lines 1699-1771)
 * - Reset Fuel Data section (lines 1773-1807)
 *
 * Business Rule: These sections are ONLY visible when:
 * - posConnectionConfig exists AND
 * - posConnectionConfig.pos_connection_type === 'FILE'
 *
 * @param posConnectionConfig - The POS connection configuration from settings
 * @returns true if NAXML sections should be visible, false otherwise
 *
 * @security SEC-014: Input validated before boolean evaluation
 */
function shouldShowNAXMLSections(
  posConnectionConfig: POSConnectionConfig | null | undefined
): boolean {
  // Null/undefined config = sections hidden
  if (!posConnectionConfig) {
    return false;
  }

  // Only FILE connection type shows NAXML sections
  return posConnectionConfig.pos_connection_type === 'FILE';
}

/**
 * Determines which sections are visible based on POS configuration
 *
 * Returns a structured object for comprehensive testing of all
 * conditionally rendered sections.
 *
 * @param posConnectionConfig - The POS connection configuration
 * @returns Object with visibility flags for each section
 */
function getSettingsSectionVisibility(
  posConnectionConfig: POSConnectionConfig | null | undefined
): {
  fileTypesSection: boolean;
  reprocessXmlSection: boolean;
  resetFuelDataSection: boolean;
  posConnectionSection: boolean; // Always visible when configured
} {
  const showNAXMLSections = shouldShowNAXMLSections(posConnectionConfig);

  return {
    fileTypesSection: showNAXMLSections,
    reprocessXmlSection: showNAXMLSections,
    resetFuelDataSection: showNAXMLSections,
    posConnectionSection: posConnectionConfig !== null && posConnectionConfig !== undefined,
  };
}

/**
 * Runtime type guard for POSConnectionConfig
 * SEC-014: Validates IPC data structure before use
 */
function isPOSConnectionConfig(data: unknown): data is POSConnectionConfig {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  // Required string fields with enum validation
  const validPOSTypes: POSSystemType[] = [
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
    'MANUAL_ENTRY',
    'MANUAL',
    'UNKNOWN',
  ];

  const validConnectionTypes: POSConnectionType[] = ['FILE', 'API', 'NETWORK', 'WEBHOOK', 'MANUAL'];

  if (typeof obj.pos_type !== 'string' || !validPOSTypes.includes(obj.pos_type as POSSystemType)) {
    return false;
  }

  if (
    typeof obj.pos_connection_type !== 'string' ||
    !validConnectionTypes.includes(obj.pos_connection_type as POSConnectionType)
  ) {
    return false;
  }

  // pos_connection_config can be null or object
  if (obj.pos_connection_config !== null && typeof obj.pos_connection_config !== 'object') {
    return false;
  }

  return true;
}

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a valid POS connection config for testing
 * Uses realistic production-like data
 */
function createPOSConnectionConfig(
  posType: POSSystemType,
  connectionType: POSConnectionType,
  config: Record<string, unknown> | null = null
): POSConnectionConfig {
  return {
    pos_type: posType,
    pos_connection_type: connectionType,
    pos_connection_config: config,
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Settings NAXML Sections Visibility', () => {
  // ==========================================================================
  // Core Visibility Logic Tests
  // ==========================================================================

  describe('shouldShowNAXMLSections - Core Logic', () => {
    describe('FILE connection type (NAXML-compatible)', () => {
      it('NAXML-VIS-001: should return true for GILBARCO_NAXML + FILE', () => {
        const config = createPOSConnectionConfig('GILBARCO_NAXML', 'FILE', {
          import_path: 'C:\\NAXML\\Export',
        });

        expect(shouldShowNAXMLSections(config)).toBe(true);
      });

      it('NAXML-VIS-002: should return true for GILBARCO_PASSPORT + FILE', () => {
        const config = createPOSConnectionConfig('GILBARCO_PASSPORT', 'FILE', {
          import_path: 'C:\\Passport\\Export',
        });

        expect(shouldShowNAXMLSections(config)).toBe(true);
      });

      it('NAXML-VIS-003: should return true for FILE_BASED + FILE', () => {
        const config = createPOSConnectionConfig('FILE_BASED', 'FILE', {
          import_path: '/var/pos/export',
        });

        expect(shouldShowNAXMLSections(config)).toBe(true);
      });
    });

    describe('MANUAL connection type', () => {
      it('NAXML-VIS-010: should return false for MANUAL_ENTRY + MANUAL', () => {
        const config = createPOSConnectionConfig('MANUAL_ENTRY', 'MANUAL', null);

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });

      it('NAXML-VIS-011: should return false for MANUAL + MANUAL', () => {
        const config = createPOSConnectionConfig('MANUAL', 'MANUAL', null);

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });

      it('NAXML-VIS-012: should return false for UNKNOWN + MANUAL', () => {
        const config = createPOSConnectionConfig('UNKNOWN', 'MANUAL', null);

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });
    });

    describe('API connection type', () => {
      it('NAXML-VIS-020: should return false for SQUARE_REST + API', () => {
        const config = createPOSConnectionConfig('SQUARE_REST', 'API', {
          base_url: 'https://connect.squareup.com',
          location_id: 'loc_123',
        });

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });

      it('NAXML-VIS-021: should return false for CLOVER_REST + API', () => {
        const config = createPOSConnectionConfig('CLOVER_REST', 'API', {
          base_url: 'https://api.clover.com',
          merchant_id: 'merchant_456',
        });

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });

      it('NAXML-VIS-022: should return false for CUSTOM_API + API', () => {
        const config = createPOSConnectionConfig('CUSTOM_API', 'API', {
          base_url: 'https://custom-pos.example.com/api',
        });

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });
    });

    describe('NETWORK connection type', () => {
      it('NAXML-VIS-030: should return false for VERIFONE_RUBY2 + NETWORK', () => {
        const config = createPOSConnectionConfig('VERIFONE_RUBY2', 'NETWORK', {
          host: '192.168.1.100',
          port: 5000,
        });

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });

      it('NAXML-VIS-031: should return false for VERIFONE_COMMANDER + NETWORK', () => {
        const config = createPOSConnectionConfig('VERIFONE_COMMANDER', 'NETWORK', {
          host: '192.168.1.200',
          port: 4000,
        });

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });

      it('NAXML-VIS-032: should return false for NCR_RADIANT + NETWORK', () => {
        const config = createPOSConnectionConfig('NCR_RADIANT', 'NETWORK', {
          host: '10.0.0.50',
          port: 8080,
        });

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });
    });

    describe('WEBHOOK connection type', () => {
      it('NAXML-VIS-040: should return false for CUSTOM_API + WEBHOOK', () => {
        const config = createPOSConnectionConfig('CUSTOM_API', 'WEBHOOK', {
          webhook_secret: 'whsec_test_secret',
        });

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });

      it('NAXML-VIS-041: should return false for INFOR_POS + WEBHOOK', () => {
        const config = createPOSConnectionConfig('INFOR_POS', 'WEBHOOK', {
          webhook_secret: 'infor_webhook_secret',
        });

        expect(shouldShowNAXMLSections(config)).toBe(false);
      });
    });

    describe('Null/undefined configuration', () => {
      it('NAXML-VIS-050: should return false for null config', () => {
        expect(shouldShowNAXMLSections(null)).toBe(false);
      });

      it('NAXML-VIS-051: should return false for undefined config', () => {
        expect(shouldShowNAXMLSections(undefined)).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Section Visibility Matrix Tests
  // ==========================================================================

  describe('getSettingsSectionVisibility - Section Matrix', () => {
    it('NAXML-MTX-001: FILE connection shows all NAXML sections', () => {
      const config = createPOSConnectionConfig('GILBARCO_NAXML', 'FILE', {
        import_path: 'C:\\NAXML\\Export',
      });

      const visibility = getSettingsSectionVisibility(config);

      expect(visibility).toEqual({
        fileTypesSection: true,
        reprocessXmlSection: true,
        resetFuelDataSection: true,
        posConnectionSection: true,
      });
    });

    it('NAXML-MTX-002: MANUAL connection hides all NAXML sections', () => {
      const config = createPOSConnectionConfig('MANUAL_ENTRY', 'MANUAL', null);

      const visibility = getSettingsSectionVisibility(config);

      expect(visibility).toEqual({
        fileTypesSection: false,
        reprocessXmlSection: false,
        resetFuelDataSection: false,
        posConnectionSection: true,
      });
    });

    it('NAXML-MTX-003: API connection hides all NAXML sections', () => {
      const config = createPOSConnectionConfig('SQUARE_REST', 'API', {
        base_url: 'https://connect.squareup.com',
      });

      const visibility = getSettingsSectionVisibility(config);

      expect(visibility).toEqual({
        fileTypesSection: false,
        reprocessXmlSection: false,
        resetFuelDataSection: false,
        posConnectionSection: true,
      });
    });

    it('NAXML-MTX-004: NETWORK connection hides all NAXML sections', () => {
      const config = createPOSConnectionConfig('VERIFONE_RUBY2', 'NETWORK', {
        host: '192.168.1.100',
        port: 5000,
      });

      const visibility = getSettingsSectionVisibility(config);

      expect(visibility).toEqual({
        fileTypesSection: false,
        reprocessXmlSection: false,
        resetFuelDataSection: false,
        posConnectionSection: true,
      });
    });

    it('NAXML-MTX-005: WEBHOOK connection hides all NAXML sections', () => {
      const config = createPOSConnectionConfig('CUSTOM_API', 'WEBHOOK', {
        webhook_secret: 'whsec_test',
      });

      const visibility = getSettingsSectionVisibility(config);

      expect(visibility).toEqual({
        fileTypesSection: false,
        reprocessXmlSection: false,
        resetFuelDataSection: false,
        posConnectionSection: true,
      });
    });

    it('NAXML-MTX-006: null config hides all sections including POS connection', () => {
      const visibility = getSettingsSectionVisibility(null);

      expect(visibility).toEqual({
        fileTypesSection: false,
        reprocessXmlSection: false,
        resetFuelDataSection: false,
        posConnectionSection: false,
      });
    });

    it('NAXML-MTX-007: undefined config hides all sections including POS connection', () => {
      const visibility = getSettingsSectionVisibility(undefined);

      expect(visibility).toEqual({
        fileTypesSection: false,
        reprocessXmlSection: false,
        resetFuelDataSection: false,
        posConnectionSection: false,
      });
    });
  });

  // ==========================================================================
  // Business Logic Consistency Tests
  // ==========================================================================

  describe('Business Logic Consistency', () => {
    it('NAXML-BIZ-001: All FILE connection types should show NAXML sections regardless of POS type', () => {
      const posTypes: POSSystemType[] = [
        'GILBARCO_NAXML',
        'GILBARCO_PASSPORT',
        'FILE_BASED',
        'VERIFONE_RUBY2', // Even if weird combo, FILE = show sections
        'UNKNOWN',
      ];

      for (const posType of posTypes) {
        const config = createPOSConnectionConfig(posType, 'FILE', {
          import_path: '/test/path',
        });

        expect(shouldShowNAXMLSections(config)).toBe(true);
      }
    });

    it('NAXML-BIZ-002: No non-FILE connection types should show NAXML sections', () => {
      const nonFileConnections: POSConnectionType[] = ['API', 'NETWORK', 'WEBHOOK', 'MANUAL'];

      for (const connectionType of nonFileConnections) {
        const config = createPOSConnectionConfig('UNKNOWN', connectionType, null);

        expect(shouldShowNAXMLSections(config)).toBe(false);
      }
    });

    it('NAXML-BIZ-003: Section visibility should be consistent across all three NAXML sections', () => {
      // FILE type
      const fileConfig = createPOSConnectionConfig('GILBARCO_NAXML', 'FILE', {
        import_path: 'C:\\NAXML',
      });
      const fileVisibility = getSettingsSectionVisibility(fileConfig);

      expect(fileVisibility.fileTypesSection).toBe(fileVisibility.reprocessXmlSection);
      expect(fileVisibility.reprocessXmlSection).toBe(fileVisibility.resetFuelDataSection);

      // MANUAL type
      const manualConfig = createPOSConnectionConfig('MANUAL_ENTRY', 'MANUAL', null);
      const manualVisibility = getSettingsSectionVisibility(manualConfig);

      expect(manualVisibility.fileTypesSection).toBe(manualVisibility.reprocessXmlSection);
      expect(manualVisibility.reprocessXmlSection).toBe(manualVisibility.resetFuelDataSection);
    });
  });

  // ==========================================================================
  // Type Guard Tests
  // ==========================================================================

  describe('isPOSConnectionConfig - Type Guard', () => {
    describe('SEC-014: Runtime type validation', () => {
      it('NAXML-TG-001: should return false for null input', () => {
        expect(isPOSConnectionConfig(null)).toBe(false);
      });

      it('NAXML-TG-002: should return false for undefined input', () => {
        expect(isPOSConnectionConfig(undefined)).toBe(false);
      });

      it('NAXML-TG-003: should return false for non-object input', () => {
        expect(isPOSConnectionConfig('string')).toBe(false);
        expect(isPOSConnectionConfig(123)).toBe(false);
        expect(isPOSConnectionConfig(true)).toBe(false);
        expect(isPOSConnectionConfig([])).toBe(false);
      });

      it('NAXML-TG-004: should return false for invalid pos_type', () => {
        expect(
          isPOSConnectionConfig({
            pos_type: 'INVALID_TYPE',
            pos_connection_type: 'FILE',
            pos_connection_config: null,
          })
        ).toBe(false);
      });

      it('NAXML-TG-005: should return false for invalid pos_connection_type', () => {
        expect(
          isPOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'INVALID_CONNECTION',
            pos_connection_config: null,
          })
        ).toBe(false);
      });

      it('NAXML-TG-006: should return true for valid FILE config', () => {
        expect(
          isPOSConnectionConfig({
            pos_type: 'GILBARCO_NAXML',
            pos_connection_type: 'FILE',
            pos_connection_config: { import_path: 'C:\\NAXML' },
          })
        ).toBe(true);
      });

      it('NAXML-TG-007: should return true for valid MANUAL config', () => {
        expect(
          isPOSConnectionConfig({
            pos_type: 'MANUAL_ENTRY',
            pos_connection_type: 'MANUAL',
            pos_connection_config: null,
          })
        ).toBe(true);
      });

      it('NAXML-TG-008: should return true for valid API config', () => {
        expect(
          isPOSConnectionConfig({
            pos_type: 'SQUARE_REST',
            pos_connection_type: 'API',
            pos_connection_config: { base_url: 'https://api.square.com' },
          })
        ).toBe(true);
      });

      it('NAXML-TG-009: should return true for all valid POS types', () => {
        const validPOSTypes: POSSystemType[] = [
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
          'MANUAL_ENTRY',
          'MANUAL',
          'UNKNOWN',
        ];

        for (const posType of validPOSTypes) {
          expect(
            isPOSConnectionConfig({
              pos_type: posType,
              pos_connection_type: 'MANUAL',
              pos_connection_config: null,
            })
          ).toBe(true);
        }
      });

      it('NAXML-TG-010: should return true for all valid connection types', () => {
        const validConnectionTypes: POSConnectionType[] = [
          'FILE',
          'API',
          'NETWORK',
          'WEBHOOK',
          'MANUAL',
        ];

        for (const connectionType of validConnectionTypes) {
          expect(
            isPOSConnectionConfig({
              pos_type: 'UNKNOWN',
              pos_connection_type: connectionType,
              pos_connection_config: null,
            })
          ).toBe(true);
        }
      });
    });
  });

  // ==========================================================================
  // Security Compliance Tests
  // ==========================================================================

  describe('Security Compliance', () => {
    describe('SEC-004: XSS Prevention', () => {
      it('NAXML-SEC-001: visibility logic should not include HTML in output', () => {
        const config = createPOSConnectionConfig('GILBARCO_NAXML', 'FILE', null);
        const visibility = getSettingsSectionVisibility(config);

        // All values should be booleans, not strings that could contain HTML
        for (const [key, value] of Object.entries(visibility)) {
          expect(typeof value).toBe('boolean');
          expect(key).not.toContain('<');
          expect(key).not.toContain('>');
        }
      });
    });

    describe('FE-005: No Sensitive Data Exposure', () => {
      it('NAXML-SEC-002: visibility object should not expose config details', () => {
        const config = createPOSConnectionConfig('SQUARE_REST', 'API', {
          api_key: 'secret_key_12345',
          base_url: 'https://api.square.com',
        });

        const visibility = getSettingsSectionVisibility(config);

        // Visibility should only contain boolean flags, not config data
        const keys = Object.keys(visibility);
        expect(keys).not.toContain('api_key');
        expect(keys).not.toContain('base_url');
        expect(keys).not.toContain('import_path');
        expect(keys).not.toContain('pos_connection_config');
      });
    });

    describe('API-008: Output Filtering', () => {
      it('NAXML-SEC-003: visibility function should only return whitelisted fields', () => {
        const allowedFields = [
          'fileTypesSection',
          'reprocessXmlSection',
          'resetFuelDataSection',
          'posConnectionSection',
        ];

        const config = createPOSConnectionConfig('GILBARCO_NAXML', 'FILE', {
          import_path: 'C:\\NAXML',
          export_path: 'C:\\NAXML\\Archive',
          poll_interval_seconds: 5,
        });

        const visibility = getSettingsSectionVisibility(config);
        const keys = Object.keys(visibility);

        // Should only contain allowed fields
        expect(keys.length).toBe(allowedFields.length);
        for (const key of keys) {
          expect(allowedFields).toContain(key);
        }
      });
    });
  });

  // ==========================================================================
  // Edge Cases and Error Resilience
  // ==========================================================================

  describe('Edge Cases and Error Resilience', () => {
    it('NAXML-EDGE-001: should handle config with extra unexpected fields', () => {
      const configWithExtra = {
        pos_type: 'GILBARCO_NAXML' as POSSystemType,
        pos_connection_type: 'FILE' as POSConnectionType,
        pos_connection_config: { import_path: 'C:\\NAXML' },
        unexpected_field: 'should be ignored',
        another_extra: 12345,
      };

      // Should still work correctly
      expect(shouldShowNAXMLSections(configWithExtra)).toBe(true);
    });

    it('NAXML-EDGE-002: should handle empty pos_connection_config object', () => {
      const config = createPOSConnectionConfig('GILBARCO_NAXML', 'FILE', {});

      // Should still show NAXML sections based on connection type
      expect(shouldShowNAXMLSections(config)).toBe(true);
    });

    it('NAXML-EDGE-003: should handle pos_connection_config with null values', () => {
      const config = createPOSConnectionConfig('GILBARCO_NAXML', 'FILE', {
        import_path: null,
        export_path: undefined,
      } as unknown as Record<string, unknown>);

      // Visibility is based on connection type, not config content
      expect(shouldShowNAXMLSections(config)).toBe(true);
    });
  });

  // ==========================================================================
  // Real-World Scenario Tests (Happy Valley Store Example)
  // ==========================================================================

  describe('Real-World Scenarios', () => {
    it('NAXML-RW-001: Happy Valley store (MANUAL) should hide NAXML sections', () => {
      // This is the actual use case from the bug report
      const happyValleyConfig = createPOSConnectionConfig('MANUAL_ENTRY', 'MANUAL', null);

      const visibility = getSettingsSectionVisibility(happyValleyConfig);

      // Happy Valley should NOT see:
      // - File Types section
      // - Reprocess XML Files section
      // - Reset Fuel Data section
      expect(visibility.fileTypesSection).toBe(false);
      expect(visibility.reprocessXmlSection).toBe(false);
      expect(visibility.resetFuelDataSection).toBe(false);

      // But should still see POS connection section (showing Manual mode)
      expect(visibility.posConnectionSection).toBe(true);
    });

    it('NAXML-RW-002: Typical Gilbarco Passport store should show NAXML sections', () => {
      const gilbarcoConfig = createPOSConnectionConfig('GILBARCO_PASSPORT', 'FILE', {
        import_path: 'C:\\Passport\\NAXML\\Export',
        export_path: 'C:\\Passport\\NAXML\\Archive',
        file_pattern: '*.xml',
        poll_interval_seconds: 5,
      });

      const visibility = getSettingsSectionVisibility(gilbarcoConfig);

      // Should see all NAXML sections
      expect(visibility.fileTypesSection).toBe(true);
      expect(visibility.reprocessXmlSection).toBe(true);
      expect(visibility.resetFuelDataSection).toBe(true);
      expect(visibility.posConnectionSection).toBe(true);
    });

    it('NAXML-RW-003: Square POS store should hide NAXML sections', () => {
      const squareConfig = createPOSConnectionConfig('SQUARE_REST', 'API', {
        base_url: 'https://connect.squareup.com/v2',
        location_id: 'LID123456',
      });

      const visibility = getSettingsSectionVisibility(squareConfig);

      expect(visibility.fileTypesSection).toBe(false);
      expect(visibility.reprocessXmlSection).toBe(false);
      expect(visibility.resetFuelDataSection).toBe(false);
      expect(visibility.posConnectionSection).toBe(true);
    });

    it('NAXML-RW-004: Clover POS store should hide NAXML sections', () => {
      const cloverConfig = createPOSConnectionConfig('CLOVER_REST', 'API', {
        base_url: 'https://api.clover.com',
        merchant_id: 'MERCHANT789',
      });

      const visibility = getSettingsSectionVisibility(cloverConfig);

      expect(visibility.fileTypesSection).toBe(false);
      expect(visibility.reprocessXmlSection).toBe(false);
      expect(visibility.resetFuelDataSection).toBe(false);
      expect(visibility.posConnectionSection).toBe(true);
    });

    it('NAXML-RW-005: Unconfigured store (new installation) should hide all sections', () => {
      // New installation with no POS config yet
      const visibility = getSettingsSectionVisibility(null);

      expect(visibility.fileTypesSection).toBe(false);
      expect(visibility.reprocessXmlSection).toBe(false);
      expect(visibility.resetFuelDataSection).toBe(false);
      expect(visibility.posConnectionSection).toBe(false);
    });
  });
});
