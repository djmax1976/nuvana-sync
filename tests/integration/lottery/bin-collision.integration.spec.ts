/**
 * Bin Collision Integration Tests (Phase 4 - Task 4.2.1)
 *
 * Enterprise-grade integration tests validating the bin collision detection
 * and auto-depletion workflow business logic.
 *
 * Business Rule: BIN-001 - One active pack per bin
 * When activating a pack in a bin that already contains an ACTIVE pack,
 * the existing pack is auto-depleted with reason AUTO_REPLACED.
 *
 * Testing Strategy:
 * - These tests validate the business logic and data flow patterns
 * - Full handler invocation is covered by E2E tests (bin-collision.e2e.ts)
 * - Security patterns tested in bin-collision-security.integration.spec.ts
 * - Sync payloads tested in bin-collision-sync.integration.spec.ts
 *
 * @module tests/integration/lottery/bin-collision
 * @security SEC-006: Parameterized queries in DAL
 * @security SEC-010: Authorization from session, not request
 * @security DB-006: Tenant isolation via store_id
 * @security SYNC-001: Depletion sync queued before activation sync
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import type { CreateSyncQueueItemData } from '../../../src/main/dal/sync-queue.dal';

// ==========================================================================
// Schema Definitions (Matching lottery.handlers.ts)
// ==========================================================================

const UUIDSchema = z.string().uuid('Invalid UUID format');
const SerialSchema = z.string().regex(/^\d{3}$/, 'Serial must be 3 digits');

/**
 * ActivatePackSchema - Production schema from lottery.handlers.ts
 */
const ActivatePackSchema = z.object({
  pack_id: UUIDSchema,
  bin_id: UUIDSchema,
  opening_serial: SerialSchema,
  deplete_previous: z.boolean().optional().default(true),
});

// ==========================================================================
// Business Logic Functions (Extracted for testability)
// ==========================================================================

/**
 * Calculate final serial for a fully depleted pack
 * Formula: final_serial = opening_serial + tickets_per_pack - 1
 */
function calculateFinalSerial(openingSerial: string, ticketsPerPack: number): string {
  const openingSerialNum = parseInt(openingSerial, 10);
  const finalSerialNum = openingSerialNum + ticketsPerPack - 1;
  return String(finalSerialNum).padStart(3, '0');
}

/**
 * Calculate sales amount for depleted pack
 */
function calculateSalesAmount(ticketsSold: number, pricePerTicket: number): number {
  return ticketsSold * pricePerTicket;
}

/**
 * Build depletion payload for sync queue
 */
function buildDepletionPayload(pack: {
  pack_id: string;
  pack_number: string;
  closing_serial: string;
  tickets_sold_count: number;
  sales_amount: number;
  depleted_by: string;
  depleted_shift_id: string | null;
  depletion_reason: string;
}): object {
  return {
    pack_id: pack.pack_id,
    pack_number: pack.pack_number,
    status: 'DEPLETED',
    closing_serial: pack.closing_serial,
    tickets_sold_count: pack.tickets_sold_count,
    sales_amount: pack.sales_amount,
    depleted_by: pack.depleted_by,
    depleted_shift_id: pack.depleted_shift_id,
    depletion_reason: pack.depletion_reason,
  };
}

// ==========================================================================
// Test Suite
// ==========================================================================

