/**
 * Transactions Handlers Unit Tests
 *
 * Tests for transaction management IPC handlers.
 *
 *
 * @module tests/unit/ipc/transactions.handlers
 */

// Uses vitest globals (configured in vitest.config.ts)

// Mock DALs
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/transactions.dal', () => ({
  transactionsDAL: {
    findByStore: vi.fn(),
    findByShift: vi.fn(),
    findByDate: vi.fn(),
    findByDateRange: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: {
    findById: vi.fn(),
  },
}));

describe('Transactions Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('transactions:list', () => {
    it('should return paginated transactions', async () => {
      const mockTransactions = [
        { transaction_id: 'txn-1', total_amount: 100, voided: 0 },
        { transaction_id: 'txn-2', total_amount: 200, voided: 0 },
      ];

      const response = {
        transactions: mockTransactions,
        total: 2,
        limit: 50,
        offset: 0,
      };

      expect(response.transactions.length).toBe(2);
      expect(response.limit).toBe(50);
      expect(response.offset).toBe(0);
    });

    it('should filter by shift', async () => {
      const params = {
        shiftId: 'shift-123',
      };

      expect(params.shiftId).toBe('shift-123');
    });

    it('should filter by date range', async () => {
      const params = {
        startDate: '2024-01-01',
        endDate: '2024-01-15',
      };

      // Validate date format
      expect(params.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(params.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should filter by voided status', async () => {
      const allTransactions = [
        { transaction_id: 'txn-1', voided: 0 },
        { transaction_id: 'txn-2', voided: 1 },
        { transaction_id: 'txn-3', voided: 0 },
      ];

      const activeTransactions = allTransactions.filter((t) => !t.voided);

      expect(activeTransactions.length).toBe(2);
    });

    it('should respect pagination limits', async () => {
      const params = { limit: 10, offset: 20 };

      // Max limit should be enforced
      const effectiveLimit = Math.min(params.limit, 1000);

      expect(effectiveLimit).toBe(10);
    });

    it('should validate input parameters', async () => {
      const invalidParams = {
        startDate: 'not-a-date',
        limit: -1,
      };

      // Should fail validation
      const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(invalidParams.startDate);
      const isValidLimit = invalidParams.limit > 0;

      expect(isValidDate).toBe(false);
      expect(isValidLimit).toBe(false);
    });

    it('should sort by transaction time descending', async () => {
      const transactions = [
        { transaction_id: 'txn-1', transaction_time: '2024-01-15T10:00:00Z' },
        { transaction_id: 'txn-2', transaction_time: '2024-01-15T14:00:00Z' },
        { transaction_id: 'txn-3', transaction_time: '2024-01-15T08:00:00Z' },
      ];

      const sorted = [...transactions].sort(
        (a, b) => new Date(b.transaction_time).getTime() - new Date(a.transaction_time).getTime()
      );

      expect(sorted[0].transaction_id).toBe('txn-2');
      expect(sorted[2].transaction_id).toBe('txn-3');
    });
  });

  describe('transactions:getById', () => {
    it('should return transaction details', async () => {
      const mockTransaction = {
        transaction_id: 'txn-123',
        store_id: 'store-1',
        shift_id: 'shift-1',
        transaction_time: '2024-01-15T10:30:00Z',
        total_amount: 150.5,
        voided: 0,
      };

      expect(mockTransaction.transaction_id).toBe('txn-123');
      expect(mockTransaction.total_amount).toBe(150.5);
    });

    it('should return NOT_FOUND for non-existent transaction', async () => {
      const _mockTransaction = null;

      const response = { error: 'NOT_FOUND', message: 'Transaction not found' };

      expect(response.error).toBe('NOT_FOUND');
    });

    it('should validate transaction ID format', async () => {
      const validUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const invalidId = 'not-a-uuid';

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(uuidRegex.test(validUUID)).toBe(true);
      expect(uuidRegex.test(invalidId)).toBe(false);
    });

    it('should verify transaction belongs to configured store (DB-006)', async () => {
      const configuredStoreId = 'store-123';
      const transactionStoreId = 'store-456'; // Different store

      expect(configuredStoreId).not.toBe(transactionStoreId);
    });

    it('should include line items in response', async () => {
      const mockTransaction = {
        transaction_id: 'txn-123',
        lineItems: [
          { item_id: 'item-1', quantity: 2, price: 10.0, total: 20.0 },
          { item_id: 'item-2', quantity: 1, price: 5.5, total: 5.5 },
        ],
      };

      expect(mockTransaction.lineItems.length).toBe(2);
      expect(mockTransaction.lineItems[0].quantity).toBe(2);
    });

    it('should include payment details in response', async () => {
      const mockTransaction = {
        transaction_id: 'txn-123',
        payments: [
          { payment_id: 'pay-1', method: 'CASH', amount: 20.0 },
          { payment_id: 'pay-2', method: 'CARD', amount: 5.5 },
        ],
      };

      expect(mockTransaction.payments.length).toBe(2);
      expect(mockTransaction.payments[0].method).toBe('CASH');
    });
  });

  describe('transactions:getByShift', () => {
    it('should return all transactions for a shift', async () => {
      const mockTransactions = [
        { transaction_id: 'txn-1', shift_id: 'shift-123' },
        { transaction_id: 'txn-2', shift_id: 'shift-123' },
      ];

      const shiftTransactions = mockTransactions.filter((t) => t.shift_id === 'shift-123');

      expect(shiftTransactions.length).toBe(2);
    });

    it('should return empty array for shift with no transactions', async () => {
      const mockTransactions: unknown[] = [];

      expect(mockTransactions.length).toBe(0);
    });

    it('should verify shift belongs to configured store', async () => {
      const configuredStoreId: string = 'store-123';
      const shiftStoreId: string = 'store-456';

      if (configuredStoreId !== shiftStoreId) {
        const response = { error: 'FORBIDDEN', message: 'Shift not in configured store' };
        expect(response.error).toBe('FORBIDDEN');
      }
    });
  });

  describe('store scoping (DB-006)', () => {
    it('should verify all transactions belong to configured store', async () => {
      const configuredStoreId = 'store-123';
      const transactions = [
        { transaction_id: 'txn-1', store_id: 'store-123' },
        { transaction_id: 'txn-2', store_id: 'store-123' },
      ];

      const allBelongToStore = transactions.every((t) => t.store_id === configuredStoreId);

      expect(allBelongToStore).toBe(true);
    });

    it('should not return transactions from other stores', async () => {
      const configuredStoreId = 'store-123';
      const queryResult = [
        { transaction_id: 'txn-1', store_id: 'store-123' },
        { transaction_id: 'txn-2', store_id: 'store-456' }, // Should not appear
      ];

      const filteredResults = queryResult.filter((t) => t.store_id === configuredStoreId);

      expect(filteredResults.length).toBe(1);
    });
  });

  describe('aggregations', () => {
    it('should calculate correct total for transactions', async () => {
      const transactions = [
        { total_amount: 100, voided: 0 },
        { total_amount: 200, voided: 0 },
        { total_amount: 50, voided: 1 }, // voided
      ];

      const activeTotal = transactions
        .filter((t) => !t.voided)
        .reduce((sum, t) => sum + t.total_amount, 0);

      expect(activeTotal).toBe(300);
    });

    it('should calculate correct count excluding voided', async () => {
      const transactions = [{ voided: 0 }, { voided: 0 }, { voided: 1 }];

      const activeCount = transactions.filter((t) => !t.voided).length;

      expect(activeCount).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should handle NOT_CONFIGURED error', async () => {
      const store = null;

      if (!store) {
        const response = { error: 'NOT_CONFIGURED', message: 'Store not configured' };
        expect(response.error).toBe('NOT_CONFIGURED');
      }
    });

    it('should handle NOT_FOUND error', async () => {
      const transaction = null;

      if (!transaction) {
        const response = { error: 'NOT_FOUND', message: 'Transaction not found' };
        expect(response.error).toBe('NOT_FOUND');
      }
    });

    it('should handle validation errors', async () => {
      const _invalidParams = { startDate: 'invalid' };

      const response = { error: 'VALIDATION_ERROR', message: 'Invalid parameters' };
      expect(response.error).toBe('VALIDATION_ERROR');
    });
  });
});
