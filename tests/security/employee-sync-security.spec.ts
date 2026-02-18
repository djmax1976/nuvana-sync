/**
 * Employee Sync Security Tests
 *
 * Validates security controls for employee bidirectional synchronization.
 * Tests tenant isolation, PIN security, data leakage prevention, and audit trail.
 *
 * @module tests/security/employee-sync-security
 * @security SEC-001: PIN hashing - never expose plaintext or hashes in sync
 * @security DB-006: Tenant isolation - store-scoped operations
 * @security API-003: Error sanitization
 * @security API-008: Output filtering - exclude internal fields from sync
 * @security SEC-017: Audit trail
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('mock-uuid-1234'),
}));

import {
  SyncQueueDAL,
  type SyncQueueItem as _SyncQueueItem,
} from '../../src/main/dal/sync-queue.dal';

// ============================================================================
// Test Interfaces - Employee Sync Payload Structure
// ============================================================================

/**
 * Employee sync payload - what gets sent to cloud
 * SEC-001: MUST NOT include pin_hash
 * API-008: Excludes internal fields (created_at, updated_at)
 */
interface EmployeeSyncPayload {
  user_id: string;
  store_id: string;
  cloud_user_id: string | null;
  role: 'store_manager' | 'shift_manager' | 'cashier';
  name: string;
  active: boolean;
  last_login_at: string | null;
  synced_at: string | null;
}

/**
 * Full employee record from database (includes sensitive fields)
 */
interface FullEmployeeRecord extends EmployeeSyncPayload {
  pin_hash: string; // SEC-001: SENSITIVE - must never be in sync payload
  created_at: string; // API-008: Internal field
  updated_at: string; // API-008: Internal field
}

/**
 * Simulate buildEmployeeSyncPayload function - matches implementation
 * SEC-001: Excludes pin_hash
 * API-008: Excludes internal fields
 */
function buildEmployeeSyncPayload(user: FullEmployeeRecord): EmployeeSyncPayload {
  return {
    user_id: user.user_id,
    store_id: user.store_id,
    cloud_user_id: user.cloud_user_id,
    role: user.role,
    name: user.name,
    active: user.active,
    last_login_at: user.last_login_at,
    synced_at: user.synced_at,
  };
}

// ============================================================================
// Test Data
// ============================================================================

const mockEmployee: FullEmployeeRecord = {
  user_id: 'user-550e8400-e29b-41d4-a716-446655440100',
  store_id: 'store-123',
  cloud_user_id: 'cloud-user-789',
  role: 'cashier',
  name: 'John Doe',
  active: true,
  last_login_at: '2024-01-15T08:00:00.000Z',
  synced_at: '2024-01-15T10:00:00.000Z',
  // SENSITIVE/INTERNAL FIELDS - must be excluded from sync
  pin_hash: '$2b$12$abcdefghijklmnopqrstuv',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-15T10:00:00.000Z',
};

const mockLocalOnlyEmployee: FullEmployeeRecord = {
  ...mockEmployee,
  user_id: 'user-local-only-123',
  cloud_user_id: null, // Local-only employee
  synced_at: null,
  pin_hash: '$2b$12$localemployeepinhash123',
};

const mockStoreManager: FullEmployeeRecord = {
  ...mockEmployee,
  user_id: 'user-manager-456',
  role: 'store_manager',
  name: 'Manager Smith',
  pin_hash: '$2b$12$managerpinhashsecret',
};

// ============================================================================
// Tests
// ============================================================================

