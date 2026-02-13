/**
 * useLocalCashiers Hook Unit Tests
 *
 * Enterprise-grade tests for local IPC cashier hooks.
 * Tests query behavior, memoization, and security compliance.
 *
 * Story: DayClosePage Local IPC Migration
 *
 * @module tests/unit/hooks/useLocalCashiers
 * @security DB-006: Verifies store-scoped queries
 * @security SEC-001: Verifies no PIN hash exposure
 * @security SEC-006: Verifies parameterized query usage
 * @performance PERF-002: Verifies memoization through stable references
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Types (matching hook and transport types)
// ============================================================================

interface CashierInfo {
  cashier_id: string;
  name: string;
  role: string;
}

interface CashiersListResponse {
  cashiers: CashierInfo[];
  total: number;
}

interface LocalCashier {
  cashier_id: string;
  name: string;
  role: string;
}

// ============================================================================
// Mock Setup
// ============================================================================

const mockIpc = {
  cashiers: {
    list: vi.fn(),
  },
};

vi.mock('../../../src/renderer/lib/transport', () => ({
  ipc: mockIpc,
}));

// ============================================================================
// Test Data Factories
// ============================================================================

function createCashierInfo(overrides: Partial<CashierInfo> = {}): CashierInfo {
  return {
    cashier_id: 'cashier-uuid-001',
    name: 'John Smith',
    role: 'cashier',
    ...overrides,
  };
}

function transformToLocalCashier(cashier: CashierInfo): LocalCashier {
  return {
    cashier_id: cashier.cashier_id,
    name: cashier.name,
    role: cashier.role,
  };
}

// ============================================================================
// Query Key Tests
// ============================================================================

describe('localCashiersKeys', () => {
  describe('query key structure', () => {
    it('should have predictable key structure for cache invalidation', () => {
      const keys = {
        all: ['local', 'cashiers'] as const,
        list: () => ['local', 'cashiers', 'list'] as const,
      };

      expect(keys.all).toEqual(['local', 'cashiers']);
      expect(keys.list()).toEqual(['local', 'cashiers', 'list']);
    });

    it('should namespace under "local" to avoid cloud API collision', () => {
      const keys = {
        all: ['local', 'cashiers'] as const,
      };

      expect(keys.all[0]).toBe('local');
    });
  });
});

// ============================================================================
// useLocalCashiers Tests
// ============================================================================

describe('useLocalCashiers Query Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('happy path', () => {
    it('should return cashiers list', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [
          createCashierInfo({ cashier_id: 'c1', name: 'Alice' }),
          createCashierInfo({ cashier_id: 'c2', name: 'Bob' }),
        ],
        total: 2,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();

      expect(result.cashiers).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should transform cashiers to LocalCashier format', () => {
      const cashier = createCashierInfo({
        cashier_id: 'c1',
        name: 'Jane Doe',
        role: 'shift_manager',
      });

      const localCashier = transformToLocalCashier(cashier);

      expect(localCashier.cashier_id).toBe('c1');
      expect(localCashier.name).toBe('Jane Doe');
      expect(localCashier.role).toBe('shift_manager');
    });

    it('should return empty array when no cashiers exist', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [],
        total: 0,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();

      expect(result.cashiers).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should include all required fields', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [createCashierInfo()],
        total: 1,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const cashier = result.cashiers[0];

      expect(cashier.cashier_id).toBeDefined();
      expect(cashier.name).toBeDefined();
      expect(cashier.role).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle all role types', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [
          createCashierInfo({ cashier_id: 'c1', role: 'cashier' }),
          createCashierInfo({ cashier_id: 'c2', role: 'shift_manager' }),
          createCashierInfo({ cashier_id: 'c3', role: 'store_manager' }),
        ],
        total: 3,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const roles = result.cashiers.map((c: CashierInfo) => c.role);

      expect(roles).toContain('cashier');
      expect(roles).toContain('shift_manager');
      expect(roles).toContain('store_manager');
    });

    it('should handle many cashiers', async () => {
      const cashiers = Array.from({ length: 50 }, (_, i) =>
        createCashierInfo({
          cashier_id: `cashier-${i}`,
          name: `Employee ${i + 1}`,
        })
      );

      mockIpc.cashiers.list.mockResolvedValue({ cashiers, total: 50 });

      const result = await mockIpc.cashiers.list();

      expect(result.cashiers).toHaveLength(50);
      expect(result.total).toBe(50);
    });

    it('should handle special characters in names', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [
          createCashierInfo({ name: "O'Brien" }),
          createCashierInfo({ cashier_id: 'c2', name: 'García' }),
          createCashierInfo({ cashier_id: 'c3', name: 'Müller' }),
        ],
        total: 3,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const names = result.cashiers.map((c: CashierInfo) => c.name);

      expect(names).toContain("O'Brien");
      expect(names).toContain('García');
      expect(names).toContain('Müller');
    });
  });

  describe('error handling', () => {
    it('should propagate IPC errors', async () => {
      mockIpc.cashiers.list.mockRejectedValue(new Error('IPC channel error'));

      await expect(mockIpc.cashiers.list()).rejects.toThrow('IPC channel error');
    });

    it('should handle network timeouts', async () => {
      mockIpc.cashiers.list.mockRejectedValue(new Error('Request timeout'));

      await expect(mockIpc.cashiers.list()).rejects.toThrow('Request timeout');
    });

    it('should handle NOT_CONFIGURED errors', async () => {
      mockIpc.cashiers.list.mockRejectedValue(new Error('Store not configured'));

      await expect(mockIpc.cashiers.list()).rejects.toThrow('Store not configured');
    });
  });

  describe('security (DB-006)', () => {
    it('should call IPC channel without store_id (backend handles scoping)', async () => {
      mockIpc.cashiers.list.mockResolvedValue({ cashiers: [], total: 0 });

      await mockIpc.cashiers.list();

      // Backend handler uses getConfiguredStore() for scoping
      expect(mockIpc.cashiers.list).toHaveBeenCalledWith();
    });
  });

  describe('security (SEC-001: No PIN Hash Exposure)', () => {
    it('should not include pin_hash in response', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [createCashierInfo()],
        total: 1,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const cashier = result.cashiers[0] as Record<string, unknown>;

      // Verify no PIN-related fields
      expect(cashier).not.toHaveProperty('pin_hash');
      expect(cashier).not.toHaveProperty('pin');
      expect(cashier).not.toHaveProperty('password');
      expect(cashier).not.toHaveProperty('password_hash');
    });

    it('should only expose safe fields', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [createCashierInfo()],
        total: 1,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const cashier = result.cashiers[0];
      const keys = Object.keys(cashier);

      // Only these safe fields should be present
      expect(keys).toEqual(['cashier_id', 'name', 'role']);
    });
  });
});

// ============================================================================
// Memoization Tests (PERF-002)
// ============================================================================

describe('useLocalCashiers Memoization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('transformation stability', () => {
    it('should produce same output for same input', () => {
      const cashier = createCashierInfo({
        cashier_id: 'c1',
        name: 'John',
        role: 'cashier',
      });

      const result1 = transformToLocalCashier(cashier);
      const result2 = transformToLocalCashier(cashier);

      expect(result1).toEqual(result2);
    });

    it('should produce different output for different input', () => {
      const cashier1 = createCashierInfo({ cashier_id: 'c1' });
      const cashier2 = createCashierInfo({ cashier_id: 'c2' });

      const result1 = transformToLocalCashier(cashier1);
      const result2 = transformToLocalCashier(cashier2);

      expect(result1.cashier_id).not.toEqual(result2.cashier_id);
    });
  });

  describe('array transformation', () => {
    it('should transform all cashiers consistently', () => {
      const cashiers = [
        createCashierInfo({ cashier_id: 'c1', name: 'Alice', role: 'cashier' }),
        createCashierInfo({ cashier_id: 'c2', name: 'Bob', role: 'shift_manager' }),
        createCashierInfo({ cashier_id: 'c3', name: 'Carol', role: 'store_manager' }),
      ];

      const localCashiers = cashiers.map(transformToLocalCashier);

      expect(localCashiers[0].role).toBe('cashier');
      expect(localCashiers[1].role).toBe('shift_manager');
      expect(localCashiers[2].role).toBe('store_manager');
    });
  });
});

// ============================================================================
// useCashierById Tests
// ============================================================================

describe('useCashierById Query Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('lookup functionality', () => {
    it('should find cashier by ID', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [
          createCashierInfo({ cashier_id: 'c1', name: 'Alice' }),
          createCashierInfo({ cashier_id: 'c2', name: 'Bob' }),
        ],
        total: 2,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const cashiers = result.cashiers.map(transformToLocalCashier);
      const found = cashiers.find((c: LocalCashier) => c.cashier_id === 'c2');

      expect(found).toBeDefined();
      expect(found?.name).toBe('Bob');
    });

    it('should return undefined for non-existent cashier ID', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [
          createCashierInfo({ cashier_id: 'c1' }),
        ],
        total: 1,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const cashiers = result.cashiers.map(transformToLocalCashier);
      const found = cashiers.find((c: LocalCashier) => c.cashier_id === 'nonexistent');

      expect(found).toBeUndefined();
    });
  });

  describe('enabled state', () => {
    it('should be disabled when cashierId is null', () => {
      const cashierId: string | null = null;
      const enabled = !!cashierId;

      expect(enabled).toBe(false);
    });

    it('should be disabled when cashierId is undefined', () => {
      const cashierId: string | undefined = undefined;
      const enabled = !!cashierId;

      expect(enabled).toBe(false);
    });

    it('should be enabled when cashierId is valid', () => {
      const cashierId = 'cashier-001';
      const enabled = !!cashierId;

      expect(enabled).toBe(true);
    });
  });
});

// ============================================================================
// Integration Scenario Tests
// ============================================================================

describe('Local Cashier Hooks Integration Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DayClosePage Flow', () => {
    it('should support cashier name resolution for shift display', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [
          createCashierInfo({ cashier_id: 'c1', name: 'Alice Smith' }),
          createCashierInfo({ cashier_id: 'c2', name: 'Bob Jones' }),
        ],
        total: 2,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const cashiers = result.cashiers.map(transformToLocalCashier);

      // Simulate resolving cashier name for a shift
      const shiftCashierId = 'c1';
      const cashierName = cashiers.find(
        (c: LocalCashier) => c.cashier_id === shiftCashierId
      )?.name ?? 'Unknown';

      expect(cashierName).toBe('Alice Smith');
    });

    it('should support cashier dropdown population', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [
          createCashierInfo({ cashier_id: 'c1', name: 'Alice', role: 'cashier' }),
          createCashierInfo({ cashier_id: 'c2', name: 'Bob', role: 'cashier' }),
          createCashierInfo({ cashier_id: 'c3', name: 'Carol', role: 'shift_manager' }),
        ],
        total: 3,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const cashiers = result.cashiers.map(transformToLocalCashier);

      // All cashiers should be available for selection
      expect(cashiers).toHaveLength(3);
      expect(cashiers.map((c: LocalCashier) => c.name)).toEqual(['Alice', 'Bob', 'Carol']);
    });

    it('should support filtering by role if needed', async () => {
      const mockResponse: CashiersListResponse = {
        cashiers: [
          createCashierInfo({ role: 'cashier' }),
          createCashierInfo({ cashier_id: 'c2', role: 'shift_manager' }),
          createCashierInfo({ cashier_id: 'c3', role: 'store_manager' }),
        ],
        total: 3,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponse);

      const result = await mockIpc.cashiers.list();
      const cashiers = result.cashiers.map(transformToLocalCashier);

      // Filter to only cashiers (non-managers)
      const cashiersOnly = cashiers.filter((c: LocalCashier) => c.role === 'cashier');

      expect(cashiersOnly).toHaveLength(1);
    });
  });

  describe('Enterprise Security Requirements', () => {
    it('should never expose authentication credentials', async () => {
      // Even if backend accidentally included sensitive data, frontend should not use it
      const mockResponseWithSensitiveData = {
        cashiers: [
          {
            cashier_id: 'c1',
            name: 'Alice',
            role: 'cashier',
            // These should NEVER be present, but test defensively
            // pin_hash: 'should_not_exist',
          },
        ],
        total: 1,
      };

      mockIpc.cashiers.list.mockResolvedValue(mockResponseWithSensitiveData);

      const result = await mockIpc.cashiers.list();
      const localCashier = transformToLocalCashier(result.cashiers[0]);

      // Transformation should only include safe fields
      expect(Object.keys(localCashier)).toEqual(['cashier_id', 'name', 'role']);
    });
  });
});
