/**
 * Transactional Outbox Service Unit Tests
 *
 * Tests for Phase 2: Transactional Outbox and Queue Integrity
 *
 * Coverage:
 * - DT2.3: Deterministic idempotency key generation
 * - MQ-001: Idempotent message consumer patterns
 * - SEC-006: Parameterized queries (via DAL)
 * - DB-006: Tenant isolation
 *
 * @module tests/unit/services/transactional-outbox.service.spec
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateIdempotencyKey,
  generateIdempotencyKeyFromData,
  _resetTransactionalOutbox,
} from '../../../src/main/services/transactional-outbox.service';
import type { SyncOperation } from '../../../src/main/dal/sync-queue.dal';

// ============================================================================
// Test Setup
// ============================================================================

describe('Transactional Outbox Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetTransactionalOutbox();
  });

  // ==========================================================================
  // DT2.3: Idempotency Key Generation Tests
  // ==========================================================================

  describe('generateIdempotencyKey', () => {
    describe('deterministic generation', () => {
      it('should generate the same key for identical parameters', () => {
        // Arrange
        const params = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'CREATE' as SyncOperation,
        };

        // Act
        const key1 = generateIdempotencyKey(params);
        const key2 = generateIdempotencyKey(params);

        // Assert
        expect(key1).toBe(key2);
        expect(key1).toHaveLength(32);
      });

      it('should generate consistent keys across multiple calls', () => {
        // Arrange
        const params = {
          entity_type: 'shift',
          entity_id: 'shift-456',
          operation: 'UPDATE' as SyncOperation,
          discriminator: 'close',
        };

        // Act - generate 100 keys
        const keys = Array.from({ length: 100 }, () => generateIdempotencyKey(params));

        // Assert - all keys should be identical
        expect(new Set(keys).size).toBe(1);
      });

      it('should generate different keys for different entity_ids', () => {
        // Arrange
        const params1 = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'CREATE' as SyncOperation,
        };
        const params2 = {
          entity_type: 'pack',
          entity_id: 'pack-456',
          operation: 'CREATE' as SyncOperation,
        };

        // Act
        const key1 = generateIdempotencyKey(params1);
        const key2 = generateIdempotencyKey(params2);

        // Assert
        expect(key1).not.toBe(key2);
      });

      it('should generate different keys for different operations', () => {
        // Arrange
        const params1 = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'CREATE' as SyncOperation,
        };
        const params2 = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'UPDATE' as SyncOperation,
        };

        // Act
        const key1 = generateIdempotencyKey(params1);
        const key2 = generateIdempotencyKey(params2);

        // Assert
        expect(key1).not.toBe(key2);
      });

      it('should generate different keys for different entity_types', () => {
        // Arrange
        const params1 = {
          entity_type: 'pack',
          entity_id: 'entity-123',
          operation: 'CREATE' as SyncOperation,
        };
        const params2 = {
          entity_type: 'shift',
          entity_id: 'entity-123',
          operation: 'CREATE' as SyncOperation,
        };

        // Act
        const key1 = generateIdempotencyKey(params1);
        const key2 = generateIdempotencyKey(params2);

        // Assert
        expect(key1).not.toBe(key2);
      });

      it('should generate different keys with different discriminators', () => {
        // Arrange
        const params1 = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'UPDATE' as SyncOperation,
          discriminator: 'activate',
        };
        const params2 = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'UPDATE' as SyncOperation,
          discriminator: 'deplete',
        };

        // Act
        const key1 = generateIdempotencyKey(params1);
        const key2 = generateIdempotencyKey(params2);

        // Assert
        expect(key1).not.toBe(key2);
      });

      it('should generate same key when discriminator is undefined vs empty string', () => {
        // Arrange - empty discriminator should be treated same as undefined
        const params1 = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'CREATE' as SyncOperation,
          discriminator: undefined,
        };
        const params2 = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'CREATE' as SyncOperation,
          discriminator: '',
        };

        // Act
        const key1 = generateIdempotencyKey(params1);
        const key2 = generateIdempotencyKey(params2);

        // Assert
        expect(key1).toBe(key2);
      });
    });

    describe('key format', () => {
      it('should generate a 32-character hex string', () => {
        // Arrange
        const params = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'CREATE' as SyncOperation,
        };

        // Act
        const key = generateIdempotencyKey(params);

        // Assert
        expect(key).toHaveLength(32);
        expect(key).toMatch(/^[a-f0-9]{32}$/);
      });

      it('should generate only lowercase hex characters', () => {
        // Arrange
        const params = {
          entity_type: 'PACK',
          entity_id: 'PACK-ABC-XYZ',
          operation: 'UPDATE' as SyncOperation,
        };

        // Act
        const key = generateIdempotencyKey(params);

        // Assert
        expect(key).toMatch(/^[a-f0-9]+$/);
        expect(key).not.toMatch(/[A-F]/);
      });
    });

    describe('edge cases', () => {
      it('should handle empty entity_id', () => {
        // Arrange
        const params = {
          entity_type: 'pack',
          entity_id: '',
          operation: 'CREATE' as SyncOperation,
        };

        // Act
        const key = generateIdempotencyKey(params);

        // Assert
        expect(key).toHaveLength(32);
      });

      it('should handle special characters in entity_id', () => {
        // Arrange
        const params = {
          entity_type: 'pack',
          entity_id: 'pack-123:456/789',
          operation: 'CREATE' as SyncOperation,
        };

        // Act
        const key = generateIdempotencyKey(params);

        // Assert
        expect(key).toHaveLength(32);
        expect(key).toMatch(/^[a-f0-9]{32}$/);
      });

      it('should handle UUID entity_ids consistently', () => {
        // Arrange
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const params = {
          entity_type: 'pack',
          entity_id: uuid,
          operation: 'CREATE' as SyncOperation,
        };

        // Act
        const key1 = generateIdempotencyKey(params);
        const key2 = generateIdempotencyKey(params);

        // Assert
        expect(key1).toBe(key2);
      });

      it('should handle very long entity_ids', () => {
        // Arrange
        const longId = 'a'.repeat(1000);
        const params = {
          entity_type: 'pack',
          entity_id: longId,
          operation: 'CREATE' as SyncOperation,
        };

        // Act
        const key = generateIdempotencyKey(params);

        // Assert
        expect(key).toHaveLength(32);
      });

      it('should handle unicode characters in discriminator', () => {
        // Arrange
        const params = {
          entity_type: 'pack',
          entity_id: 'pack-123',
          operation: 'UPDATE' as SyncOperation,
          discriminator: '日本語テスト',
        };

        // Act
        const key = generateIdempotencyKey(params);

        // Assert
        expect(key).toHaveLength(32);
        expect(key).toMatch(/^[a-f0-9]{32}$/);
      });
    });

    describe('collision resistance', () => {
      it('should not have collisions for 10000 different inputs', () => {
        // Arrange
        const keys = new Set<string>();

        // Act - generate 10000 unique keys
        for (let i = 0; i < 10000; i++) {
          const key = generateIdempotencyKey({
            entity_type: 'pack',
            entity_id: `pack-${i}`,
            operation: 'CREATE' as SyncOperation,
          });
          keys.add(key);
        }

        // Assert - all keys should be unique
        expect(keys.size).toBe(10000);
      });

      it('should not have collisions across entity types', () => {
        // Arrange
        const entityTypes = ['pack', 'shift', 'day_close', 'employee', 'variance'];
        const keys = new Set<string>();

        // Act
        for (const entityType of entityTypes) {
          for (let i = 0; i < 100; i++) {
            const key = generateIdempotencyKey({
              entity_type: entityType,
              entity_id: `entity-${i}`,
              operation: 'CREATE' as SyncOperation,
            });
            keys.add(key);
          }
        }

        // Assert - all 500 keys should be unique
        expect(keys.size).toBe(500);
      });
    });
  });

  describe('generateIdempotencyKeyFromData', () => {
    it('should generate key from CreateSyncQueueItemData', () => {
      // Arrange
      const data = {
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE' as SyncOperation,
        payload: { test: 'data' },
      };

      // Act
      const key = generateIdempotencyKeyFromData(data);

      // Assert
      expect(key).toHaveLength(32);
    });

    it('should generate same key as generateIdempotencyKey with same params', () => {
      // Arrange
      const data = {
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'UPDATE' as SyncOperation,
        payload: { test: 'data' },
      };

      // Act
      const keyFromData = generateIdempotencyKeyFromData(data);
      const keyDirect = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'UPDATE' as SyncOperation,
      });

      // Assert
      expect(keyFromData).toBe(keyDirect);
    });

    it('should support optional discriminator', () => {
      // Arrange
      const data = {
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'UPDATE' as SyncOperation,
        payload: { test: 'data' },
      };

      // Act
      const keyWithoutDiscriminator = generateIdempotencyKeyFromData(data);
      const keyWithDiscriminator = generateIdempotencyKeyFromData(data, 'activate');

      // Assert
      expect(keyWithoutDiscriminator).not.toBe(keyWithDiscriminator);
    });

    it('should ignore payload in key generation (payload can change)', () => {
      // Arrange
      const data1 = {
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'UPDATE' as SyncOperation,
        payload: { tickets_sold: 10 },
      };
      const data2 = {
        store_id: 'store-123',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'UPDATE' as SyncOperation,
        payload: { tickets_sold: 20 },
      };

      // Act
      const key1 = generateIdempotencyKeyFromData(data1);
      const key2 = generateIdempotencyKeyFromData(data2);

      // Assert - same entity should have same key regardless of payload
      expect(key1).toBe(key2);
    });

    it('should ignore store_id in key generation (tenant isolation is separate)', () => {
      // Arrange - Note: store_id isolation is enforced at query level (DB-006)
      // Idempotency key should be same for same entity across stores
      // The unique constraint includes store_id for proper scoping
      const data1 = {
        store_id: 'store-111',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE' as SyncOperation,
        payload: {},
      };
      const data2 = {
        store_id: 'store-222',
        entity_type: 'pack',
        entity_id: 'pack-456',
        operation: 'CREATE' as SyncOperation,
        payload: {},
      };

      // Act
      const key1 = generateIdempotencyKeyFromData(data1);
      const key2 = generateIdempotencyKeyFromData(data2);

      // Assert - same idempotency key, but unique constraint includes store_id
      expect(key1).toBe(key2);
    });
  });

  // ==========================================================================
  // Integration-like Unit Tests (with mocked DB)
  // ==========================================================================

  describe('idempotency key usage scenarios', () => {
    it('should support pack receive operation keying', () => {
      // Arrange - same pack received twice should generate same key
      const packId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      const key1 = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'CREATE',
      });
      const key2 = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'CREATE',
      });

      // Assert
      expect(key1).toBe(key2);
    });

    it('should support pack lifecycle operations with discriminators', () => {
      // Arrange
      const packId = 'pack-123';

      // Act - each lifecycle operation gets unique key via discriminator
      const receiveKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'CREATE',
      });
      const activateKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
        discriminator: 'activate',
      });
      const depleteKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
        discriminator: 'deplete',
      });
      const returnKey = generateIdempotencyKey({
        entity_type: 'pack',
        entity_id: packId,
        operation: 'UPDATE',
        discriminator: 'return',
      });

      // Assert - all keys should be unique
      const keys = [receiveKey, activateKey, depleteKey, returnKey];
      expect(new Set(keys).size).toBe(4);
    });

    it('should support day close operation keying', () => {
      // Arrange
      const dayId = 'day-456';

      // Act
      const openKey = generateIdempotencyKey({
        entity_type: 'day_open',
        entity_id: dayId,
        operation: 'CREATE',
      });
      const closeKey = generateIdempotencyKey({
        entity_type: 'day_close',
        entity_id: dayId,
        operation: 'CREATE',
      });

      // Assert
      expect(openKey).not.toBe(closeKey);
    });

    it('should support shift operations keying', () => {
      // Arrange
      const shiftId = 'shift-789';

      // Act
      const openKey = generateIdempotencyKey({
        entity_type: 'shift_opening',
        entity_id: shiftId,
        operation: 'CREATE',
      });
      const updateKey = generateIdempotencyKey({
        entity_type: 'shift',
        entity_id: shiftId,
        operation: 'UPDATE',
      });
      const closeKey = generateIdempotencyKey({
        entity_type: 'shift_closing',
        entity_id: shiftId,
        operation: 'CREATE',
      });

      // Assert - all keys should be unique
      const keys = [openKey, updateKey, closeKey];
      expect(new Set(keys).size).toBe(3);
    });
  });
});
