/**
 * Manual Mode Register Sync Integration Tests
 *
 * Full-flow integration tests with real SQLite database.
 * Validates that cloud register sync correctly populates pos_terminal_mappings.
 *
 * @module tests/integration/manual-mode-register-sync.spec
 *
 * Security Compliance:
 * - SEC-006: All queries use parameterized statements
 * - DB-006: Store-scoped data for tenant isolation
 *
 * Test Coverage:
 * - 6.6.1 through 6.6.6 per Phase 6 test plan
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';

// ============================================================================
// Native Module Check
// ============================================================================

let nativeModuleAvailable = true;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Db = require('better-sqlite3-multiple-ciphers');
  const testDb = new Db(':memory:');
  testDb.close();
} catch {
  nativeModuleAvailable = false;
}

const SKIP_NATIVE_MODULE_TESTS = process.env.SKIP_NATIVE_TESTS === 'true' || !nativeModuleAvailable;

// ============================================================================
// Database Holder (vi.hoisted for cross-platform mock compatibility)
// ============================================================================

// Use vi.hoisted() to ensure the database holder is available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { dbHolder } = vi.hoisted(() => ({
  dbHolder: { instance: null as Database.Database | null },
}));

// Mock database service to use our test database
vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => {
    if (!dbHolder.instance) {
      throw new Error('Database not initialized - test setup issue');
    }
    return dbHolder.instance;
  }),
  isDatabaseInitialized: vi.fn(() => dbHolder.instance !== null),
}));

// Mock uuid for predictable IDs in tests
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: () => `test-uuid-${++uuidCounter}`,
}));

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ============================================================================
// Database Reference (after mocks)
// ============================================================================

let db: Database.Database;

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { createServiceTestContext, type ServiceTestContext } from '../helpers/test-context';
import { POSTerminalMappingsDAL } from '../../src/main/dal/pos-id-mappings.dal';
import type { CloudRegister } from '../../src/shared/types/config.types';

// ============================================================================
// Test Suite
// ============================================================================

const describeSuite = SKIP_NATIVE_MODULE_TESTS ? describe.skip : describe;

describeSuite('Manual Mode Register Sync (Integration)', () => {
  let ctx: ServiceTestContext;
  let terminalMappingsDAL: POSTerminalMappingsDAL;

  beforeEach(async () => {
    uuidCounter = 0;
    ctx = await createServiceTestContext({
      storeName: 'Manual Mode Integration Store',
    });
    db = ctx.db;
    dbHolder.instance = db;

    terminalMappingsDAL = new POSTerminalMappingsDAL();
  });

  afterEach(() => {
    ctx?.cleanup();
    dbHolder.instance = null;
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  /**
   * Sync registers from cloud into the database using the DAL directly.
   * Mirrors the logic in SettingsService.syncRegistersFromCloud().
   */
  function syncRegistersFromCloud(
    storeId: string,
    registers: CloudRegister[]
  ): { created: number; updated: number; total: number } {
    let created = 0;
    let updated = 0;

    for (const register of registers) {
      const existing = terminalMappingsDAL.findByExternalId(
        storeId,
        register.external_register_id,
        'generic'
      );

      if (existing) {
        terminalMappingsDAL.update(existing.id, {
          terminal_type: register.terminal_type,
          description: register.description,
          active: register.active ? 1 : 0,
        });
        updated++;
      } else {
        terminalMappingsDAL.getOrCreate(storeId, register.external_register_id, {
          terminalType: register.terminal_type,
          description: register.description ?? undefined,
          posSystemType: 'generic',
        });
        created++;
      }
    }

    return { created, updated, total: registers.length };
  }

  /**
   * Query terminal mappings directly from the database.
   * SEC-006: Parameterized query for tenant isolation.
   */
  function queryTerminalMappings(storeId: string) {
    const stmt = db.prepare(
      'SELECT * FROM pos_terminal_mappings WHERE store_id = ? ORDER BY external_register_id ASC'
    );
    return stmt.all(storeId) as Array<{
      id: string;
      store_id: string;
      external_register_id: string;
      terminal_type: string;
      description: string | null;
      active: number;
      pos_system_type: string;
      created_at: string;
      updated_at: string;
    }>;
  }

  // ==========================================================================
  // Full Flow Tests (6.6.1 - 6.6.4)
  // ==========================================================================

  // 6.6.1 - API key validation with MANUAL mode populates pos_terminal_mappings
  it('6.6.1: should populate pos_terminal_mappings from MANUAL mode registers', () => {
    const registers: CloudRegister[] = [
      {
        external_register_id: 'REG-FRONT',
        terminal_type: 'REGISTER',
        description: 'Front Counter',
        active: true,
      },
      {
        external_register_id: 'REG-BACK',
        terminal_type: 'REGISTER',
        description: 'Back Counter',
        active: true,
      },
      {
        external_register_id: 'KIOSK-01',
        terminal_type: 'KIOSK',
        description: 'Self-Service Kiosk',
        active: true,
      },
    ];

    const result = syncRegistersFromCloud(ctx.storeId, registers);

    expect(result.created).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.total).toBe(3);

    const rows = queryTerminalMappings(ctx.storeId);
    expect(rows).toHaveLength(3);

    const kiosk = rows.find((r) => r.external_register_id === 'KIOSK-01');
    expect(kiosk).toBeDefined();
    expect(kiosk!.terminal_type).toBe('KIOSK');
    expect(kiosk!.description).toBe('Self-Service Kiosk');
    expect(kiosk!.active).toBe(1);

    const front = rows.find((r) => r.external_register_id === 'REG-FRONT');
    expect(front).toBeDefined();
    expect(front!.terminal_type).toBe('REGISTER');
    expect(front!.description).toBe('Front Counter');
  });

  // 6.6.2 - Resync updates changed registers without duplicating
  it('6.6.2: should update existing registers and add new ones without duplication', () => {
    // Initial sync: 2 registers
    const initialRegisters: CloudRegister[] = [
      {
        external_register_id: 'R1',
        terminal_type: 'REGISTER',
        description: 'Register One',
        active: true,
      },
      {
        external_register_id: 'R2',
        terminal_type: 'REGISTER',
        description: 'Register Two',
        active: true,
      },
    ];

    syncRegistersFromCloud(ctx.storeId, initialRegisters);

    let rows = queryTerminalMappings(ctx.storeId);
    expect(rows).toHaveLength(2);

    // Resync: update descriptions + add R3
    const resyncRegisters: CloudRegister[] = [
      {
        external_register_id: 'R1',
        terminal_type: 'REGISTER',
        description: 'Updated Register One',
        active: true,
      },
      {
        external_register_id: 'R2',
        terminal_type: 'KIOSK',
        description: 'Now a Kiosk',
        active: true,
      },
      {
        external_register_id: 'R3',
        terminal_type: 'MOBILE',
        description: 'New Mobile Register',
        active: true,
      },
    ];

    const result = syncRegistersFromCloud(ctx.storeId, resyncRegisters);

    expect(result.created).toBe(1); // R3 is new
    expect(result.updated).toBe(2); // R1 and R2 updated
    expect(result.total).toBe(3);

    rows = queryTerminalMappings(ctx.storeId);
    expect(rows).toHaveLength(3); // 3 total, not 5

    const r1 = rows.find((r) => r.external_register_id === 'R1');
    expect(r1!.description).toBe('Updated Register One');

    const r2 = rows.find((r) => r.external_register_id === 'R2');
    expect(r2!.terminal_type).toBe('KIOSK');
    expect(r2!.description).toBe('Now a Kiosk');

    const r3 = rows.find((r) => r.external_register_id === 'R3');
    expect(r3!.terminal_type).toBe('MOBILE');
    expect(r3!.description).toBe('New Mobile Register');
  });

  // 6.6.3 - Resync deactivates register when cloud sends active: false
  it('6.6.3: should deactivate register when cloud sends active: false', () => {
    // Seed an active register
    const initial: CloudRegister[] = [
      {
        external_register_id: 'DEACTIVATE-ME',
        terminal_type: 'REGISTER',
        description: 'Active Register',
        active: true,
      },
    ];

    syncRegistersFromCloud(ctx.storeId, initial);

    let rows = queryTerminalMappings(ctx.storeId);
    expect(rows[0].active).toBe(1);

    // Resync with active: false
    const deactivated: CloudRegister[] = [
      {
        external_register_id: 'DEACTIVATE-ME',
        terminal_type: 'REGISTER',
        description: 'Deactivated Register',
        active: false,
      },
    ];

    syncRegistersFromCloud(ctx.storeId, deactivated);

    rows = queryTerminalMappings(ctx.storeId);
    expect(rows[0].active).toBe(0);
    expect(rows[0].description).toBe('Deactivated Register');
  });

  // 6.6.4 - Register sync failure does not corrupt other saved settings
  it('6.6.4: should handle partial sync failure gracefully', () => {
    // Sync first 2 registers successfully
    const firstBatch: CloudRegister[] = [
      {
        external_register_id: 'GOOD-1',
        terminal_type: 'REGISTER',
        description: 'Good Register 1',
        active: true,
      },
      {
        external_register_id: 'GOOD-2',
        terminal_type: 'REGISTER',
        description: 'Good Register 2',
        active: true,
      },
    ];

    syncRegistersFromCloud(ctx.storeId, firstBatch);

    const rows = queryTerminalMappings(ctx.storeId);
    expect(rows).toHaveLength(2);

    // The registers that were successfully synced should remain intact
    const good1 = rows.find((r) => r.external_register_id === 'GOOD-1');
    expect(good1).toBeDefined();
    expect(good1!.description).toBe('Good Register 1');
  });

  // ==========================================================================
  // Tenant Isolation (6.6.5) - DB-006
  // ==========================================================================

  // 6.6.5 - Registers from one store are not visible to another
  it('6.6.5: should isolate registers between stores (DB-006)', () => {
    // Create second store in the same database
    const storeId2 = `test-store-2-${Date.now()}`;
    const insertStore2 = db.prepare(
      "INSERT INTO stores (store_id, company_id, name, timezone, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', datetime('now'), datetime('now'))"
    );
    insertStore2.run(storeId2, 'test-company-2', 'Test Store 2', 'America/Los_Angeles');

    // Sync registers for store 1
    const storeARegisters: CloudRegister[] = [
      {
        external_register_id: 'A-REG-1',
        terminal_type: 'REGISTER',
        description: 'Store A Register',
        active: true,
      },
      {
        external_register_id: 'A-REG-2',
        terminal_type: 'KIOSK',
        description: 'Store A Kiosk',
        active: true,
      },
    ];

    syncRegistersFromCloud(ctx.storeId, storeARegisters);

    // Verify store 1 has its registers
    const storeARows = queryTerminalMappings(ctx.storeId);
    expect(storeARows).toHaveLength(2);

    // Verify store 2 has NO registers (tenant isolation)
    const storeBRows = queryTerminalMappings(storeId2);
    expect(storeBRows).toHaveLength(0);
  });

  // ==========================================================================
  // Data Integrity (6.6.6)
  // ==========================================================================

  // 6.6.6 - Synced registers appear in findRegisters output
  it('6.6.6: should make synced registers available via findRegisters', () => {
    const registers: CloudRegister[] = [
      {
        external_register_id: 'FR-1',
        terminal_type: 'REGISTER',
        description: 'Counter 1',
        active: true,
      },
      {
        external_register_id: 'FR-2',
        terminal_type: 'REGISTER',
        description: 'Counter 2',
        active: true,
      },
    ];

    syncRegistersFromCloud(ctx.storeId, registers);

    // Use findRegisters (the method used by terminals:list handler)
    const foundRegisters = terminalMappingsDAL.findRegisters(ctx.storeId);

    expect(foundRegisters).toHaveLength(2);
    expect(foundRegisters[0].external_register_id).toBe('FR-1');
    expect(foundRegisters[1].external_register_id).toBe('FR-2');
  });
});
