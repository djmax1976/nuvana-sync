/**
 * POS Terminal Mappings - POS Configuration Tests
 *
 * Tests for the POS configuration columns and methods added in v055.
 *
 * @security SEC-006: Verifies parameterized queries prevent SQL injection
 * @security DB-006: Verifies tenant isolation via store_id scoping
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-terminal-uuid-001'),
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import {
  POSTerminalMappingsDAL,
  TerminalPOSConfigurationError,
  type TerminalPOSConfigData,
  type POSTerminalMapping,
} from '../../../src/main/dal/pos-id-mappings.dal';

// ============================================================================
// Test Setup
// ============================================================================

describe('POSTerminalMappingsDAL - POS Configuration (v055)', () => {
  let dal: POSTerminalMappingsDAL;
  const storeId = 'test-store-uuid-1234';

  const mockTerminal: POSTerminalMapping = {
    id: 'mock-terminal-uuid-001',
    store_id: storeId,
    external_register_id: 'REG-001',
    terminal_type: 'REGISTER',
    description: null,
    pos_system_type: 'generic',
    active: 1,
    created_at: '2026-02-18T10:00:00.000Z',
    updated_at: '2026-02-18T10:00:00.000Z',
    pos_type: null,
    connection_type: null,
    connection_config: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new POSTerminalMappingsDAL();
  });

  // ============================================================================
  // getOrCreate with POS config
  // ============================================================================

  describe('getOrCreate', () => {
    it('should create terminal with POS config when provided', () => {
      const mockGet = vi.fn().mockReturnValue(undefined); // No existing terminal
      const mockRun = vi.fn();
      const createdTerminal = {
        ...mockTerminal,
        pos_type: 'GILBARCO_NAXML',
        connection_type: 'FILE',
        connection_config: JSON.stringify({ import_path: '/data/naxml' }),
      };
      const mockGetAfterCreate = vi.fn().mockReturnValue(createdTerminal);

      mockPrepare
        .mockReturnValueOnce({ get: mockGet }) // findByExternalId check
        .mockReturnValueOnce({ run: mockRun }) // INSERT
        .mockReturnValueOnce({ get: mockGetAfterCreate }); // findById after create

      const terminal = dal.getOrCreate(storeId, 'REG-001', {
        pos_type: 'GILBARCO_NAXML',
        connection_type: 'FILE',
        connection_config: JSON.stringify({ import_path: '/data/naxml' }),
      });

      expect(terminal.pos_type).toBe('GILBARCO_NAXML');
      expect(terminal.connection_type).toBe('FILE');
      expect(terminal.connection_config).toBe(JSON.stringify({ import_path: '/data/naxml' }));

      // Verify INSERT includes POS config columns
      const insertQuery = mockPrepare.mock.calls[1][0] as string;
      expect(insertQuery).toContain('pos_type');
      expect(insertQuery).toContain('connection_type');
      expect(insertQuery).toContain('connection_config');
    });

    it('should create terminal with NULL POS config when not provided', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      const mockRun = vi.fn();

      mockPrepare
        .mockReturnValueOnce({ get: mockGet })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockTerminal) });

      const terminal = dal.getOrCreate(storeId, 'REG-002');

      expect(terminal.pos_type).toBeNull();
      expect(terminal.connection_type).toBeNull();
      expect(terminal.connection_config).toBeNull();
    });

    it('should return existing terminal without modifying POS config', () => {
      const existingTerminal = {
        ...mockTerminal,
        pos_type: 'SQUARE_REST',
        connection_type: 'API',
      };
      const mockGet = vi.fn().mockReturnValue(existingTerminal);

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const terminal = dal.getOrCreate(storeId, 'REG-003');

      expect(terminal.pos_type).toBe('SQUARE_REST');
      expect(terminal.connection_type).toBe('API');
      // Only one prepare call (no INSERT since terminal exists)
      expect(mockPrepare).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // updatePOSConfig
  // ============================================================================

  describe('updatePOSConfig', () => {
    it('should update POS config for existing terminal', () => {
      // updatePOSConfig flow: findByIdForStore (GET) → UPDATE (RUN) → findById (GET)
      const mockGetExisting = vi.fn().mockReturnValue(mockTerminal);
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedTerminal = {
        ...mockTerminal,
        pos_type: 'GILBARCO_NAXML',
        connection_type: 'FILE',
        connection_config: JSON.stringify({ import_path: '/naxml' }),
      };
      const mockGetUpdated = vi.fn().mockReturnValue(updatedTerminal);

      mockPrepare
        .mockReturnValueOnce({ get: mockGetExisting }) // findByIdForStore
        .mockReturnValueOnce({ run: mockRun }) // UPDATE
        .mockReturnValueOnce({ get: mockGetUpdated }); // findById after update

      const posConfig: TerminalPOSConfigData = {
        pos_type: 'GILBARCO_NAXML',
        connection_type: 'FILE',
        connection_config: JSON.stringify({ import_path: '/naxml' }),
      };
      const updated = dal.updatePOSConfig(storeId, mockTerminal.id, posConfig);

      expect(updated.pos_type).toBe('GILBARCO_NAXML');
      expect(updated.connection_type).toBe('FILE');
      expect(updated.connection_config).toBe(JSON.stringify({ import_path: '/naxml' }));

      // Verify parameterized query (SEC-006)
      const updateQuery = mockPrepare.mock.calls[1][0] as string;
      expect(updateQuery).toContain('UPDATE pos_terminal_mappings');
      expect(updateQuery).toContain('pos_type = ?');
      expect(updateQuery).toContain('connection_type = ?');
      expect(updateQuery).toContain('connection_config = ?');
      expect(updateQuery).toContain('WHERE id = ? AND store_id = ?');
    });

    it('should throw TERMINAL_NOT_FOUND for non-existent terminal', () => {
      // findByIdForStore returns undefined (terminal not found)
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const posConfig: TerminalPOSConfigData = {
        pos_type: 'MANUAL_ENTRY',
        connection_type: 'MANUAL',
        connection_config: null,
      };

      expect(() => dal.updatePOSConfig(storeId, 'non-existent-id', posConfig)).toThrow(
        TerminalPOSConfigurationError
      );

      try {
        mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });
        dal.updatePOSConfig(storeId, 'non-existent-id', posConfig);
      } catch (e) {
        expect((e as TerminalPOSConfigurationError).code).toBe('TERMINAL_NOT_FOUND');
      }
    });

    it('SEC-006: should use parameterized queries preventing SQL injection', () => {
      const mockGetExisting = vi.fn().mockReturnValue(mockTerminal);
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGetUpdated = vi.fn().mockReturnValue(mockTerminal);

      mockPrepare
        .mockReturnValueOnce({ get: mockGetExisting })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: mockGetUpdated });

      const sqlInjectionPayload = "MANUAL_ENTRY'; DROP TABLE pos_terminal_mappings; --";
      const posConfig: TerminalPOSConfigData = {
        pos_type: sqlInjectionPayload as any,
        connection_type: 'MANUAL',
        connection_config: null,
      };

      dal.updatePOSConfig(storeId, mockTerminal.id, posConfig);

      // SEC-006: Verify the injection payload is NOT in the query string
      const updateQuery = mockPrepare.mock.calls[1][0] as string;
      expect(updateQuery).not.toContain('DROP TABLE');
      expect(updateQuery).not.toContain(sqlInjectionPayload);
      // Payload passed as bound parameter
      expect(mockRun).toHaveBeenCalledWith(
        sqlInjectionPayload, // pos_type (as parameter)
        'MANUAL', // connection_type
        null, // connection_config
        expect.any(String), // updated_at
        mockTerminal.id, // id
        storeId // store_id
      );
    });

    it('DB-006: should scope update by store_id for tenant isolation', () => {
      // findByIdForStore returns undefined (terminal doesn't belong to this store)
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const posConfig: TerminalPOSConfigData = {
        pos_type: 'MANUAL_ENTRY',
        connection_type: 'MANUAL',
        connection_config: null,
      };

      // Attempt to update terminal with wrong store_id
      expect(() => dal.updatePOSConfig(storeId, 'other-store-terminal', posConfig)).toThrow(
        TerminalPOSConfigurationError
      );

      // Verify query includes store_id in WHERE clause (findByIdForStore)
      const selectQuery = mockPrepare.mock.calls[0][0] as string;
      expect(selectQuery).toContain('store_id = ?');
    });
  });

  // ============================================================================
  // getPOSConfig
  // ============================================================================

  describe('getPOSConfig', () => {
    it('should return POS config for configured terminal', () => {
      const configRow = {
        pos_type: 'CLOVER_REST',
        connection_type: 'API',
        connection_config: JSON.stringify({ api_key: 'test123' }),
      };
      const mockGet = vi.fn().mockReturnValue(configRow);

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      const config = dal.getPOSConfig(storeId, mockTerminal.id);

      expect(config.pos_type).toBe('CLOVER_REST');
      expect(config.connection_type).toBe('API');
      expect(config.connection_config).toBe(JSON.stringify({ api_key: 'test123' }));
    });

    it('should throw TERMINAL_NOT_FOUND for non-existent terminal', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);
      mockPrepare.mockReturnValueOnce({ get: mockGet });

      expect(() => dal.getPOSConfig(storeId, 'non-existent')).toThrow(
        TerminalPOSConfigurationError
      );

      try {
        mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });
        dal.getPOSConfig(storeId, 'non-existent');
      } catch (e) {
        expect((e as TerminalPOSConfigurationError).code).toBe('TERMINAL_NOT_FOUND');
      }
    });

    it('should throw NOT_CONFIGURED for terminal without POS config', () => {
      const unconfiguredRow = {
        pos_type: null,
        connection_type: null,
        connection_config: null,
      };
      const mockGet = vi.fn().mockReturnValue(unconfiguredRow);

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      try {
        dal.getPOSConfig(storeId, mockTerminal.id);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(TerminalPOSConfigurationError);
        expect((e as TerminalPOSConfigurationError).code).toBe('NOT_CONFIGURED');
      }
    });

    it('should throw INCOMPLETE for partially configured terminal', () => {
      const partialRow = {
        pos_type: 'MANUAL_ENTRY',
        connection_type: null, // Missing connection_type
        connection_config: null,
      };
      const mockGet = vi.fn().mockReturnValue(partialRow);

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      try {
        dal.getPOSConfig(storeId, mockTerminal.id);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(TerminalPOSConfigurationError);
        expect((e as TerminalPOSConfigurationError).code).toBe('INCOMPLETE');
      }
    });

    it('should throw INVALID_JSON for malformed connection_config', () => {
      const invalidJsonRow = {
        pos_type: 'FILE_BASED',
        connection_type: 'FILE',
        connection_config: '{ invalid json }',
      };
      const mockGet = vi.fn().mockReturnValue(invalidJsonRow);

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      try {
        dal.getPOSConfig(storeId, mockTerminal.id);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(TerminalPOSConfigurationError);
        expect((e as TerminalPOSConfigurationError).code).toBe('INVALID_JSON');
      }
    });

    it('DB-006: should scope query by store_id for tenant isolation', () => {
      const mockGet = vi.fn().mockReturnValue(undefined); // Not found in store

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      try {
        dal.getPOSConfig(storeId, 'other-store-terminal');
      } catch {
        // Expected to throw
      }

      // Verify query includes store_id
      const selectQuery = mockPrepare.mock.calls[0][0] as string;
      expect(selectQuery).toContain('store_id = ?');
      expect(mockGet).toHaveBeenCalledWith('other-store-terminal', storeId);
    });
  });

  // ============================================================================
  // hasPOSConfig
  // ============================================================================

  describe('hasPOSConfig', () => {
    it('should return true for fully configured terminal', () => {
      const configuredTerminal = {
        ...mockTerminal,
        pos_type: 'LOTTERY',
        connection_type: 'MANUAL',
      };
      const mockGet = vi.fn().mockReturnValue(configuredTerminal);

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      expect(dal.hasPOSConfig(storeId, mockTerminal.id)).toBe(true);
    });

    it('should return false for unconfigured terminal', () => {
      const mockGet = vi.fn().mockReturnValue(mockTerminal); // pos_type/connection_type are null

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      expect(dal.hasPOSConfig(storeId, mockTerminal.id)).toBe(false);
    });

    it('should return false for non-existent terminal', () => {
      const mockGet = vi.fn().mockReturnValue(undefined);

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      expect(dal.hasPOSConfig(storeId, 'non-existent')).toBe(false);
    });

    it('should return false for partially configured terminal', () => {
      const partialTerminal = {
        ...mockTerminal,
        pos_type: null,
        connection_type: 'API', // Only connection_type set
      };
      const mockGet = vi.fn().mockReturnValue(partialTerminal);

      mockPrepare.mockReturnValueOnce({ get: mockGet });

      expect(dal.hasPOSConfig(storeId, mockTerminal.id)).toBe(false);
    });
  });

  // ============================================================================
  // findByConnectionType
  // ============================================================================

  describe('findByConnectionType', () => {
    it('should return terminals matching connection type', () => {
      const fileTerminals = [
        { ...mockTerminal, id: 'term-1', external_register_id: 'FILE-1', connection_type: 'FILE' },
        { ...mockTerminal, id: 'term-2', external_register_id: 'FILE-2', connection_type: 'FILE' },
      ];
      const mockAll = vi.fn().mockReturnValue(fileTerminals);

      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const result = dal.findByConnectionType(storeId, 'FILE');

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.external_register_id)).toContain('FILE-1');
      expect(result.map((t) => t.external_register_id)).toContain('FILE-2');
    });

    it('should return empty array for unmatched connection type', () => {
      const mockAll = vi.fn().mockReturnValue([]);

      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const result = dal.findByConnectionType(storeId, 'WEBHOOK');

      expect(result).toHaveLength(0);
    });

    it('DB-006: should scope query by store_id for tenant isolation', () => {
      const mockAll = vi.fn().mockReturnValue([]);

      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.findByConnectionType(storeId, 'FILE');

      // Verify query includes store_id in WHERE
      const selectQuery = mockPrepare.mock.calls[0][0] as string;
      expect(selectQuery).toContain('store_id = ?');
      expect(mockAll).toHaveBeenCalledWith(storeId, 'FILE');
    });
  });

  // ============================================================================
  // findConfigured
  // ============================================================================

  describe('findConfigured', () => {
    it('should return only fully configured terminals', () => {
      const configuredTerminals = [
        {
          ...mockTerminal,
          id: 'term-1',
          external_register_id: 'CONFIGURED-1',
          pos_type: 'MANUAL_ENTRY',
          connection_type: 'MANUAL',
        },
        {
          ...mockTerminal,
          id: 'term-2',
          external_register_id: 'CONFIGURED-2',
          pos_type: 'GILBARCO_NAXML',
          connection_type: 'FILE',
        },
      ];
      const mockAll = vi.fn().mockReturnValue(configuredTerminals);

      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const result = dal.findConfigured(storeId);

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.external_register_id)).toContain('CONFIGURED-1');
      expect(result.map((t) => t.external_register_id)).toContain('CONFIGURED-2');
    });

    it('should return empty array when no terminals are configured', () => {
      const mockAll = vi.fn().mockReturnValue([]);

      mockPrepare.mockReturnValueOnce({ all: mockAll });

      const result = dal.findConfigured(storeId);

      expect(result).toHaveLength(0);
    });

    it('DB-006: should scope query by store_id for tenant isolation', () => {
      const mockAll = vi.fn().mockReturnValue([]);

      mockPrepare.mockReturnValueOnce({ all: mockAll });

      dal.findConfigured(storeId);

      const selectQuery = mockPrepare.mock.calls[0][0] as string;
      expect(selectQuery).toContain('store_id = ?');
      expect(selectQuery).toContain('pos_type IS NOT NULL');
      expect(selectQuery).toContain('connection_type IS NOT NULL');
      expect(mockAll).toHaveBeenCalledWith(storeId);
    });
  });

  // ============================================================================
  // bulkUpdatePOSConfig
  // ============================================================================

  describe('bulkUpdatePOSConfig', () => {
    it('should update multiple terminals atomically', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const configs = [
        {
          terminalId: 'term-1',
          config: {
            pos_type: 'MANUAL_ENTRY' as const,
            connection_type: 'MANUAL' as const,
            connection_config: null,
          },
        },
        {
          terminalId: 'term-2',
          config: {
            pos_type: 'FILE_BASED' as const,
            connection_type: 'FILE' as const,
            connection_config: '{}',
          },
        },
        {
          terminalId: 'term-3',
          config: {
            pos_type: 'SQUARE_REST' as const,
            connection_type: 'API' as const,
            connection_config: '{"key":"val"}',
          },
        },
      ];

      const updated = dal.bulkUpdatePOSConfig(storeId, configs);

      expect(updated).toBe(3);
      expect(mockRun).toHaveBeenCalledTimes(3);
    });

    it('should skip terminals from wrong store (DB-006)', () => {
      const mockRun = vi
        .fn()
        .mockReturnValueOnce({ changes: 1 }) // First terminal succeeds
        .mockReturnValueOnce({ changes: 0 }); // Second terminal fails (wrong store)
      mockPrepare.mockReturnValue({ run: mockRun });

      const configs = [
        {
          terminalId: 'my-term',
          config: {
            pos_type: 'MANUAL_ENTRY' as const,
            connection_type: 'MANUAL' as const,
            connection_config: null,
          },
        },
        {
          terminalId: 'other-store-term',
          config: {
            pos_type: 'MANUAL_ENTRY' as const,
            connection_type: 'MANUAL' as const,
            connection_config: null,
          },
        },
      ];

      const updated = dal.bulkUpdatePOSConfig(storeId, configs);

      // Only first terminal should be counted (second belongs to other store)
      expect(updated).toBe(1);
    });

    it('should use parameterized queries (SEC-006)', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const configs = [
        {
          terminalId: 'term-1',
          config: {
            pos_type: 'MANUAL_ENTRY' as const,
            connection_type: 'MANUAL' as const,
            connection_config: null,
          },
        },
      ];

      dal.bulkUpdatePOSConfig(storeId, configs);

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('?');
      expect(updateQuery).toContain('WHERE id = ? AND store_id = ?');
      expect(updateQuery).not.toContain('MANUAL_ENTRY'); // Value not interpolated
    });
  });

  // ============================================================================
  // update method with POS config fields
  // ============================================================================

  describe('update with POS config fields', () => {
    it('should update pos_type via update method', () => {
      const mockRun = vi.fn();
      const updatedTerminal = { ...mockTerminal, pos_type: 'LOTTERY' };
      const mockGet = vi.fn().mockReturnValue(updatedTerminal);

      mockPrepare
        .mockReturnValueOnce({ run: mockRun }) // UPDATE
        .mockReturnValueOnce({ get: mockGet }); // findById after update

      const updated = dal.update(mockTerminal.id, { pos_type: 'LOTTERY' });

      expect(updated?.pos_type).toBe('LOTTERY');

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('pos_type = ?');
    });

    it('should update connection_type via update method', () => {
      const mockRun = vi.fn();
      const updatedTerminal = { ...mockTerminal, connection_type: 'WEBHOOK' };
      const mockGet = vi.fn().mockReturnValue(updatedTerminal);

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const updated = dal.update(mockTerminal.id, { connection_type: 'WEBHOOK' });

      expect(updated?.connection_type).toBe('WEBHOOK');

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('connection_type = ?');
    });

    it('should update connection_config via update method', () => {
      const config = JSON.stringify({ secret: 'webhook_secret_123' });
      const mockRun = vi.fn();
      const updatedTerminal = { ...mockTerminal, connection_config: config };
      const mockGet = vi.fn().mockReturnValue(updatedTerminal);

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const updated = dal.update(mockTerminal.id, { connection_config: config });

      expect(updated?.connection_config).toBe(config);

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('connection_config = ?');
    });

    it('should update multiple POS config fields at once', () => {
      const mockRun = vi.fn();
      const updatedTerminal = {
        ...mockTerminal,
        pos_type: 'CLOVER_REST',
        connection_type: 'API',
        connection_config: JSON.stringify({ api_key: 'clover_key' }),
      };
      const mockGet = vi.fn().mockReturnValue(updatedTerminal);

      mockPrepare.mockReturnValueOnce({ run: mockRun }).mockReturnValueOnce({ get: mockGet });

      const updated = dal.update(mockTerminal.id, {
        pos_type: 'CLOVER_REST',
        connection_type: 'API',
        connection_config: JSON.stringify({ api_key: 'clover_key' }),
      });

      expect(updated?.pos_type).toBe('CLOVER_REST');
      expect(updated?.connection_type).toBe('API');
      expect(updated?.connection_config).toBe(JSON.stringify({ api_key: 'clover_key' }));

      const updateQuery = mockPrepare.mock.calls[0][0] as string;
      expect(updateQuery).toContain('pos_type = ?');
      expect(updateQuery).toContain('connection_type = ?');
      expect(updateQuery).toContain('connection_config = ?');
    });
  });
});
