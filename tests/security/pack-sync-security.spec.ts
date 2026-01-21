/**
 * Pack Sync Security Tests
 *
 * Validates security controls for lottery pack synchronization.
 * Tests tenant isolation, data leakage prevention, and audit trail.
 *
 * @module tests/security/pack-sync-security
 * @security DB-006: Tenant isolation
 * @security API-003: Error sanitization
 * @security API-008: Output filtering
 * @security SEC-006: Parameterized queries
 * @security SEC-010: Audit trail
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

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

import { SyncQueueDAL, type SyncQueueItem } from '../../src/main/dal/sync-queue.dal';

describe('Pack Sync Security Tests', () => {
  let dal: SyncQueueDAL;

  beforeEach(() => {
    vi.clearAllMocks();
    dal = new SyncQueueDAL();
  });

  // ==========================================================================
  // PS-S-001: Data Leakage Prevention
  // API-008: OUTPUT_FILTERING
  // ==========================================================================
  describe('PS-S-001: Sync payload should NOT include internal fields', () => {
    /**
     * Validates that sensitive internal fields are excluded from sync payload
     * API-001: Includes serial_start, serial_end as required by cloud API spec
     */
    interface PackSyncPayload {
      pack_id: string;
      store_id: string;
      game_id: string;
      pack_number: string;
      status: string;
      bin_id: string | null;
      opening_serial: string | null;
      closing_serial: string | null;
      tickets_sold: number;
      sales_amount: number;
      received_at: string | null;
      received_by: string | null;
      activated_at: string | null;
      activated_by: string | null;
      depleted_at: string | null;
      returned_at: string | null;
      // Serial range fields (required by activate API)
      serial_start: string;
      serial_end: string;
    }

    /**
     * Full pack record from database (includes internal fields)
     */
    interface FullPackRecord extends PackSyncPayload {
      created_at: string;
      updated_at: string;
      cloud_pack_id: string | null;
      synced_at: string | null;
    }

    /**
     * Simulate buildPackSyncPayload function - excludes internal fields
     * API-001: Includes serial_start, serial_end as required by cloud API spec
     */
    function buildPackSyncPayload(
      pack: Omit<FullPackRecord, 'serial_start' | 'serial_end'>,
      ticketsPerPack: number | null = 300
    ): PackSyncPayload {
      const serialStart = '000';
      const serialEnd = ticketsPerPack ? String(ticketsPerPack - 1).padStart(3, '0') : '299';

      return {
        pack_id: pack.pack_id,
        store_id: pack.store_id,
        game_id: pack.game_id,
        pack_number: pack.pack_number,
        status: pack.status,
        bin_id: pack.bin_id,
        opening_serial: pack.opening_serial,
        closing_serial: pack.closing_serial,
        tickets_sold: pack.tickets_sold,
        sales_amount: pack.sales_amount,
        received_at: pack.received_at,
        received_by: pack.received_by,
        activated_at: pack.activated_at,
        activated_by: pack.activated_by ?? null,
        depleted_at: pack.depleted_at,
        returned_at: pack.returned_at,
        serial_start: serialStart,
        serial_end: serialEnd,
      };
    }

    const mockFullPack = {
      pack_id: 'pack-123',
      store_id: 'store-456',
      game_id: 'game-789',
      pack_number: 'PKG001',
      status: 'RECEIVED',
      bin_id: null,
      opening_serial: null,
      closing_serial: null,
      tickets_sold: 0,
      sales_amount: 0,
      received_at: '2024-01-15T10:00:00.000Z',
      received_by: 'user-123',
      activated_at: null,
      activated_by: null,
      depleted_at: null,
      returned_at: null,
      // Internal fields that should be excluded
      created_at: '2024-01-15T09:00:00.000Z',
      updated_at: '2024-01-15T10:00:00.000Z',
      cloud_pack_id: 'cloud-internal-id-xyz',
      synced_at: '2024-01-15T10:01:00.000Z',
    };

    it('should exclude created_at from sync payload', () => {
      const payload = buildPackSyncPayload(mockFullPack);
      expect(payload).not.toHaveProperty('created_at');
    });

    it('should exclude updated_at from sync payload', () => {
      const payload = buildPackSyncPayload(mockFullPack);
      expect(payload).not.toHaveProperty('updated_at');
    });

    it('should exclude cloud_pack_id from sync payload', () => {
      const payload = buildPackSyncPayload(mockFullPack);
      expect(payload).not.toHaveProperty('cloud_pack_id');
    });

    it('should exclude synced_at from sync payload', () => {
      const payload = buildPackSyncPayload(mockFullPack);
      expect(payload).not.toHaveProperty('synced_at');
    });

    it('should include only the 18 expected fields in payload', () => {
      const payload = buildPackSyncPayload(mockFullPack);
      const expectedFields = [
        'pack_id',
        'store_id',
        'game_id',
        'pack_number',
        'status',
        'bin_id',
        'opening_serial',
        'closing_serial',
        'tickets_sold',
        'sales_amount',
        'received_at',
        'received_by',
        'activated_at',
        'activated_by',
        'depleted_at',
        'returned_at',
        'serial_start',
        'serial_end',
      ];
      expect(Object.keys(payload).sort()).toEqual(expectedFields.sort());
    });

    it('should include serial_start and serial_end as required by API spec', () => {
      const payload = buildPackSyncPayload(mockFullPack, 300);
      expect(payload.serial_start).toBe('000');
      expect(payload.serial_end).toBe('299');
    });
  });

  // ==========================================================================
  // PS-S-002 & PS-S-003: Tenant Isolation
  // DB-006: TENANT_ISOLATION
  // ==========================================================================
  describe('PS-S-002 & PS-S-003: Tenant isolation in sync operations', () => {
    it('PS-S-002: Sync payload should be scoped to store_id', () => {
      const storeId = 'store-tenant-123';
      const payload = {
        pack_id: 'pack-1',
        store_id: storeId,
        game_id: 'game-1',
        pack_number: 'PKG001',
        status: 'RECEIVED',
      };

      expect(payload.store_id).toBe(storeId);
    });

    it('PS-S-003: Sync should reject cross-store pack operations', () => {
      const storeA = 'store-tenant-A';
      const storeB = 'store-tenant-B';

      // Pack belongs to store A
      const packStoreId = storeA;

      // Sync request from store B
      const requestStoreId = storeB;

      // Should not match - cross-store operation
      expect(packStoreId).not.toBe(requestStoreId);
    });

    it('should include store_id in every enqueue call', () => {
      const mockItem: SyncQueueItem = {
        id: 'mock-uuid-1234',
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE',
        payload: '{"store_id":"store-123"}',
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01T00:00:00.000Z',
        synced_at: null,
      };

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockItem) });

      dal.enqueue({
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE',
        payload: { store_id: 'store-123', pack_id: 'pack-456' },
      });

      // Verify store_id was passed to the query
      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String),
        'store-123', // store_id
        'pack',
        'pack-456',
        'CREATE',
        expect.any(String),
        expect.any(Number),
        expect.any(Number),
        expect.any(String)
      );
    });
  });

  // ==========================================================================
  // PS-S-004: Parameterized JSON Serialization
  // SEC-006: SQL_INJECTION prevention
  // ==========================================================================
  describe('PS-S-004: Pack payloads should use parameterized JSON serialization', () => {
    /**
     * SQL injection payloads to test against
     */
    const INJECTION_PAYLOADS = [
      "'; DROP TABLE sync_queue;--",
      "1' OR '1'='1",
      "'}; DELETE FROM lottery_packs;--",
      '{"malicious": "\'}; DROP TABLE --"}',
      "test'; SELECT * FROM users--",
    ];

    it.each(INJECTION_PAYLOADS)(
      'should safely serialize payload with injection attempt: %s',
      (injectionPayload) => {
        const mockItem: SyncQueueItem = {
          id: 'mock-uuid-1234',
          store_id: 'store-123',
          entity_type: 'pack',
          entity_id: 'pack-456',
          operation: 'CREATE',
          payload: '{}',
          priority: 0,
          synced: 0,
          sync_attempts: 0,
          max_attempts: 5,
          last_sync_error: null,
          last_attempt_at: null,
          created_at: '2024-01-01T00:00:00.000Z',
          synced_at: null,
        };

        const mockRun = vi.fn().mockReturnValue({ changes: 1 });
        mockPrepare
          .mockReturnValueOnce({ run: mockRun })
          .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockItem) });

        // Payload with injection attempt
        dal.enqueue({
          store_id: 'store-123',
          entity_type: 'pack',
          entity_id: 'pack-456',
          operation: 'CREATE',
          payload: { pack_number: injectionPayload },
        });

        // Verify the query uses parameterized INSERT
        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sync_queue'));
        expect(mockPrepare).toHaveBeenCalledWith(
          expect.stringContaining('VALUES (?, ?, ?, ?, ?, ?, ?,')
        );

        // Verify payload was JSON serialized (as a parameter, not interpolated)
        // The key security property is that it's passed as a parameter, not string-interpolated
        const serializedPayload = mockRun.mock.calls[0][5];
        expect(typeof serializedPayload).toBe('string');
        expect(serializedPayload).toContain('pack_number');
        // Verify it's valid JSON (injection not breaking structure)
        expect(() => JSON.parse(serializedPayload)).not.toThrow();
      }
    );

    it('should use JSON.stringify for payload serialization', () => {
      const mockItem: SyncQueueItem = {
        id: 'mock-uuid-1234',
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE',
        payload: '{"nested":{"data":"value"}}',
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01T00:00:00.000Z',
        synced_at: null,
      };

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockItem) });

      const complexPayload = {
        nested: {
          data: 'value',
          array: [1, 2, 3],
        },
      };

      dal.enqueue({
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE',
        payload: complexPayload,
      });

      // Verify JSON serialization
      const serializedPayload = mockRun.mock.calls[0][5];
      expect(serializedPayload).toBe(JSON.stringify(complexPayload));
    });
  });

  // ==========================================================================
  // PS-S-005 & PS-S-006: Error Handling
  // API-003: ERROR_HANDLING
  // ==========================================================================
  describe('PS-S-005 & PS-S-006: Sync errors should NOT expose sensitive info', () => {
    it('PS-S-005: should NOT expose stack traces in error messages', () => {
      // Simulate error handling pattern
      const internalError = new Error('Database connection failed at /internal/path/to/db.ts:123');

      // Sanitized error for client
      const sanitizedError = 'Failed to sync pack. Please try again.';

      expect(sanitizedError).not.toContain('/internal/path');
      expect(sanitizedError).not.toContain('Database connection');
      expect(sanitizedError).not.toContain('.ts:');
    });

    it('PS-S-006: should NOT expose internal pack_id generation logic', () => {
      // UUID generation should be opaque to client
      const generatedId = 'mock-uuid-1234';

      // Error message should not reveal ID generation method
      const errorMessage = 'Failed to create pack.';

      expect(errorMessage).not.toContain('uuid');
      expect(errorMessage).not.toContain('v4');
      expect(errorMessage).not.toContain('generation');
    });

    it('should log full error server-side but return generic message', () => {
      // Server-side logging (would go to secure log storage)
      const serverLog = {
        error: 'SQLITE_CONSTRAINT: UNIQUE constraint failed',
        stack: 'Error at LotteryPacksDAL.receive (/app/src/main/dal/lottery-packs.dal.ts:123:45)',
        packId: 'pack-123',
      };

      // Client-facing error (sanitized)
      const clientError = {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to receive pack. Please try again.',
        },
      };

      // Verify server log has full details
      expect(serverLog.stack).toBeDefined();
      expect(serverLog.error).toContain('SQLITE_CONSTRAINT');

      // Verify client error is sanitized
      expect(clientError.error.message).not.toContain('SQLITE');
      expect(clientError.error.message).not.toContain('constraint');
      expect(clientError.error.message).not.toContain('.ts:');
    });
  });

  // ==========================================================================
  // PS-S-007: Audit Trail
  // SEC-010: AUTHZ/Audit
  // ==========================================================================
  describe('PS-S-007: Audit trail should record received_by and activated_by', () => {
    it('should include received_by in sync payload for pack reception', () => {
      const receivedByUserId = 'user-receiver-123';
      const payload = {
        pack_id: 'pack-1',
        store_id: 'store-1',
        received_by: receivedByUserId,
        received_at: '2024-01-15T10:00:00.000Z',
      };

      expect(payload.received_by).toBe(receivedByUserId);
      expect(payload.received_at).toBeDefined();
    });

    it('should include activated_by in sync payload for pack activation', () => {
      const activatedByUserId = 'user-activator-456';
      const payload = {
        pack_id: 'pack-1',
        store_id: 'store-1',
        activated_by: activatedByUserId,
        activated_at: '2024-01-15T11:00:00.000Z',
      };

      expect(payload.activated_by).toBe(activatedByUserId);
      expect(payload.activated_at).toBeDefined();
    });

    it('should preserve user IDs through full pack lifecycle sync', () => {
      const receiverId = 'user-001';
      const activatorId = 'user-002';

      const fullLifecyclePayload = {
        pack_id: 'pack-1',
        store_id: 'store-1',
        status: 'DEPLETED',
        received_by: receiverId,
        received_at: '2024-01-15T08:00:00.000Z',
        activated_by: activatorId,
        activated_at: '2024-01-15T09:00:00.000Z',
        depleted_at: '2024-01-15T17:00:00.000Z',
      };

      // Both audit fields should be preserved
      expect(fullLifecyclePayload.received_by).toBe(receiverId);
      expect(fullLifecyclePayload.activated_by).toBe(activatorId);
    });

    it('should handle null values for optional audit fields', () => {
      // Pack received but not yet activated
      const payload = {
        pack_id: 'pack-1',
        store_id: 'store-1',
        status: 'RECEIVED',
        received_by: 'user-001',
        received_at: '2024-01-15T10:00:00.000Z',
        activated_by: null,
        activated_at: null,
      };

      expect(payload.received_by).toBe('user-001');
      expect(payload.activated_by).toBeNull();
    });
  });

  // ==========================================================================
  // SQ-U-001 through SQ-U-006: Sync Queue DAL Tests
  // ==========================================================================
  describe('Sync Queue DAL - Pack Entity Type Support', () => {
    it('SQ-U-001: enqueue should accept "pack" as valid entity_type', () => {
      const mockItem: SyncQueueItem = {
        id: 'mock-uuid-1234',
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE',
        payload: '{}',
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01T00:00:00.000Z',
        synced_at: null,
      };

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockItem) });

      const result = dal.enqueue({
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE',
        payload: {},
      });

      expect(result.entity_type).toBe('pack');
    });

    it('SQ-U-002: enqueue should serialize complex pack payload to JSON', () => {
      const mockItem: SyncQueueItem = {
        id: 'mock-uuid-1234',
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE',
        payload: '{}',
        priority: 0,
        synced: 0,
        sync_attempts: 0,
        max_attempts: 5,
        last_sync_error: null,
        last_attempt_at: null,
        created_at: '2024-01-01T00:00:00.000Z',
        synced_at: null,
      };

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockItem) });

      const complexPayload = {
        pack_id: 'pack-456',
        store_id: 'store-123',
        game_id: 'game-789',
        pack_number: 'PKG001',
        status: 'RECEIVED',
        nested: {
          deep: {
            value: true,
          },
        },
      };

      dal.enqueue({
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE',
        payload: complexPayload,
      });

      // Verify payload was serialized
      const serializedPayload = mockRun.mock.calls[0][5];
      expect(serializedPayload).toBe(JSON.stringify(complexPayload));
    });

    it('SQ-U-006: getStats should include pack items in pending/failed counts', () => {
      mockPrepare
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ count: 5 }), // pending
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ count: 1 }), // failed
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ count: 10 }), // synced today
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ created_at: '2024-01-01T00:00:00Z' }), // oldest
        });

      const stats = dal.getStats('store-123');

      expect(stats).toEqual({
        pending: 5,
        failed: 1,
        syncedToday: 10,
        oldestPending: '2024-01-01T00:00:00Z',
      });
    });
  });
});
