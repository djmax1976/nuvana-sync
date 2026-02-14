/**
 * Transactions DAL Unit Tests
 *
 * @module tests/unit/dal/transactions.dal.spec
 * @security SEC-006: Verifies parameterized queries
 * @security DB-006: Verifies tenant isolation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { mockPrepare, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  // transaction returns a function that executes the transaction when called
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    transaction: mockTransaction,
  })),
  isDatabaseInitialized: vi.fn(() => true),
}));

// Mock uuid - return sequential IDs for testing
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `mock-uuid-${++uuidCounter}`),
}));

// Import actual DAL module (use importActual to prevent mock leakage from other test files)
const { TransactionsDAL } = await vi.importActual<
  typeof import('../../../src/main/dal/transactions.dal')
>('../../../src/main/dal/transactions.dal');

import type {
  Transaction,
  TransactionLineItem,
  TransactionPayment,
} from '../../../src/main/dal/transactions.dal';

describe('TransactionsDAL', () => {
  let dal: InstanceType<typeof TransactionsDAL>;

  const mockTransactionData: Transaction = {
    transaction_id: 'txn-123',
    store_id: 'store-456',
    shift_id: 'shift-789',
    business_date: '2024-01-15',
    transaction_number: 1,
    transaction_time: '2024-01-15T10:30:00.000Z',
    register_id: 'register-001',
    cashier_id: 'cashier-001',
    total_amount: 25.5,
    payment_type: 'CASH',
    voided: 0,
    void_reason: null,
    created_at: '2024-01-15T10:30:00.000Z',
  };

  const mockLineItem: TransactionLineItem = {
    line_item_id: 'line-001',
    store_id: 'store-456',
    transaction_id: 'txn-123',
    line_number: 1,
    item_code: 'ITEM001',
    description: 'Test Item',
    quantity: 2,
    unit_price: 10.0,
    total_price: 20.0,
    department_id: 'dept-001',
    tax_amount: 1.5,
    discount_amount: 0,
    voided: 0,
    created_at: '2024-01-15T10:30:00.000Z',
  };

  const mockPayment: TransactionPayment = {
    payment_id: 'pay-001',
    store_id: 'store-456',
    transaction_id: 'txn-123',
    payment_type: 'CASH',
    amount: 25.5,
    tender_id: null,
    reference_number: null,
    created_at: '2024-01-15T10:30:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    dal = new TransactionsDAL();
  });

  // ==========================================================================
  // CREATE WITH DETAILS TESTS
  // ==========================================================================

  describe('createWithDetails', () => {
    it('should create transaction with line items and payments atomically', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockTransactionData);

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet });

      const result = dal.createWithDetails({
        store_id: 'store-456',
        shift_id: 'shift-789',
        business_date: '2024-01-15',
        total_amount: 25.5,
        lineItems: [
          {
            line_number: 1,
            item_code: 'ITEM001',
            quantity: 2,
            unit_price: 10.0,
            total_price: 20.0,
          },
        ],
        payments: [
          {
            payment_type: 'CASH',
            amount: 25.5,
          },
        ],
      });

      // Should use database transaction
      expect(mockTransaction).toHaveBeenCalled();
      expect(result.lineItems).toHaveLength(1);
      expect(result.payments).toHaveLength(1);
    });

    it('should create transaction without line items or payments', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockTransactionData);

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet });

      const result = dal.createWithDetails({
        store_id: 'store-456',
        business_date: '2024-01-15',
      });

      expect(result.lineItems).toHaveLength(0);
      expect(result.payments).toHaveLength(0);
    });

    it('should use provided transaction_id when given', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi
        .fn()
        .mockReturnValue({ ...mockTransactionData, transaction_id: 'custom-id' });

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet });

      dal.createWithDetails({
        transaction_id: 'custom-id',
        store_id: 'store-456',
        business_date: '2024-01-15',
      });

      // Verify custom transaction_id was used (first parameter)
      expect(mockRun).toHaveBeenCalled();
      const callArgs = mockRun.mock.calls[0];
      expect(callArgs[0]).toBe('custom-id');
      expect(callArgs[1]).toBe('store-456');
    });

    it('should throw error if transaction cannot be retrieved', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun, get: vi.fn().mockReturnValue(undefined) });

      expect(() =>
        dal.createWithDetails({
          store_id: 'store-456',
          business_date: '2024-01-15',
        })
      ).toThrow('Failed to retrieve created transaction');
    });

    it('should default quantity to 1 for line items', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockTransactionData);

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet });

      const result = dal.createWithDetails({
        store_id: 'store-456',
        business_date: '2024-01-15',
        lineItems: [{ line_number: 1 }],
      });

      expect(result.lineItems[0].quantity).toBe(1);
    });
  });

  // ==========================================================================
  // FIND BY ID WITH DETAILS TESTS
  // ==========================================================================

  describe('findByIdWithDetails', () => {
    it('should return transaction with line items and payments', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockTransactionData) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([mockLineItem]) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([mockPayment]) });

      const result = dal.findByIdWithDetails('txn-123');

      expect(result?.transaction_id).toBe('txn-123');
      expect(result?.lineItems).toHaveLength(1);
      expect(result?.payments).toHaveLength(1);
    });

    it('should return undefined when transaction not found', () => {
      mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

      const result = dal.findByIdWithDetails('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // ==========================================================================
  // GET LINE ITEMS TESTS
  // ==========================================================================

  describe('getLineItems', () => {
    it('should return line items ordered by line number', () => {
      const lineItems = [
        { ...mockLineItem, line_number: 1 },
        { ...mockLineItem, line_item_id: 'line-002', line_number: 2 },
      ];
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(lineItems),
      });

      const result = dal.getLineItems('txn-123');

      expect(result).toHaveLength(2);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('ORDER BY line_number ASC'));
    });

    it('should return empty array when no line items', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.getLineItems('txn-123');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // GET PAYMENTS TESTS
  // ==========================================================================

  describe('getPayments', () => {
    it('should return payments for transaction', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([mockPayment]),
      });

      const result = dal.getPayments('txn-123');

      expect(result).toHaveLength(1);
      expect(result[0].payment_type).toBe('CASH');
    });

    it('should return empty array when no payments', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.getPayments('txn-123');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // FIND BY SHIFT TESTS - DB-006 Tenant Isolation
  // ==========================================================================

  describe('findByShift', () => {
    it('should return transactions for specific store and shift', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([mockTransactionData]),
      });

      const result = dal.findByShift('store-456', 'shift-789');

      expect(result).toHaveLength(1);
      // DB-006: Verify store_id is in query
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('shift_id = ?'));
    });

    it('should order by transaction time', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      dal.findByShift('store-456', 'shift-789');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY transaction_time ASC')
      );
    });
  });

  // ==========================================================================
  // FIND BY DATE TESTS
  // ==========================================================================

  describe('findByDate', () => {
    it('should return transactions for specific date', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([mockTransactionData]),
      });

      const result = dal.findByDate('store-456', '2024-01-15');

      expect(result).toHaveLength(1);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('business_date = ?'));
    });

    it('should return empty array when no transactions', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findByDate('store-456', '2024-01-20');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // FIND BY DATE RANGE TESTS (PAGINATED)
  // ==========================================================================

  describe('findByDateRange', () => {
    it('should return paginated transactions', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 50 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([mockTransactionData]) });

      const result = dal.findByDateRange('store-456', '2024-01-01', '2024-01-31', 10, 0);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(50);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
      expect(result.hasMore).toBe(true);
    });

    it('should calculate hasMore correctly', () => {
      // When all items fit in one page (5 total, limit 10), hasMore should be false
      const fiveTransactions = Array(5).fill(mockTransactionData);
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 5 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(fiveTransactions) });

      const result = dal.findByDateRange('store-456', '2024-01-01', '2024-01-31', 10, 0);

      // offset(0) + data.length(5) >= total(5), so hasMore should be false
      expect(result.hasMore).toBe(false);
    });

    it('should use LIMIT and OFFSET', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 100 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      dal.findByDateRange('store-456', '2024-01-01', '2024-01-31', 25, 50);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('LIMIT ? OFFSET ?'));
    });

    it('should default to 100 limit', () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue({ count: 10 }) })
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      const result = dal.findByDateRange('store-456', '2024-01-01', '2024-01-31');

      expect(result.limit).toBe(100);
    });
  });

  // ==========================================================================
  // VOID TRANSACTION TESTS
  // ==========================================================================

  describe('voidTransaction', () => {
    it('should void transaction with reason', () => {
      const voidedTransaction = {
        ...mockTransactionData,
        voided: 1,
        void_reason: 'Customer request',
      };
      mockPrepare
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(voidedTransaction) });

      const result = dal.voidTransaction('txn-123', 'Customer request');

      expect(result?.voided).toBe(1);
      expect(result?.void_reason).toBe('Customer request');
    });

    it('should return undefined for non-existent transaction', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.voidTransaction('nonexistent', 'Test');

      expect(result).toBeUndefined();
    });

    it('should use parameterized query for void reason', () => {
      mockPrepare
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockTransactionData) });

      dal.voidTransaction('txn-123', 'Test reason');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('void_reason = ?'));
    });
  });

  // ==========================================================================
  // GET TOTALS BY DATE TESTS
  // ==========================================================================

  describe('getTotalsByDate', () => {
    it('should return totals excluding voided transactions', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_amount: 1500.0,
          transaction_count: 50,
          voided_count: 2,
        }),
      });

      const result = dal.getTotalsByDate('store-456', '2024-01-15');

      expect(result.totalAmount).toBe(1500.0);
      expect(result.transactionCount).toBe(50);
      expect(result.voidedCount).toBe(2);
    });

    it('should use CASE WHEN for voided filtering', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_amount: 0,
          transaction_count: 0,
          voided_count: 0,
        }),
      });

      dal.getTotalsByDate('store-456', '2024-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('CASE WHEN voided = 0'));
    });

    it('should use COALESCE for null safety', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({
          total_amount: 0,
          transaction_count: 0,
          voided_count: 0,
        }),
      });

      dal.getTotalsByDate('store-456', '2024-01-15');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('COALESCE'));
    });
  });

  // ==========================================================================
  // GET NEXT TRANSACTION NUMBER TESTS
  // ==========================================================================

  describe('getNextTransactionNumber', () => {
    it('should return 1 for first transaction', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ max_num: null }),
      });

      const result = dal.getNextTransactionNumber('store-456', '2024-01-15');

      expect(result).toBe(1);
    });

    it('should return incremented number', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue({ max_num: 42 }),
      });

      const result = dal.getNextTransactionNumber('store-456', '2024-01-15');

      expect(result).toBe(43);
    });
  });

  // ==========================================================================
  // SECURITY TESTS - SEC-006 SQL Injection Prevention
  // ==========================================================================

  describe('SEC-006: SQL Injection Prevention', () => {
    it('should use parameterized queries for all operations', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockTransactionData);
      const mockAll = vi.fn().mockReturnValue([mockTransactionData]);

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll });

      // Execute various operations
      dal.findByShift('store-456', 'shift-789');
      dal.findByDate('store-456', '2024-01-15');
      dal.getLineItems('txn-123');
      dal.getPayments('txn-123');
      dal.getTotalsByDate('store-456', '2024-01-15');
      dal.getNextTransactionNumber('store-456', '2024-01-15');

      // All calls should use parameterized queries
      const calls = mockPrepare.mock.calls;
      calls.forEach((call) => {
        expect(call[0]).toContain('?');
        expect(call[0]).not.toMatch(/\$\{.*\}/);
      });
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation Tests
  // ==========================================================================

  describe('DB-006: Tenant Isolation', () => {
    it('should always include store_id in store-scoped queries', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          count: 0,
          total_amount: 0,
          transaction_count: 0,
          voided_count: 0,
          max_num: null,
        }),
      });

      // Store-scoped queries
      dal.findByShift('store-456', 'shift-789');
      dal.findByDate('store-456', '2024-01-15');
      dal.getTotalsByDate('store-456', '2024-01-15');
      dal.getNextTransactionNumber('store-456', '2024-01-15');

      // Check that store_id is in each query
      const storeScopedCalls = mockPrepare.mock.calls.filter((call) =>
        call[0].includes('transactions')
      );

      storeScopedCalls.forEach((call) => {
        expect(call[0]).toContain('store_id');
      });
    });
  });

  // ==========================================================================
  // ATOMIC TRANSACTION TESTS
  // ==========================================================================

  describe('Atomic Operations', () => {
    it('should use database transaction for createWithDetails', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const mockGet = vi.fn().mockReturnValue(mockTransactionData);

      mockPrepare.mockReturnValue({ run: mockRun, get: mockGet });

      dal.createWithDetails({
        store_id: 'store-456',
        business_date: '2024-01-15',
        lineItems: [{ line_number: 1 }],
        payments: [{ payment_type: 'CASH', amount: 10 }],
      });

      // Should wrap in transaction
      expect(mockTransaction).toHaveBeenCalled();
    });
  });
});
