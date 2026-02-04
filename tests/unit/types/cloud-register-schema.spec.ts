/**
 * CloudRegister Schema Validation Unit Tests
 *
 * Validates CloudRegisterSchema and the updated POSConnectionConfigSchema
 * for MANUAL mode register definitions from cloud POS configuration.
 *
 * @module tests/unit/types/cloud-register-schema.spec
 *
 * Security Compliance:
 * - SEC-014: Input validation via Zod schema
 * - SEC-006: SQL injection payloads handled safely at DAL layer (not schema)
 *
 * Test Coverage:
 * - 6.1.1 through 6.1.15 per Phase 6 test plan
 */

import { describe, it, expect } from 'vitest';
import {
  CloudRegisterSchema,
  POSConnectionConfigSchema,
  validatePOSConnectionConfig,
} from '../../../src/shared/types/config.types';

describe('CloudRegisterSchema', () => {
  // ========================================================================
  // 6.1.1 - Accepts valid register with all fields
  // ========================================================================
  it('6.1.1: should accept valid register with all fields', () => {
    const input = {
      external_register_id: '1',
      terminal_type: 'REGISTER',
      description: 'Front Counter',
      active: true,
    };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.external_register_id).toBe('1');
      expect(result.data.terminal_type).toBe('REGISTER');
      expect(result.data.description).toBe('Front Counter');
      expect(result.data.active).toBe(true);
    }
  });

  // ========================================================================
  // 6.1.2 - Applies defaults for optional fields
  // ========================================================================
  it('6.1.2: should apply defaults for optional fields', () => {
    const input = { external_register_id: '1' };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.terminal_type).toBe('REGISTER');
      expect(result.data.description).toBeNull();
      expect(result.data.active).toBe(true);
    }
  });

  // ========================================================================
  // 6.1.3 - Rejects empty external_register_id
  // ========================================================================
  it('6.1.3: should reject empty external_register_id', () => {
    const input = { external_register_id: '' };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('external_register_id');
    }
  });

  // ========================================================================
  // 6.1.4 - Rejects missing external_register_id
  // ========================================================================
  it('6.1.4: should reject missing external_register_id', () => {
    const input = {};

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  // ========================================================================
  // 6.1.5 - Rejects external_register_id exceeding 50 characters
  // ========================================================================
  it('6.1.5: should reject external_register_id exceeding 50 characters', () => {
    const input = { external_register_id: 'A'.repeat(51) };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  // ========================================================================
  // 6.1.20 - Accepts external_register_id at max boundary (exactly 50 chars)
  // ========================================================================
  it('6.1.20: should accept external_register_id at exactly 50 characters', () => {
    const input = { external_register_id: 'A'.repeat(50) };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.external_register_id).toHaveLength(50);
    }
  });

  // ========================================================================
  // 6.1.6 - Rejects invalid terminal_type value
  // ========================================================================
  it('6.1.6: should reject invalid terminal_type value', () => {
    const input = { external_register_id: '1', terminal_type: 'INVALID_TYPE' };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('terminal_type');
    }
  });

  // ========================================================================
  // 6.1.7 - Accepts all valid terminal_type values
  // ========================================================================
  it('6.1.7: should accept all valid terminal_type values', () => {
    const validTypes = ['REGISTER', 'FUEL_DISPENSER', 'KIOSK', 'MOBILE'] as const;

    for (const terminalType of validTypes) {
      const input = { external_register_id: '1', terminal_type: terminalType };
      const result = CloudRegisterSchema.safeParse(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.terminal_type).toBe(terminalType);
      }
    }
  });

  // ========================================================================
  // 6.1.8 - Rejects description exceeding 255 characters
  // ========================================================================
  it('6.1.8: should reject description exceeding 255 characters', () => {
    const input = { external_register_id: '1', description: 'A'.repeat(256) };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  // ========================================================================
  // 6.1.9 - Accepts null description
  // ========================================================================
  it('6.1.9: should accept null description', () => {
    const input = { external_register_id: '1', description: null };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  // ========================================================================
  // 6.1.10 - Rejects non-boolean active field
  // ========================================================================
  it('6.1.10: should reject non-boolean active field', () => {
    const input = { external_register_id: '1', active: 'yes' };

    const result = CloudRegisterSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  // ========================================================================
  // 6.1.14 - SQL injection payload in external_register_id
  // SEC-006: SQL injection prevention is at DAL layer, not schema layer
  // ========================================================================
  it('6.1.14: should accept SQL injection payload in external_register_id (SEC-006: parameterized at DAL)', () => {
    const input = { external_register_id: "'; DROP TABLE users;--" };

    const result = CloudRegisterSchema.safeParse(input);

    // Schema validates length/format only - SQL injection is prevented by parameterized queries
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.external_register_id).toBe("'; DROP TABLE users;--");
    }
  });

  // ========================================================================
  // 6.1.15 - Script tags in description
  // XSS prevention is at rendering layer, not schema layer
  // ========================================================================
  it('6.1.15: should accept script tags in description (XSS prevention at rendering layer)', () => {
    const input = {
      external_register_id: '1',
      description: "<script>alert('xss')</script>",
    };

    const result = CloudRegisterSchema.safeParse(input);

    // Length is valid (< 255), stored safely. XSS prevention is at rendering layer
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("<script>alert('xss')</script>");
    }
  });
});

describe('POSConnectionConfigSchema (MANUAL mode backwards compatibility)', () => {
  // ========================================================================
  // 6.1.11 - Accepts null for MANUAL mode (backwards compatible)
  // ========================================================================
  it('6.1.11: should accept null pos_connection_config for MANUAL mode', () => {
    const input = {
      pos_type: 'MANUAL_ENTRY',
      pos_connection_type: 'MANUAL',
      pos_connection_config: null,
    };

    const result = POSConnectionConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
  });

  // ========================================================================
  // 6.1.12 - Accepts register object for MANUAL mode
  // ========================================================================
  it('6.1.12: should accept register object for MANUAL mode', () => {
    const input = {
      pos_type: 'MANUAL_ENTRY',
      pos_connection_type: 'MANUAL',
      pos_connection_config: {
        registers: [{ external_register_id: '1' }],
      },
    };

    const result = POSConnectionConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
  });

  // ========================================================================
  // 6.1.16 - Accepts LOTTERY pos_type with null MANUAL config (backwards compatible)
  // SEC-014: LOTTERY must be in POSSystemTypeSchema allowlist
  // ========================================================================
  it('6.1.16: should accept LOTTERY pos_type with null pos_connection_config for MANUAL mode', () => {
    const input = {
      pos_type: 'LOTTERY',
      pos_connection_type: 'MANUAL',
      pos_connection_config: null,
    };

    const result = POSConnectionConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
  });

  // ========================================================================
  // 6.1.17 - Accepts LOTTERY pos_type with register definitions
  // SEC-014: Validates LOTTERY + MANUAL + registers end-to-end
  // ========================================================================
  it('6.1.17: should accept LOTTERY pos_type with register object for MANUAL mode', () => {
    const input = {
      pos_type: 'LOTTERY',
      pos_connection_type: 'MANUAL',
      pos_connection_config: {
        registers: [
          {
            external_register_id: 'f2edc2be-425f-4999-a3bb-1ca0eae35cfe',
            terminal_type: 'REGISTER',
            description: 'Lottery Terminal',
            active: true,
          },
        ],
      },
    };

    const result = POSConnectionConfigSchema.safeParse(input);

    expect(result.success).toBe(true);
  });

  // ========================================================================
  // 6.1.18 - Accepts LOTTERY pos_type via validatePOSConnectionConfig
  // API-001: Full validation function handles LOTTERY correctly
  // ========================================================================
  it('6.1.18: should accept LOTTERY pos_type through validatePOSConnectionConfig', () => {
    const input = {
      pos_type: 'LOTTERY',
      pos_connection_type: 'MANUAL',
      pos_connection_config: null,
    };

    const config = validatePOSConnectionConfig(input);

    expect(config.pos_type).toBe('LOTTERY');
    expect(config.pos_connection_type).toBe('MANUAL');
    expect(config.pos_connection_config).toBeNull();
  });

  // ========================================================================
  // 6.1.19 - Rejects LOTTERY pos_type with FILE connection type and null config
  // SEC-014: LOTTERY is logically MANUAL-only; FILE requires import_path
  // ========================================================================
  it('6.1.19: should reject LOTTERY pos_type with FILE connection type via validatePOSConnectionConfig', () => {
    const input = {
      pos_type: 'LOTTERY',
      pos_connection_type: 'FILE',
      pos_connection_config: null,
    };

    // FILE connection type requires non-null config with import_path
    expect(() => validatePOSConnectionConfig(input)).toThrow();
  });

  // ========================================================================
  // 6.1.13 - Still rejects invalid data for FILE mode
  // ========================================================================
  it('6.1.13: should reject null pos_connection_config for FILE mode via validatePOSConnectionConfig', () => {
    const input = {
      pos_type: 'GILBARCO_PASSPORT',
      pos_connection_type: 'FILE',
      pos_connection_config: null,
    };

    // Schema-level uses z.union([...]).nullable() so null passes schema parse.
    // The two-pass validatePOSConnectionConfig() enforces connection-type-specific rules.
    expect(() => validatePOSConnectionConfig(input)).toThrow();
  });
});