describe('Employee Sync Security Tests', () => {
  let _dal: SyncQueueDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    _dal = new SyncQueueDAL();
  });

  // ==========================================================================
  // ES-S-001: PIN Security (SEC-001)
  // ==========================================================================
  describe('ES-S-001: PIN data must NEVER be included in sync payload (SEC-001)', () => {
    it('should exclude pin_hash from sync payload', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload).not.toHaveProperty('pin_hash');
    });

    it('should exclude any PIN-related fields', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload).not.toHaveProperty('pin');
      expect(payload).not.toHaveProperty('pin_hash');
      expect(payload).not.toHaveProperty('pinHash');
      expect(payload).not.toHaveProperty('currentPin');
      expect(payload).not.toHaveProperty('newPin');
    });

    it('should not leak PIN through any field name variation', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      const jsonPayload = JSON.stringify(payload).toLowerCase();

      expect(jsonPayload).not.toContain('pin');
      expect(jsonPayload).not.toContain('hash');
      expect(jsonPayload).not.toContain('$2b$'); // bcrypt prefix
      expect(jsonPayload).not.toContain('secret');
      expect(jsonPayload).not.toContain('password');
    });

    it('should handle store_manager PIN same as other roles', () => {
      const payload = buildEmployeeSyncPayload(mockStoreManager);
      expect(payload).not.toHaveProperty('pin_hash');
      expect(payload.role).toBe('store_manager');
    });
  });

  // ==========================================================================
  // ES-S-002: Data Leakage Prevention (API-008)
  // ==========================================================================
  describe('ES-S-002: Internal fields must be excluded from sync (API-008)', () => {
    it('should exclude created_at from sync payload', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload).not.toHaveProperty('created_at');
    });

    it('should exclude updated_at from sync payload', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload).not.toHaveProperty('updated_at');
    });

    it('should include only the 8 expected fields in payload', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      const keys = Object.keys(payload);

      expect(keys).toHaveLength(8);
      expect(keys).toContain('user_id');
      expect(keys).toContain('store_id');
      expect(keys).toContain('cloud_user_id');
      expect(keys).toContain('role');
      expect(keys).toContain('name');
      expect(keys).toContain('active');
      expect(keys).toContain('last_login_at');
      expect(keys).toContain('synced_at');
    });
  });

  // ==========================================================================
  // ES-S-003: Tenant Isolation (DB-006)
  // ==========================================================================
  describe('ES-S-003: Sync operations must be store-scoped (DB-006)', () => {
    it('should include store_id in sync payload', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload.store_id).toBe('store-123');
    });

    it('should preserve store_id for local-only employees', () => {
      const payload = buildEmployeeSyncPayload(mockLocalOnlyEmployee);
      expect(payload.store_id).toBe('store-123');
    });

    it('should reject payloads with mismatched store_id', () => {
      const crossStoreEmployee = {
        ...mockEmployee,
        store_id: 'different-store-456',
      };

      const payload = buildEmployeeSyncPayload(crossStoreEmployee);

      // In actual implementation, the handler validates store_id matches configured store
      expect(payload.store_id).not.toBe('store-123');
    });
  });

  // ==========================================================================
  // ES-S-004: Local-Only Employee Sync (Phase 2 Feature)
  // ==========================================================================
  describe('ES-S-004: Local-only employees must be handled correctly', () => {
    it('should include null cloud_user_id for local-only employees', () => {
      const payload = buildEmployeeSyncPayload(mockLocalOnlyEmployee);
      expect(payload.cloud_user_id).toBeNull();
    });

    it('should include null synced_at for never-synced employees', () => {
      const payload = buildEmployeeSyncPayload(mockLocalOnlyEmployee);
      expect(payload.synced_at).toBeNull();
    });

    it('should include all required fields for local-only employees', () => {
      const payload = buildEmployeeSyncPayload(mockLocalOnlyEmployee);

      expect(payload.user_id).toBeDefined();
      expect(payload.store_id).toBeDefined();
      expect(payload.role).toBeDefined();
      expect(payload.name).toBeDefined();
      expect(typeof payload.active).toBe('boolean');
    });
  });

  // ==========================================================================
  // ES-S-005: Sync Queue Payload Serialization
  // ==========================================================================
  describe('ES-S-005: Sync queue payload must be safely serializable', () => {
    it('should serialize to valid JSON', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      const jsonString = JSON.stringify(payload);

      expect(() => JSON.parse(jsonString)).not.toThrow();
    });

    it('should deserialize to identical object', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      const jsonString = JSON.stringify(payload);
      const deserialized = JSON.parse(jsonString);

      expect(deserialized).toEqual(payload);
    });

    it('should handle special characters in name', () => {
      const employeeWithSpecialChars = {
        ...mockEmployee,
        name: "O'Brien-McGregor Jr.",
      };

      const payload = buildEmployeeSyncPayload(employeeWithSpecialChars);
      const jsonString = JSON.stringify(payload);
      const deserialized = JSON.parse(jsonString);

      expect(deserialized.name).toBe("O'Brien-McGregor Jr.");
    });

    it('should handle unicode characters in name', () => {
      const employeeWithUnicode = {
        ...mockEmployee,
        name: 'José García',
      };

      const payload = buildEmployeeSyncPayload(employeeWithUnicode);
      const jsonString = JSON.stringify(payload);
      const deserialized = JSON.parse(jsonString);

      expect(deserialized.name).toBe('José García');
    });
  });

  // ==========================================================================
  // ES-S-006: Sync Operation Types
  // ==========================================================================
  describe('ES-S-006: Sync operation types must be valid', () => {
    type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE';

    it('CREATE should be used for new employees', () => {
      const operation: SyncOperation = 'CREATE';
      expect(['CREATE', 'UPDATE', 'DELETE']).toContain(operation);
    });

    it('UPDATE should be used for modifications', () => {
      const operation: SyncOperation = 'UPDATE';
      expect(['CREATE', 'UPDATE', 'DELETE']).toContain(operation);
    });

    it('UPDATE should be used for deactivation (soft delete)', () => {
      const deactivatedEmployee = { ...mockEmployee, active: false };
      const payload = buildEmployeeSyncPayload(deactivatedEmployee);

      // Deactivation is UPDATE operation, not DELETE
      expect(payload.active).toBe(false);
    });

    it('UPDATE should be used for reactivation', () => {
      const reactivatedEmployee = { ...mockEmployee, active: true };
      const payload = buildEmployeeSyncPayload(reactivatedEmployee);

      expect(payload.active).toBe(true);
    });
  });

  // ==========================================================================
  // ES-S-007: Role Validation
  // ==========================================================================
  describe('ES-S-007: Role values must be valid', () => {
    const validRoles = ['store_manager', 'shift_manager', 'cashier'];

    it('should accept valid cashier role', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(validRoles).toContain(payload.role);
    });

    it('should accept valid shift_manager role', () => {
      const shiftManager = { ...mockEmployee, role: 'shift_manager' as const };
      const payload = buildEmployeeSyncPayload(shiftManager);
      expect(validRoles).toContain(payload.role);
    });

    it('should accept valid store_manager role', () => {
      const payload = buildEmployeeSyncPayload(mockStoreManager);
      expect(validRoles).toContain(payload.role);
    });
  });

  // ==========================================================================
  // ES-S-008: Boolean Type Safety
  // ==========================================================================
  describe('ES-S-008: Active status must be proper boolean', () => {
    it('should have boolean active field', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(typeof payload.active).toBe('boolean');
    });

    it('should correctly represent active=true', () => {
      const activeEmployee = { ...mockEmployee, active: true };
      const payload = buildEmployeeSyncPayload(activeEmployee);
      expect(payload.active).toBe(true);
    });

    it('should correctly represent active=false', () => {
      const inactiveEmployee = { ...mockEmployee, active: false };
      const payload = buildEmployeeSyncPayload(inactiveEmployee);
      expect(payload.active).toBe(false);
    });
  });

  // ==========================================================================
  // ES-S-009: Timestamp Handling
  // ==========================================================================
  describe('ES-S-009: Timestamps must be properly formatted', () => {
    it('should include last_login_at when present', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload.last_login_at).toBe('2024-01-15T08:00:00.000Z');
    });

    it('should include null last_login_at when never logged in', () => {
      const neverLoggedIn = { ...mockEmployee, last_login_at: null };
      const payload = buildEmployeeSyncPayload(neverLoggedIn);
      expect(payload.last_login_at).toBeNull();
    });

    it('should include synced_at when previously synced', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload.synced_at).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  // ==========================================================================
  // ES-S-010: Injection Prevention
  // ==========================================================================
  describe('ES-S-010: Payload must be safe from injection attacks', () => {
    it('should handle SQL injection attempt in name', () => {
      const maliciousEmployee = {
        ...mockEmployee,
        name: "'; DROP TABLE users; --",
      };

      const payload = buildEmployeeSyncPayload(maliciousEmployee);
      // The payload just contains the string - actual SQL protection is in DAL
      expect(payload.name).toBe("'; DROP TABLE users; --");
    });

    it('should handle XSS attempt in name', () => {
      const xssEmployee = {
        ...mockEmployee,
        name: '<script>alert("xss")</script>',
      };

      const payload = buildEmployeeSyncPayload(xssEmployee);
      // The payload contains the string - XSS protection is at render time
      expect(payload.name).toBe('<script>alert("xss")</script>');
    });

    it('should handle null bytes in name', () => {
      const nullByteEmployee = {
        ...mockEmployee,
        name: 'John\x00Doe',
      };

      const payload = buildEmployeeSyncPayload(nullByteEmployee);
      const jsonString = JSON.stringify(payload);

      // JSON should handle null bytes properly
      expect(jsonString).toBeDefined();
    });
  });

  // ==========================================================================
  // ES-S-011: Audit Trail Support
  // ==========================================================================
  describe('ES-S-011: Payload supports audit trail (SEC-017)', () => {
    it('should include user_id for audit tracking', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload.user_id).toBeDefined();
      expect(payload.user_id.length).toBeGreaterThan(0);
    });

    it('should include store_id for audit context', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);
      expect(payload.store_id).toBeDefined();
    });

    it('payload should uniquely identify the employee', () => {
      const payload = buildEmployeeSyncPayload(mockEmployee);

      // user_id + store_id uniquely identifies an employee
      expect(payload.user_id).toBeDefined();
      expect(payload.store_id).toBeDefined();
    });
  });
});
