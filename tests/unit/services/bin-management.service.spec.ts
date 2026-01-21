/**
 * Bin Management Service Unit Tests
 *
 * Tests for lottery bin management functionality.
 * Validates SEC-014: Input validation
 * Validates DB-006: Store-scoped operations
 *
 * @module tests/unit/services/bin-management
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock storesDAL
vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: {
    getConfiguredStore: vi.fn(),
  },
}));

// Mock lotteryBinsDAL
vi.mock('../../../src/main/dal/lottery-bins.dal', () => ({
  lotteryBinsDAL: {
    findActiveByStore: vi.fn(),
    findAllByStore: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    getPackCount: vi.fn(),
    getNextDisplayOrder: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    bulkCreate: vi.fn(),
  },
}));

// Mock lotteryPacksDAL
vi.mock('../../../src/main/dal/lottery-packs.dal', () => ({
  lotteryPacksDAL: {
    findPacksWithDetails: vi.fn(),
  },
}));

// Mock syncQueueDAL
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn(),
  },
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

import { BinManagementService } from '../../../src/main/services/bin-management.service';
import { storesDAL } from '../../../src/main/dal/stores.dal';
import { lotteryBinsDAL, type LotteryBin } from '../../../src/main/dal/lottery-bins.dal';
import { lotteryPacksDAL } from '../../../src/main/dal/lottery-packs.dal';
import { syncQueueDAL } from '../../../src/main/dal/sync-queue.dal';

describe('BinManagementService', () => {
  let service: BinManagementService;

  // Mock store
  const mockStore = {
    store_id: 'store-123',
    company_id: 'company-456',
    name: 'Test Store',
    timezone: 'America/New_York',
    status: 'ACTIVE' as const,
    state_id: null,
    state_code: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Mock bin - using valid UUID format for bin_id
  // After v037 migration: bin_id IS the cloud's UUID (no separate cloud_bin_id)
  const mockBin: LotteryBin = {
    bin_id: '550e8400-e29b-41d4-a716-446655440001',
    store_id: 'store-123',
    name: 'Bin 1',
    location: null,
    display_order: 1,
    is_active: 1,
    deleted_at: null,
    synced_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new BinManagementService();
    vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(mockStore);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getBins', () => {
    it('should return empty array when no store configured', () => {
      vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(undefined);

      const bins = service.getBins();

      expect(bins).toEqual([]);
    });

    it('should return bins with pack details', () => {
      vi.mocked(lotteryBinsDAL.findActiveByStore).mockReturnValue([mockBin]);
      vi.mocked(lotteryBinsDAL.getPackCount).mockReturnValue(0);
      vi.mocked(lotteryPacksDAL.findPacksWithDetails).mockReturnValue([]);

      const bins = service.getBins();

      expect(bins).toHaveLength(1);
      expect(bins[0].bin_id).toBe(mockBin.bin_id);
      expect(bins[0].packCount).toBe(0);
      expect(bins[0].packs).toEqual([]);
    });
  });

  describe('createBin', () => {
    it('should reject empty bin name', () => {
      const result = service.createBin({ name: '' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject bin name exceeding max length', () => {
      const result = service.createBin({ name: 'a'.repeat(51) });

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot exceed');
    });

    it('should reject bin name with invalid characters', () => {
      const result = service.createBin({ name: 'Bin <script>' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('can only contain');
    });

    it('should fail when no store configured', () => {
      vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(undefined);

      const result = service.createBin({ name: 'New Bin' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Store not configured');
    });

    it('should create bin with valid data', () => {
      vi.mocked(lotteryBinsDAL.getNextDisplayOrder).mockReturnValue(2);
      vi.mocked(lotteryBinsDAL.create).mockReturnValue({
        ...mockBin,
        bin_id: 'bin-002',
        display_order: 2,
        name: 'Counter Front',
      });

      const result = service.createBin({ name: 'Counter Front' });

      expect(result.success).toBe(true);
      expect(result.bin?.name).toBe('Counter Front');
      expect(lotteryBinsDAL.create).toHaveBeenCalled();
      // Note: Bins are pull-only from cloud, so no sync enqueue
      expect(syncQueueDAL.enqueue).not.toHaveBeenCalled();
    });

    it('should NOT enqueue create operation for sync (bins are pull-only)', () => {
      // Bins are pulled from cloud, not pushed - no sync queue needed
      vi.mocked(lotteryBinsDAL.getNextDisplayOrder).mockReturnValue(1);
      vi.mocked(lotteryBinsDAL.create).mockReturnValue(mockBin);

      service.createBin({ name: 'New Bin' });

      // Bins are pull-only from cloud per API spec - no push endpoint
      expect(syncQueueDAL.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('updateBin', () => {
    it('should reject invalid bin ID format', () => {
      const result = service.updateBin('not-a-uuid', { name: 'Updated' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid bin ID');
    });

    it('should fail when bin not found', () => {
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue(undefined);

      const result = service.updateBin('550e8400-e29b-41d4-a716-446655440000', { name: 'Updated' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bin not found');
    });

    it('should update bin with valid data', () => {
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue(mockBin);
      vi.mocked(lotteryBinsDAL.update).mockReturnValue({
        ...mockBin,
        name: 'Updated Name',
      });

      const result = service.updateBin(mockBin.bin_id, { name: 'Updated Name' });

      expect(result.success).toBe(true);
      expect(result.bin?.name).toBe('Updated Name');
    });

    it('should NOT enqueue update operation for sync (bins are pull-only)', () => {
      // Bins are pulled from cloud, not pushed - no sync queue needed
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue(mockBin);
      vi.mocked(lotteryBinsDAL.update).mockReturnValue(mockBin);

      service.updateBin(mockBin.bin_id, { name: 'Updated' });

      // Bins are pull-only from cloud per API spec - no push endpoint
      expect(syncQueueDAL.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('deleteBin', () => {
    it('should reject invalid bin ID format', () => {
      const result = service.deleteBin('not-a-uuid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid bin ID');
    });

    it('should fail when bin not found', () => {
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue(undefined);

      const result = service.deleteBin('550e8400-e29b-41d4-a716-446655440000');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Bin not found');
    });

    it('should reject deletion of bin with active packs', () => {
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue(mockBin);
      vi.mocked(lotteryBinsDAL.getPackCount).mockReturnValue(3);

      const result = service.deleteBin(mockBin.bin_id);

      expect(result.success).toBe(false);
      expect(result.error).toContain('3 active pack');
      expect(result.error).toContain('Move or return packs first');
    });

    it('should delete empty bin', () => {
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue(mockBin);
      vi.mocked(lotteryBinsDAL.getPackCount).mockReturnValue(0);
      vi.mocked(lotteryBinsDAL.softDelete).mockReturnValue({ success: true });

      const result = service.deleteBin(mockBin.bin_id);

      expect(result.success).toBe(true);
      expect(lotteryBinsDAL.softDelete).toHaveBeenCalledWith(mockBin.bin_id);
    });

    it('should soft delete not hard delete', () => {
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue(mockBin);
      vi.mocked(lotteryBinsDAL.getPackCount).mockReturnValue(0);
      vi.mocked(lotteryBinsDAL.softDelete).mockReturnValue({ success: true });

      service.deleteBin(mockBin.bin_id);

      expect(lotteryBinsDAL.softDelete).toHaveBeenCalled();
    });

    it('should NOT enqueue delete operation for sync (bins are pull-only)', () => {
      // Bins are pulled from cloud, not pushed - no sync queue needed
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue(mockBin);
      vi.mocked(lotteryBinsDAL.getPackCount).mockReturnValue(0);
      vi.mocked(lotteryBinsDAL.softDelete).mockReturnValue({ success: true });

      service.deleteBin(mockBin.bin_id);

      // Bins are pull-only from cloud per API spec - no push endpoint
      expect(syncQueueDAL.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('reorderBins', () => {
    it('should reject empty bin array', () => {
      const result = service.reorderBins([]);

      expect(result.success).toBe(false);
      expect(result.error).toContain('At least one bin ID');
    });

    it('should reject invalid bin IDs', () => {
      const result = service.reorderBins(['not-a-uuid']);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');
    });

    it('should update display order for valid bins', () => {
      const binIds = [
        '550e8400-e29b-41d4-a716-446655440000',
        '550e8400-e29b-41d4-a716-446655440001',
      ];
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue({
        ...mockBin,
        store_id: mockStore.store_id,
      });

      const result = service.reorderBins(binIds);

      expect(result.success).toBe(true);
      expect(lotteryBinsDAL.update).toHaveBeenCalledTimes(2);
    });

    it('should only reorder bins from same store', () => {
      const binIds = ['550e8400-e29b-41d4-a716-446655440000'];
      vi.mocked(lotteryBinsDAL.findById).mockReturnValue({
        ...mockBin,
        store_id: 'different-store',
      });

      const result = service.reorderBins(binIds);

      expect(result.success).toBe(true);
      expect(lotteryBinsDAL.update).not.toHaveBeenCalled();
    });
  });

  describe('bulkCreateBins', () => {
    it('should reject count below minimum', () => {
      const result = service.bulkCreateBins(0);

      expect(result.success).toBe(false);
      expect(result.error).toContain('between 1 and 200');
    });

    it('should reject count above maximum', () => {
      const result = service.bulkCreateBins(201);

      expect(result.success).toBe(false);
      expect(result.error).toContain('between 1 and 200');
    });

    it('should fail when no store configured', () => {
      vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(undefined);

      const result = service.bulkCreateBins(10);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Store not configured');
    });

    it('should create multiple bins', () => {
      const mockBins = Array.from({ length: 5 }, (_, i) => ({
        ...mockBin,
        bin_id: `bin-00${i + 1}`,
        display_order: i + 1,
        name: `Bin ${i + 1}`,
      }));
      vi.mocked(lotteryBinsDAL.bulkCreate).mockReturnValue(mockBins);

      const result = service.bulkCreateBins(5);

      expect(result.success).toBe(true);
      expect(result.bins).toHaveLength(5);
      expect(lotteryBinsDAL.bulkCreate).toHaveBeenCalledWith(mockStore.store_id, 5);
    });

    it('should NOT enqueue bins for sync (bins are pull-only)', () => {
      // Bins are pulled from cloud, not pushed - no sync queue needed
      const mockBins = [mockBin];
      vi.mocked(lotteryBinsDAL.bulkCreate).mockReturnValue(mockBins);

      service.bulkCreateBins(1);

      // Bins are pull-only from cloud per API spec - no push endpoint
      expect(syncQueueDAL.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return zeroes when no store configured', () => {
      vi.mocked(storesDAL.getConfiguredStore).mockReturnValue(undefined);

      const stats = service.getStats();

      expect(stats.totalBins).toBe(0);
      expect(stats.activeBins).toBe(0);
      expect(stats.binsWithPacks).toBe(0);
      expect(stats.totalActivePacks).toBe(0);
    });

    it('should calculate correct statistics', () => {
      vi.mocked(lotteryBinsDAL.findAllByStore).mockReturnValue([
        mockBin,
        { ...mockBin, bin_id: 'bin-002' },
      ]);
      vi.mocked(lotteryBinsDAL.findActiveByStore).mockReturnValue([mockBin]);
      vi.mocked(lotteryBinsDAL.getPackCount).mockReturnValue(2);

      const stats = service.getStats();

      expect(stats.totalBins).toBe(2);
      expect(stats.activeBins).toBe(1);
      expect(stats.binsWithPacks).toBe(1);
      expect(stats.totalActivePacks).toBe(2);
    });
  });
});