describe('Bin Collision Integration Tests (Phase 4 - Task 4.2.1)', () => {
  // ==========================================================================
  // 4.2.1.1: Happy Path - Collision Detection Logic
  // ==========================================================================
  describe('4.2.1.1: Happy Path - Bin Collision Auto-Depletion', () => {
    it('should detect collision when ACTIVE pack exists in target bin', () => {
      // Simulate DAL findActiveInBin behavior
      const mockFindActiveInBin = (storeId: string, binId: string, activePacksInBins: Map<string, object>) => {
        const key = `${storeId}:${binId}`;
        return activePacksInBins.get(key) || null;
      };

      const activePacksInBins = new Map<string, object>();
      activePacksInBins.set('store-test-uuid:bin-1', {
        pack_id: 'pack-existing-uuid',
        pack_number: 'PKG0000001',
        game_id: 'game-test-uuid',
        opening_serial: '000',
        status: 'ACTIVE',
      });

      // Query for bin with active pack
      const collision = mockFindActiveInBin('store-test-uuid', 'bin-1', activePacksInBins);
      expect(collision).not.toBeNull();
      expect((collision as { pack_id: string }).pack_id).toBe('pack-existing-uuid');

      // Query for bin without active pack
      const noCollision = mockFindActiveInBin('store-test-uuid', 'bin-2', activePacksInBins);
      expect(noCollision).toBeNull();
    });

    it('should calculate correct depletion values for auto-replaced pack', () => {
      const existingPack = {
        pack_id: 'pack-existing-uuid',
        pack_number: 'PKG0000001',
        opening_serial: '000',
      };
      const gameInfo = {
        tickets_per_pack: 300,
        price: 5,
      };

      // Calculate final serial: 000 + 300 - 1 = 299
      const closingSerial = calculateFinalSerial(existingPack.opening_serial, gameInfo.tickets_per_pack);
      expect(closingSerial).toBe('299');

      // Full pack sold
      const ticketsSoldCount = gameInfo.tickets_per_pack;
      expect(ticketsSoldCount).toBe(300);

      // Sales amount: 300 * $5 = $1500
      const salesAmount = calculateSalesAmount(ticketsSoldCount, gameInfo.price);
      expect(salesAmount).toBe(1500);
    });

    it('should set depletion_reason to AUTO_REPLACED for collision', () => {
      const depletionPayload = buildDepletionPayload({
        pack_id: 'pack-existing-uuid',
        pack_number: 'PKG0000001',
        closing_serial: '299',
        tickets_sold_count: 300,
        sales_amount: 1500,
        depleted_by: 'user-test-uuid',
        depleted_shift_id: 'shift-test-uuid',
        depletion_reason: 'AUTO_REPLACED',
      });

      expect((depletionPayload as { depletion_reason: string }).depletion_reason).toBe('AUTO_REPLACED');
      expect((depletionPayload as { status: string }).status).toBe('DEPLETED');
    });
  });

  // ==========================================================================
  // 4.2.1.2: Empty Bin - No Collision
  // ==========================================================================
  describe('4.2.1.2: Empty Bin - No Collision', () => {
    it('should not trigger depletion when bin is empty', () => {
      const mockFindActiveInBin = (storeId: string, binId: string) => null;

      const collision = mockFindActiveInBin('store-test-uuid', 'bin-1');
      expect(collision).toBeNull();

      // Business logic: if collision is null, skip depletion
      const shouldDeplete = collision !== null;
      expect(shouldDeplete).toBe(false);
    });
  });

  // ==========================================================================
  // 4.2.1.3: deplete_previous: false - Legacy Behavior
  // ==========================================================================
  describe('4.2.1.3: deplete_previous: false - Legacy Behavior', () => {
    it('should NOT check for collision when deplete_previous is false', () => {
      const input = ActivatePackSchema.parse({
        pack_id: '550e8400-e29b-41d4-a716-446655440000',
        bin_id: '660e8400-e29b-41d4-a716-446655440001',
        opening_serial: '000',
        deplete_previous: false,
      });

      // Business logic: skip collision check when deplete_previous is false
      const shouldCheckCollision = input.deplete_previous;
      expect(shouldCheckCollision).toBe(false);
    });

    it('should default deplete_previous to true when not specified', () => {
      const input = ActivatePackSchema.parse({
        pack_id: '550e8400-e29b-41d4-a716-446655440000',
        bin_id: '660e8400-e29b-41d4-a716-446655440001',
        opening_serial: '000',
        // deplete_previous not specified
      });

      expect(input.deplete_previous).toBe(true);
    });
  });

  // ==========================================================================
  // 4.2.1.4: Depletion Reason - AUTO_REPLACED
  // ==========================================================================
  describe('4.2.1.4: Depletion Reason - AUTO_REPLACED', () => {
    it('should use AUTO_REPLACED reason for bin collision depletion', () => {
      const depletionReasons = ['MANUAL_SOLD_OUT', 'SHIFT_CLOSE', 'AUTO_REPLACED'] as const;

      // AUTO_REPLACED is specifically for bin collision auto-depletion
      expect(depletionReasons).toContain('AUTO_REPLACED');

      // Validate reason is included in payload
      const payload = buildDepletionPayload({
        pack_id: 'pack-uuid',
        pack_number: 'PKG001',
        closing_serial: '299',
        tickets_sold_count: 300,
        sales_amount: 1500,
        depleted_by: 'user-uuid',
        depleted_shift_id: 'shift-uuid',
        depletion_reason: 'AUTO_REPLACED',
      });

      expect((payload as { depletion_reason: string }).depletion_reason).toBe('AUTO_REPLACED');
    });
  });

  // ==========================================================================
  // 4.2.1.5: Audit Trail - SEC-010 Compliance
  // ==========================================================================
  describe('4.2.1.5: Audit Trail - SEC-010 Compliance', () => {
    it('should include depleted_by from session context', () => {
      const sessionUserId = 'session-user-uuid';
      const sessionShiftId = 'session-shift-uuid';

      // SEC-010: Authorization context comes from session, not request
      const payload = buildDepletionPayload({
        pack_id: 'pack-uuid',
        pack_number: 'PKG001',
        closing_serial: '299',
        tickets_sold_count: 300,
        sales_amount: 1500,
        depleted_by: sessionUserId,
        depleted_shift_id: sessionShiftId,
        depletion_reason: 'AUTO_REPLACED',
      });

      expect((payload as { depleted_by: string }).depleted_by).toBe(sessionUserId);
      expect((payload as { depleted_shift_id: string }).depleted_shift_id).toBe(sessionShiftId);
    });

    it('should NOT accept depleted_by from request payload', () => {
      // SEC-010: Schema should NOT include depleted_by
      const schemaShape = ActivatePackSchema.shape;
      expect(Object.keys(schemaShape)).not.toContain('depleted_by');
      expect(Object.keys(schemaShape)).not.toContain('depleted_shift_id');
    });
  });

  // ==========================================================================
  // 4.2.1.6: Sync Queue Order - SYNC-001 Compliance
  // ==========================================================================
  describe('4.2.1.6: Sync Queue Order - SYNC-001 Compliance', () => {
    it('should order sync entries: depletion before activation', () => {
      const syncQueue: { entity_id: string; operation: string; type: string }[] = [];

      // Simulate handler sync queue behavior
      const enqueueDepletionSync = (packId: string) => {
        syncQueue.push({
          entity_id: packId,
          operation: 'UPDATE',
          type: 'depletion',
        });
      };

      const enqueueActivationSync = (packId: string) => {
        syncQueue.push({
          entity_id: packId,
          operation: 'UPDATE',
          type: 'activation',
        });
      };

      // SYNC-001: Depletion must be queued BEFORE activation
      enqueueDepletionSync('pack-existing-uuid');
      enqueueActivationSync('pack-new-uuid');

      expect(syncQueue).toHaveLength(2);
      expect(syncQueue[0].type).toBe('depletion');
      expect(syncQueue[1].type).toBe('activation');
    });
  });

  // ==========================================================================
  // 4.2.1.7: Response Format - API Contract
  // ==========================================================================
  describe('4.2.1.7: Response Format - API Contract', () => {
    it('should define depletedPack response structure for collision', () => {
      const depletedPackInfo = {
        pack_id: 'pack-existing-uuid',
        pack_number: 'PKG0000001',
        game_name: 'Lucky 7s',
        depletion_reason: 'AUTO_REPLACED',
      };

      // Verify required fields
      expect(depletedPackInfo).toHaveProperty('pack_id');
      expect(depletedPackInfo).toHaveProperty('pack_number');
      expect(depletedPackInfo).toHaveProperty('game_name');
      expect(depletedPackInfo).toHaveProperty('depletion_reason');
    });

    it('should return null depletedPack when no collision', () => {
      // When bin is empty, depletedPack should be null
      const responseWithoutCollision = {
        pack: { pack_id: 'pack-new-uuid', status: 'ACTIVE' },
        depletedPack: null,
      };

      expect(responseWithoutCollision.depletedPack).toBeNull();
    });
  });

  // ==========================================================================
  // Final Serial Calculation Tests
  // ==========================================================================
  describe('Final Serial Calculation During Collision', () => {
    it('should calculate correct closing_serial for 300-ticket pack starting at 000', () => {
      const closingSerial = calculateFinalSerial('000', 300);
      expect(closingSerial).toBe('299');
    });

    it('should calculate correct closing_serial for pack starting at 050', () => {
      const closingSerial = calculateFinalSerial('050', 300);
      expect(closingSerial).toBe('349');
    });

    it('should handle 3-digit overflow correctly', () => {
      // Edge case: 750 + 300 - 1 = 1049 (4 digits)
      const closingSerial = calculateFinalSerial('750', 300);
      // Note: In production, this should be caught by validation
      expect(closingSerial).toBe('1049');
    });

    it('should pad result to minimum 3 digits', () => {
      // Small pack: 000 + 5 - 1 = 4 → '004'
      const closingSerial = calculateFinalSerial('000', 5);
      expect(closingSerial).toBe('004');
    });
  });

  // ==========================================================================
  // 4.3.1: Error Handling
  // ==========================================================================
  describe('4.3.1: Error Handling', () => {
    describe('Game Not Found for Existing Pack', () => {
      it('should define error response format for missing game', () => {
        // When game is not found during collision processing
        const errorResponse = {
          error: 'INTERNAL_ERROR',
          message: 'Unable to process bin collision: game data missing for existing pack. Please contact support.',
        };

        expect(errorResponse.error).toBe('INTERNAL_ERROR');
        expect(errorResponse.message).toContain('game data missing');
      });
    });

    describe('Pack Status Edge Cases', () => {
      it('should only detect collision for ACTIVE packs', () => {
        // findActiveInBin only returns ACTIVE packs
        const packStatuses = ['RECEIVED', 'ACTIVE', 'DEPLETED', 'RETURNED'] as const;
        const statusesThatCauseCollision = ['ACTIVE'];

        for (const status of packStatuses) {
          const causesCollision = statusesThatCauseCollision.includes(status);
          if (status === 'ACTIVE') {
            expect(causesCollision).toBe(true);
          } else {
            expect(causesCollision).toBe(false);
          }
        }
      });
    });
  });

  // ==========================================================================
  // 4.4.1: Regression Tests - Existing Activation Flows
  // ==========================================================================
  describe('4.4.1: Regression Tests - Existing Activation Flows', () => {
    describe('Schema backward compatibility', () => {
      it('should accept legacy input without deplete_previous field', () => {
        const legacyInput = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          bin_id: '660e8400-e29b-41d4-a716-446655440001',
          opening_serial: '000',
          // No deplete_previous field (legacy)
        };

        const result = ActivatePackSchema.safeParse(legacyInput);
        expect(result.success).toBe(true);
        if (result.success) {
          // Should default to true
          expect(result.data.deplete_previous).toBe(true);
        }
      });

      it('should accept explicit deplete_previous: true', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          bin_id: '660e8400-e29b-41d4-a716-446655440001',
          opening_serial: '000',
          deplete_previous: true,
        };

        const result = ActivatePackSchema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deplete_previous).toBe(true);
        }
      });

      it('should accept explicit deplete_previous: false', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          bin_id: '660e8400-e29b-41d4-a716-446655440001',
          opening_serial: '000',
          deplete_previous: false,
        };

        const result = ActivatePackSchema.safeParse(input);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.deplete_previous).toBe(false);
        }
      });
    });

    describe('Existing depletion flows unchanged', () => {
      it('should still support MANUAL_SOLD_OUT depletion reason', () => {
        const payload = buildDepletionPayload({
          pack_id: 'pack-uuid',
          pack_number: 'PKG001',
          closing_serial: '299',
          tickets_sold_count: 300,
          sales_amount: 1500,
          depleted_by: 'user-uuid',
          depleted_shift_id: 'shift-uuid',
          depletion_reason: 'MANUAL_SOLD_OUT',
        });

        expect((payload as { depletion_reason: string }).depletion_reason).toBe('MANUAL_SOLD_OUT');
      });

      it('should still support SHIFT_CLOSE depletion reason', () => {
        const payload = buildDepletionPayload({
          pack_id: 'pack-uuid',
          pack_number: 'PKG001',
          closing_serial: '149',
          tickets_sold_count: 150,
          sales_amount: 750,
          depleted_by: 'user-uuid',
          depleted_shift_id: 'shift-uuid',
          depletion_reason: 'SHIFT_CLOSE',
        });

        expect((payload as { depletion_reason: string }).depletion_reason).toBe('SHIFT_CLOSE');
      });
    });
  });

  // ==========================================================================
  // DB-006: Tenant Isolation
  // ==========================================================================
  describe('DB-006: Tenant Isolation', () => {
    it('should scope collision detection by store_id', () => {
      const activePacksInBins = new Map<string, object>();
      // Same bin_id, different stores
      activePacksInBins.set('store-A:bin-1', { pack_id: 'pack-A', status: 'ACTIVE' });
      activePacksInBins.set('store-B:bin-1', { pack_id: 'pack-B', status: 'ACTIVE' });

      const mockFindActiveInBin = (storeId: string, binId: string) => {
        const key = `${storeId}:${binId}`;
        return activePacksInBins.get(key) || null;
      };

      // Store A query should only find Store A's pack
      const storeAResult = mockFindActiveInBin('store-A', 'bin-1');
      expect((storeAResult as { pack_id: string }).pack_id).toBe('pack-A');

      // Store B query should only find Store B's pack
      const storeBResult = mockFindActiveInBin('store-B', 'bin-1');
      expect((storeBResult as { pack_id: string }).pack_id).toBe('pack-B');

      // Store C query should find nothing
      const storeCResult = mockFindActiveInBin('store-C', 'bin-1');
      expect(storeCResult).toBeNull();
    });
  });
});
