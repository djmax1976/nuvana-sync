/**
 * Lottery IPC Handlers Unit Tests
 *
 * Tests for lottery IPC handlers.
 * Validates API-001: Zod schema validation
 * Validates SEC-010: Role-based authorization
 *
 * @module tests/unit/ipc/lottery.handlers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { z } from 'zod';

// Mock the DALs
vi.mock('../../../src/main/dal/lottery-games.dal', () => ({
  lotteryGamesDAL: {
    findActiveByStore: vi.fn(),
    findByGameCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/lottery-bins.dal', () => ({
  lotteryBinsDAL: {
    findActiveByStore: vi.fn(),
    findBinsWithPacks: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/lottery-packs.dal', () => ({
  lotteryPacksDAL: {
    receive: vi.fn(),
    activate: vi.fn(),
    settle: vi.fn(),
    returnPack: vi.fn(),
    findWithFilters: vi.fn(),
    getActivatedPacksForDayClose: vi.fn(),
  },
}));

vi.mock('../../../src/main/dal/lottery-business-days.dal', () => ({
  lotteryBusinessDaysDAL: {
    getOrCreateForDate: vi.fn(),
    findOpenDay: vi.fn(),
    prepareClose: vi.fn(),
    commitClose: vi.fn(),
    cancelClose: vi.fn(),
  },
}));

vi.mock('../../../src/main/services/scanner.service', () => ({
  parseBarcode: vi.fn(),
  validateBarcode: vi.fn(),
}));

vi.mock('../../../src/main/services/session.service', () => ({
  sessionService: {
    getCurrentSession: vi.fn(),
    hasMinimumRole: vi.fn(),
  },
}));

vi.mock('../../../src/main/services/config.service', () => ({
  configService: {
    getStoreId: vi.fn().mockReturnValue('store-1'),
  },
}));

describe('Lottery IPC Handlers', () => {
  // Import mocked modules
  let lotteryGamesDAL: {
    findActiveByStore: ReturnType<typeof vi.fn>;
    findByGameCode: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let lotteryBinsDAL: {
    findActiveByStore: ReturnType<typeof vi.fn>;
    findBinsWithPacks: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let lotteryPacksDAL: {
    receive: ReturnType<typeof vi.fn>;
    activate: ReturnType<typeof vi.fn>;
    settle: ReturnType<typeof vi.fn>;
    returnPack: ReturnType<typeof vi.fn>;
    findWithFilters: ReturnType<typeof vi.fn>;
    getActivatedPacksForDayClose: ReturnType<typeof vi.fn>;
  };
  let lotteryBusinessDaysDAL: {
    getOrCreateForDate: ReturnType<typeof vi.fn>;
    findOpenDay: ReturnType<typeof vi.fn>;
    prepareClose: ReturnType<typeof vi.fn>;
    commitClose: ReturnType<typeof vi.fn>;
    cancelClose: ReturnType<typeof vi.fn>;
  };
  let scannerService: {
    parseBarcode: ReturnType<typeof vi.fn>;
    validateBarcode: ReturnType<typeof vi.fn>;
  };
  let sessionService: {
    getCurrentSession: ReturnType<typeof vi.fn>;
    hasMinimumRole: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Get mocked modules
    const gamesModule = await import('../../../src/main/dal/lottery-games.dal');
    const binsModule = await import('../../../src/main/dal/lottery-bins.dal');
    const packsModule = await import('../../../src/main/dal/lottery-packs.dal');
    const daysModule = await import('../../../src/main/dal/lottery-business-days.dal');
    const scannerModule = await import('../../../src/main/services/scanner.service');
    const sessionModule = await import('../../../src/main/services/session.service');

    lotteryGamesDAL = gamesModule.lotteryGamesDAL as unknown as typeof lotteryGamesDAL;
    lotteryBinsDAL = binsModule.lotteryBinsDAL as unknown as typeof lotteryBinsDAL;
    lotteryPacksDAL = packsModule.lotteryPacksDAL as unknown as typeof lotteryPacksDAL;
    lotteryBusinessDaysDAL = daysModule.lotteryBusinessDaysDAL as unknown as typeof lotteryBusinessDaysDAL;
    scannerService = scannerModule as unknown as typeof scannerService;
    sessionService = sessionModule.sessionService as unknown as typeof sessionService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Input Validation Schemas (API-001)', () => {
    describe('ReceivePackInputSchema', () => {
      const ReceivePackInputSchema = z.object({
        game_id: z.string().uuid(),
        pack_number: z.string().min(1).max(20),
        serialized_number: z.string().regex(/^\d{24}$/),
      });

      it('should accept valid input', () => {
        const input = {
          game_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: 'PKG1234567',
          serialized_number: '100112345670001234567890',
        };

        const result = ReceivePackInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject invalid game_id', () => {
        const input = {
          game_id: 'not-a-uuid',
          pack_number: 'PKG1234567',
          serialized_number: '100112345670001234567890',
        };

        const result = ReceivePackInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject empty pack_number', () => {
        const input = {
          game_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: '',
          serialized_number: '100112345670001234567890',
        };

        const result = ReceivePackInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject invalid serialized_number', () => {
        const input = {
          game_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: 'PKG1234567',
          serialized_number: '12345', // Too short
        };

        const result = ReceivePackInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject non-digit serialized_number', () => {
        const input = {
          game_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: 'PKG1234567',
          serialized_number: '1001ABC45670001234567890', // Contains letters
        };

        const result = ReceivePackInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('ActivatePackInputSchema', () => {
      const ActivatePackInputSchema = z.object({
        pack_id: z.string().uuid(),
        bin_id: z.string().uuid(),
        opening_serial: z.string().regex(/^\d{3}$/),
      });

      it('should accept valid input', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          bin_id: '660e8400-e29b-41d4-a716-446655440001',
          opening_serial: '000',
        };

        const result = ActivatePackInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject invalid opening_serial', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          bin_id: '660e8400-e29b-41d4-a716-446655440001',
          opening_serial: '00', // Too short
        };

        const result = ActivatePackInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject 4-digit opening_serial', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          bin_id: '660e8400-e29b-41d4-a716-446655440001',
          opening_serial: '0000', // Too long
        };

        const result = ActivatePackInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('DepletePackInputSchema', () => {
      const DepletePackInputSchema = z.object({
        pack_id: z.string().uuid(),
        closing_serial: z.string().regex(/^\d{3}$/),
      });

      it('should accept valid input', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          closing_serial: '150',
        };

        const result = DepletePackInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept max serial 299', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          closing_serial: '299',
        };

        const result = DepletePackInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });
    });

    describe('ReturnPackInputSchema', () => {
      const ReturnPackInputSchema = z.object({
        pack_id: z.string().uuid(),
        return_reason: z.string().min(1).max(100),
        notes: z.string().max(500).optional(),
      });

      it('should accept valid input with notes', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          return_reason: 'DAMAGED',
          notes: 'Box was crushed during shipping',
        };

        const result = ReturnPackInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept valid input without notes', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          return_reason: 'SUPPLIER_RECALL',
        };

        const result = ReturnPackInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject empty return_reason', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          return_reason: '',
        };

        const result = ReturnPackInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('PrepareDayCloseInputSchema', () => {
      const ClosingItemSchema = z.object({
        pack_id: z.string().uuid(),
        closing_serial: z.string().regex(/^\d{3}$/),
        is_sold_out: z.boolean().optional(),
      });

      const PrepareDayCloseInputSchema = z.object({
        closings: z.array(ClosingItemSchema).min(1),
      });

      it('should accept valid input', () => {
        const input = {
          closings: [
            { pack_id: '550e8400-e29b-41d4-a716-446655440000', closing_serial: '150' },
            { pack_id: '660e8400-e29b-41d4-a716-446655440001', closing_serial: '200' },
          ],
        };

        const result = PrepareDayCloseInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept sold out flag', () => {
        const input = {
          closings: [
            { pack_id: '550e8400-e29b-41d4-a716-446655440000', closing_serial: '299', is_sold_out: true },
          ],
        };

        const result = PrepareDayCloseInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject empty closings array', () => {
        const input = {
          closings: [],
        };

        const result = PrepareDayCloseInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    describe('PackFiltersSchema', () => {
      const PackFiltersSchema = z.object({
        status: z.enum(['RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED']).optional(),
        game_id: z.string().uuid().optional(),
        search: z.string().min(2).max(50).optional(),
      });

      it('should accept empty filters', () => {
        const input = {};

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept status filter', () => {
        const input = { status: 'ACTIVATED' };

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject invalid status', () => {
        const input = { status: 'INVALID' };

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject too short search', () => {
        const input = { search: 'a' }; // Min 2 chars

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });
  });

  describe('Role-Based Authorization (SEC-010)', () => {
    const mockSession = {
      user_id: 'user-123',
      store_id: 'store-1',
      role: 'CASHIER',
      username: 'testuser',
      loginAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    };

    it('should allow CASHIER to receive packs', () => {
      sessionService.getCurrentSession.mockReturnValue(mockSession);
      sessionService.hasMinimumRole.mockImplementation((role: string) => {
        const roles = ['CASHIER', 'MANAGER', 'OWNER'];
        const sessionRoleIndex = roles.indexOf(mockSession.role);
        const requiredRoleIndex = roles.indexOf(role);
        return sessionRoleIndex >= requiredRoleIndex;
      });

      expect(sessionService.hasMinimumRole('CASHIER')).toBe(true);
    });

    it('should allow CASHIER to activate packs', () => {
      sessionService.getCurrentSession.mockReturnValue(mockSession);
      sessionService.hasMinimumRole.mockImplementation((role: string) => {
        const roles = ['CASHIER', 'MANAGER', 'OWNER'];
        const sessionRoleIndex = roles.indexOf(mockSession.role);
        const requiredRoleIndex = roles.indexOf(role);
        return sessionRoleIndex >= requiredRoleIndex;
      });

      expect(sessionService.hasMinimumRole('CASHIER')).toBe(true);
    });

    it('should deny CASHIER from returning packs (requires MANAGER)', () => {
      sessionService.getCurrentSession.mockReturnValue(mockSession);
      sessionService.hasMinimumRole.mockImplementation((role: string) => {
        const roles = ['CASHIER', 'MANAGER', 'OWNER'];
        const sessionRoleIndex = roles.indexOf(mockSession.role);
        const requiredRoleIndex = roles.indexOf(role);
        return sessionRoleIndex >= requiredRoleIndex;
      });

      expect(sessionService.hasMinimumRole('MANAGER')).toBe(false);
    });

    it('should deny CASHIER from day close operations (requires MANAGER)', () => {
      sessionService.getCurrentSession.mockReturnValue(mockSession);
      sessionService.hasMinimumRole.mockImplementation((role: string) => {
        const roles = ['CASHIER', 'MANAGER', 'OWNER'];
        const sessionRoleIndex = roles.indexOf(mockSession.role);
        const requiredRoleIndex = roles.indexOf(role);
        return sessionRoleIndex >= requiredRoleIndex;
      });

      expect(sessionService.hasMinimumRole('MANAGER')).toBe(false);
    });

    it('should allow MANAGER to return packs', () => {
      const managerSession = { ...mockSession, role: 'MANAGER' };
      sessionService.getCurrentSession.mockReturnValue(managerSession);
      sessionService.hasMinimumRole.mockImplementation((role: string) => {
        const roles = ['CASHIER', 'MANAGER', 'OWNER'];
        const sessionRoleIndex = roles.indexOf(managerSession.role);
        const requiredRoleIndex = roles.indexOf(role);
        return sessionRoleIndex >= requiredRoleIndex;
      });

      expect(sessionService.hasMinimumRole('MANAGER')).toBe(true);
    });

    it('should allow MANAGER to perform day close', () => {
      const managerSession = { ...mockSession, role: 'MANAGER' };
      sessionService.getCurrentSession.mockReturnValue(managerSession);
      sessionService.hasMinimumRole.mockImplementation((role: string) => {
        const roles = ['CASHIER', 'MANAGER', 'OWNER'];
        const sessionRoleIndex = roles.indexOf(managerSession.role);
        const requiredRoleIndex = roles.indexOf(role);
        return sessionRoleIndex >= requiredRoleIndex;
      });

      expect(sessionService.hasMinimumRole('MANAGER')).toBe(true);
    });

    it('should allow OWNER to perform all operations', () => {
      const ownerSession = { ...mockSession, role: 'OWNER' };
      sessionService.getCurrentSession.mockReturnValue(ownerSession);
      sessionService.hasMinimumRole.mockImplementation((role: string) => {
        const roles = ['CASHIER', 'MANAGER', 'OWNER'];
        const sessionRoleIndex = roles.indexOf(ownerSession.role);
        const requiredRoleIndex = roles.indexOf(role);
        return sessionRoleIndex >= requiredRoleIndex;
      });

      expect(sessionService.hasMinimumRole('CASHIER')).toBe(true);
      expect(sessionService.hasMinimumRole('MANAGER')).toBe(true);
      expect(sessionService.hasMinimumRole('OWNER')).toBe(true);
    });
  });

  describe('Barcode Parsing', () => {
    it('should parse valid barcode', () => {
      const mockParsed = {
        raw: '100112345670001234567890',
        game_code: '1001',
        pack_number: '1234567',
        serial_number: '000',
        check_digit: '1234567890',
        checksum_valid: true,
        full_serial: '10011234567',
      };

      scannerService.parseBarcode.mockReturnValue(mockParsed);

      const result = scannerService.parseBarcode('100112345670001234567890');

      expect(result).toEqual(mockParsed);
      expect(result.game_code).toBe('1001');
      expect(result.pack_number).toBe('1234567');
    });

    it('should return null for invalid barcode', () => {
      scannerService.parseBarcode.mockReturnValue(null);

      const result = scannerService.parseBarcode('invalid');

      expect(result).toBeNull();
    });
  });

  describe('DAL Integration', () => {
    it('should call lotteryGamesDAL.findActiveByStore for getGames', () => {
      const mockGames = [
        { game_id: 'game-1', game_code: '1001', name: 'Lucky 7s', price: 1 },
        { game_id: 'game-2', game_code: '1002', name: 'Cash Explosion', price: 2 },
      ];

      lotteryGamesDAL.findActiveByStore.mockReturnValue(mockGames);

      const result = lotteryGamesDAL.findActiveByStore('store-1');

      expect(lotteryGamesDAL.findActiveByStore).toHaveBeenCalledWith('store-1');
      expect(result).toEqual(mockGames);
    });

    it('should call lotteryBinsDAL.findBinsWithPacks for getBins', () => {
      const mockBins = [
        { bin_id: 'bin-1', bin_number: 1, pack_id: 'pack-1', game_name: 'Lucky 7s' },
        { bin_id: 'bin-2', bin_number: 2, pack_id: null, game_name: null },
      ];

      lotteryBinsDAL.findBinsWithPacks.mockReturnValue(mockBins);

      const result = lotteryBinsDAL.findBinsWithPacks('store-1');

      expect(lotteryBinsDAL.findBinsWithPacks).toHaveBeenCalledWith('store-1');
      expect(result).toEqual(mockBins);
    });

    it('should call lotteryPacksDAL.receive for receivePack', () => {
      const mockPack = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
        status: 'RECEIVED',
      };

      lotteryPacksDAL.receive.mockReturnValue(mockPack);

      const data = {
        store_id: 'store-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
        serialized_number: '100112345670001234567890',
      };

      const result = lotteryPacksDAL.receive(data);

      expect(lotteryPacksDAL.receive).toHaveBeenCalledWith(data);
      expect(result).toEqual(mockPack);
    });

    it('should call lotteryPacksDAL.activate for activatePack', () => {
      const mockPack = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: 'PKG1234567',
        status: 'ACTIVATED',
        bin_id: 'bin-1',
        opening_serial: '000',
      };

      lotteryPacksDAL.activate.mockReturnValue(mockPack);

      const result = lotteryPacksDAL.activate('pack-1', { bin_id: 'bin-1', opening_serial: '000' });

      expect(lotteryPacksDAL.activate).toHaveBeenCalled();
      expect(result).toEqual(mockPack);
    });

    it('should call lotteryBusinessDaysDAL.prepareClose for day close', () => {
      const mockResult = {
        day_id: 'day-1',
        status: 'PENDING_CLOSE',
        closings_count: 2,
        estimated_lottery_total: 300,
      };

      lotteryBusinessDaysDAL.prepareClose.mockReturnValue(mockResult);

      const closings = [
        { pack_id: 'pack-1', closing_serial: '150' },
        { pack_id: 'pack-2', closing_serial: '150' },
      ];

      const result = lotteryBusinessDaysDAL.prepareClose('day-1', closings);

      expect(lotteryBusinessDaysDAL.prepareClose).toHaveBeenCalledWith('day-1', closings);
      expect(result).toEqual(mockResult);
    });
  });
});
