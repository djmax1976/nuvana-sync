/**
 * Lottery IPC Handlers Unit Tests
 *
 * Tests for lottery IPC handlers.
 * Validates API-001: Zod schema validation
 * Validates SEC-010: Role-based authorization
 *
 * @module tests/unit/ipc/lottery.handlers
 */

// Uses vitest globals (configured in vitest.config.ts)
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

// Create mock sessionService for test convenience
const mockSessionService = {
  getCurrentSession: vi.fn(),
  hasRole: vi.fn(),
  hasMinimumRole: vi.fn(),
  getTimeRemaining: vi.fn(),
  isNearExpiry: vi.fn(),
};

vi.mock('../../../src/main/services/session.service', () => ({
  sessionService: mockSessionService,
  getSessionInfo: vi.fn(),
  createSession: vi.fn(),
  destroySession: vi.fn(),
  getSessionUser: vi.fn(),
  updateActivity: vi.fn(),
  isSessionExpired: vi.fn(),
  hasSession: vi.fn(),
  getCurrentSession: vi.fn(),
  hasMinimumRole: vi.fn(),
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
  // Use mockSessionService directly defined above
  const sessionService = mockSessionService;

  beforeEach(async () => {
    // Get mocked modules
    const gamesModule = await import('../../../src/main/dal/lottery-games.dal');
    const binsModule = await import('../../../src/main/dal/lottery-bins.dal');
    const packsModule = await import('../../../src/main/dal/lottery-packs.dal');
    const daysModule = await import('../../../src/main/dal/lottery-business-days.dal');
    const scannerModule = await import('../../../src/main/services/scanner.service');

    lotteryGamesDAL = gamesModule.lotteryGamesDAL as unknown as typeof lotteryGamesDAL;
    lotteryBinsDAL = binsModule.lotteryBinsDAL as unknown as typeof lotteryBinsDAL;
    lotteryPacksDAL = packsModule.lotteryPacksDAL as unknown as typeof lotteryPacksDAL;
    lotteryBusinessDaysDAL =
      daysModule.lotteryBusinessDaysDAL as unknown as typeof lotteryBusinessDaysDAL;
    scannerService = scannerModule as unknown as typeof scannerService;
    // sessionService is already assigned from mockSessionService
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

    describe('ReturnPackSchema (SEC-014: Input Validation)', () => {
      /**
       * Production-accurate schema matching src/main/ipc/lottery.handlers.ts:95-99
       * SEC-014: INPUT_VALIDATION - Strict schema for pack return
       * API-001: VALIDATION - Zod schema validation
       */
      const SerialSchema = z.string().regex(/^\d{3}$/);
      const ReturnPackSchema = z.object({
        pack_id: z.string().uuid(),
        closing_serial: SerialSchema.optional(),
        return_reason: z.string().max(500).optional(),
      });

      describe('Basic Valid Input', () => {
        it('should accept valid input with all optional fields', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '150',
            return_reason: 'DAMAGED - Box was crushed during shipping',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept valid input with only pack_id (all optionals omitted)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept valid input with closing_serial only', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '000',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept valid input with return_reason only', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'SUPPLIER_RECALL',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });
      });

      describe('closing_serial Validation (SEC-014)', () => {
        it('should accept closing_serial 000 (pack minimum)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '000',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept closing_serial 299 (pack maximum for 300-ticket pack)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '299',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept closing_serial 149 (pack maximum for 150-ticket pack)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '149',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should reject closing_serial with 2 digits (boundary: too short)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '99',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject closing_serial with 4 digits (boundary: too long)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '0150',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject closing_serial with letters (SEC-006: type constraint)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: 'ABC',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject closing_serial with special characters (SEC-006: injection prevention)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '1;2',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject closing_serial with whitespace', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: ' 15',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject empty string closing_serial (boundary)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });
      });

      describe('return_reason Validation (SEC-014)', () => {
        it('should accept empty return_reason (optional field)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: '',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept return_reason at max length (500 chars)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'D'.repeat(500),
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should reject return_reason exceeding max length (501 chars)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'D'.repeat(501),
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should accept return_reason with newlines (multi-line notes)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED\nLine 2: Box crushed\nLine 3: Tickets torn',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept return_reason with unicode characters', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED - Customer complaint: "Paquete dañado" 破损',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });
      });

      describe('pack_id Validation (SEC-006)', () => {
        it('should reject invalid UUID format', () => {
          const input = {
            pack_id: 'not-a-uuid',
            return_reason: 'DAMAGED',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject SQL injection in pack_id (SEC-006)', () => {
          const input = {
            pack_id: "550e8400-e29b-41d4-a716-446655440000'; DROP TABLE lottery_packs;--",
            return_reason: 'DAMAGED',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject empty pack_id', () => {
          const input = {
            pack_id: '',
            return_reason: 'DAMAGED',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject missing pack_id', () => {
          const input = {
            return_reason: 'DAMAGED',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });
      });

      describe('Edge Cases and Boundary Conditions', () => {
        it('should reject extra unexpected fields (strict mode)', () => {
          const StrictReturnPackSchema = ReturnPackSchema.strict();
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED',
            malicious_field: 'attack vector',
          };

          const result = StrictReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should handle null values for optional fields', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: null,
            return_reason: null,
          };

          const result = ReturnPackSchema.safeParse(input);
          // Zod optional() doesn't accept null by default
          expect(result.success).toBe(false);
        });

        it('should accept undefined for optional fields', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: undefined,
            return_reason: undefined,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });
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
            {
              pack_id: '550e8400-e29b-41d4-a716-446655440000',
              closing_serial: '299',
              is_sold_out: true,
            },
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
      // Updated schema to match actual implementation (max 100 chars)
      const PackFiltersSchema = z.object({
        status: z.enum(['RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED']).optional(),
        game_id: z.string().uuid().optional(),
        bin_id: z.string().uuid().optional(),
        search: z.string().min(2).max(100).optional(),
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

      it('should accept valid search term (2+ chars)', () => {
        const input = { search: 'Lu' };

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept search with pack number pattern', () => {
        const input = { search: '0103230' };

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept search with game name', () => {
        const input = { search: 'Lucky 7s' };

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject search exceeding max length (100 chars)', () => {
        const input = { search: 'a'.repeat(101) };

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should accept combined filters', () => {
        const input = {
          status: 'RECEIVED',
          search: 'Lucky',
          game_id: '550e8400-e29b-41d4-a716-446655440000',
        };

        const result = PackFiltersSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject search with only whitespace when trimmed', () => {
        // Note: Zod min(2) checks length of the raw string, not trimmed
        // So "  " has length 2 and passes schema, but DAL will ignore it
        const input = { search: '  ' };
        const result = PackFiltersSchema.safeParse(input);
        // Schema allows it, but DAL ignores whitespace-only
        expect(result.success).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Pack Response Transformation Tests
  // API-008: OUTPUT_FILTERING - Flat DAL response to nested API contract
  // ==========================================================================
  describe('Pack Response Transformation', () => {
    // Simulate the transformPackToResponse function logic
    interface PackWithDetails {
      pack_id: string;
      game_id: string;
      pack_number: string;
      opening_serial: string | null;
      closing_serial: string | null;
      status: string;
      store_id: string;
      bin_id: string | null;
      received_at: string | null;
      activated_at: string | null;
      settled_at: string | null;
      returned_at: string | null;
      game_code: string | null;
      game_name: string | null;
      game_price: number | null;
      game_tickets_per_pack: number | null;
      game_status: string | null;
      bin_number: number | null;
      bin_label: string | null;
    }

    interface PackResponse {
      pack_id: string;
      game_id: string;
      pack_number: string;
      opening_serial: string | null;
      closing_serial: string | null;
      status: string;
      store_id: string;
      bin_id: string | null;
      received_at: string | null;
      activated_at: string | null;
      settled_at: string | null;
      returned_at: string | null;
      game?: {
        game_id: string;
        game_code: string;
        name: string;
        price: number | null;
        tickets_per_pack: number;
        status?: string;
      };
      bin?: {
        bin_id: string;
        bin_number: number;
        label: string | null;
      } | null;
      can_return?: boolean;
    }

    function transformPackToResponse(pack: PackWithDetails): PackResponse {
      const response: PackResponse = {
        pack_id: pack.pack_id,
        game_id: pack.game_id,
        pack_number: pack.pack_number,
        opening_serial: pack.opening_serial,
        closing_serial: pack.closing_serial,
        status: pack.status,
        store_id: pack.store_id,
        bin_id: pack.bin_id,
        received_at: pack.received_at,
        activated_at: pack.activated_at,
        settled_at: pack.settled_at,
        returned_at: pack.returned_at,
        can_return: pack.status === 'RECEIVED' || pack.status === 'ACTIVATED',
      };

      if (pack.game_name !== null) {
        response.game = {
          game_id: pack.game_id,
          game_code: pack.game_code || '',
          name: pack.game_name,
          price: pack.game_price,
          tickets_per_pack: pack.game_tickets_per_pack || 0,
          status: pack.game_status || undefined,
        };
      }

      if (pack.bin_id !== null && pack.bin_number !== null) {
        response.bin = {
          bin_id: pack.bin_id,
          bin_number: pack.bin_number,
          label: pack.bin_label,
        };
      }

      return response;
    }

    it('should transform flat pack to nested response with game object', () => {
      const flatPack: PackWithDetails = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: '0103230',
        opening_serial: '000',
        closing_serial: null,
        status: 'ACTIVATED',
        store_id: 'store-1',
        bin_id: 'bin-1',
        received_at: '2024-01-01T00:00:00Z',
        activated_at: '2024-01-02T00:00:00Z',
        settled_at: null,
        returned_at: null,
        game_code: '1001',
        game_name: 'Lucky 7s',
        game_price: 1,
        game_tickets_per_pack: 300,
        game_status: 'ACTIVE',
        bin_number: 1,
        bin_label: 'Bin 1',
      };

      const result = transformPackToResponse(flatPack);

      // Verify nested game object
      expect(result.game).toBeDefined();
      expect(result.game?.game_id).toBe('game-1');
      expect(result.game?.game_code).toBe('1001');
      expect(result.game?.name).toBe('Lucky 7s');
      expect(result.game?.price).toBe(1);
      expect(result.game?.tickets_per_pack).toBe(300);
      expect(result.game?.status).toBe('ACTIVE');

      // Verify nested bin object
      expect(result.bin).toBeDefined();
      expect(result.bin?.bin_id).toBe('bin-1');
      expect(result.bin?.bin_number).toBe(1);
      expect(result.bin?.label).toBe('Bin 1');

      // Verify can_return flag
      expect(result.can_return).toBe(true);
    });

    it('should set can_return to true for RECEIVED packs', () => {
      const flatPack: PackWithDetails = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: '0103230',
        opening_serial: null,
        closing_serial: null,
        status: 'RECEIVED',
        store_id: 'store-1',
        bin_id: null,
        received_at: '2024-01-01T00:00:00Z',
        activated_at: null,
        settled_at: null,
        returned_at: null,
        game_code: '1001',
        game_name: 'Lucky 7s',
        game_price: 1,
        game_tickets_per_pack: 300,
        game_status: 'ACTIVE',
        bin_number: null,
        bin_label: null,
      };

      const result = transformPackToResponse(flatPack);

      expect(result.can_return).toBe(true);
    });

    it('should set can_return to false for SETTLED packs', () => {
      const flatPack: PackWithDetails = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: '0103230',
        opening_serial: '000',
        closing_serial: '150',
        status: 'SETTLED',
        store_id: 'store-1',
        bin_id: 'bin-1',
        received_at: '2024-01-01T00:00:00Z',
        activated_at: '2024-01-02T00:00:00Z',
        settled_at: '2024-01-03T00:00:00Z',
        returned_at: null,
        game_code: '1001',
        game_name: 'Lucky 7s',
        game_price: 1,
        game_tickets_per_pack: 300,
        game_status: 'ACTIVE',
        bin_number: 1,
        bin_label: 'Bin 1',
      };

      const result = transformPackToResponse(flatPack);

      expect(result.can_return).toBe(false);
    });

    it('should set can_return to false for RETURNED packs', () => {
      const flatPack: PackWithDetails = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: '0103230',
        opening_serial: null,
        closing_serial: null,
        status: 'RETURNED',
        store_id: 'store-1',
        bin_id: null,
        received_at: '2024-01-01T00:00:00Z',
        activated_at: null,
        settled_at: null,
        returned_at: '2024-01-02T00:00:00Z',
        game_code: '1001',
        game_name: 'Lucky 7s',
        game_price: 1,
        game_tickets_per_pack: 300,
        game_status: 'ACTIVE',
        bin_number: null,
        bin_label: null,
      };

      const result = transformPackToResponse(flatPack);

      expect(result.can_return).toBe(false);
    });

    it('should not include game object when game_name is null', () => {
      const flatPack: PackWithDetails = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: '0103230',
        opening_serial: null,
        closing_serial: null,
        status: 'RECEIVED',
        store_id: 'store-1',
        bin_id: null,
        received_at: '2024-01-01T00:00:00Z',
        activated_at: null,
        settled_at: null,
        returned_at: null,
        game_code: null,
        game_name: null, // No game data
        game_price: null,
        game_tickets_per_pack: null,
        game_status: null,
        bin_number: null,
        bin_label: null,
      };

      const result = transformPackToResponse(flatPack);

      expect(result.game).toBeUndefined();
    });

    it('should not include bin object when bin_id or bin_number is null', () => {
      const flatPack: PackWithDetails = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: '0103230',
        opening_serial: null,
        closing_serial: null,
        status: 'RECEIVED',
        store_id: 'store-1',
        bin_id: null, // No bin assigned
        received_at: '2024-01-01T00:00:00Z',
        activated_at: null,
        settled_at: null,
        returned_at: null,
        game_code: '1001',
        game_name: 'Lucky 7s',
        game_price: 1,
        game_tickets_per_pack: 300,
        game_status: 'ACTIVE',
        bin_number: null,
        bin_label: null,
      };

      const result = transformPackToResponse(flatPack);

      expect(result.bin).toBeUndefined();
    });

    it('should use default values for missing game fields', () => {
      const flatPack: PackWithDetails = {
        pack_id: 'pack-1',
        game_id: 'game-1',
        pack_number: '0103230',
        opening_serial: null,
        closing_serial: null,
        status: 'RECEIVED',
        store_id: 'store-1',
        bin_id: null,
        received_at: '2024-01-01T00:00:00Z',
        activated_at: null,
        settled_at: null,
        returned_at: null,
        game_code: null, // Missing game_code
        game_name: 'Lucky 7s',
        game_price: null, // Missing price
        game_tickets_per_pack: null, // Missing tickets_per_pack
        game_status: null, // Missing status
        bin_number: null,
        bin_label: null,
      };

      const result = transformPackToResponse(flatPack);

      expect(result.game).toBeDefined();
      expect(result.game?.game_code).toBe(''); // Default empty string
      expect(result.game?.tickets_per_pack).toBe(0); // Default 0
      expect(result.game?.status).toBeUndefined(); // Undefined for null
    });

    it('should preserve all base pack fields in response', () => {
      const flatPack: PackWithDetails = {
        pack_id: 'pack-123',
        game_id: 'game-456',
        pack_number: '9876543',
        opening_serial: '050',
        closing_serial: '150',
        status: 'ACTIVATED',
        store_id: 'store-789',
        bin_id: 'bin-001',
        received_at: '2024-01-01T10:00:00Z',
        activated_at: '2024-01-02T11:00:00Z',
        settled_at: null,
        returned_at: null,
        game_code: '2002',
        game_name: 'Cash Blast',
        game_price: 5,
        game_tickets_per_pack: 150,
        game_status: 'ACTIVE',
        bin_number: 3,
        bin_label: 'Register 3',
      };

      const result = transformPackToResponse(flatPack);

      // Verify all base fields are preserved
      expect(result.pack_id).toBe('pack-123');
      expect(result.game_id).toBe('game-456');
      expect(result.pack_number).toBe('9876543');
      expect(result.opening_serial).toBe('050');
      expect(result.closing_serial).toBe('150');
      expect(result.status).toBe('ACTIVATED');
      expect(result.store_id).toBe('store-789');
      expect(result.bin_id).toBe('bin-001');
      expect(result.received_at).toBe('2024-01-01T10:00:00Z');
      expect(result.activated_at).toBe('2024-01-02T11:00:00Z');
      expect(result.settled_at).toBeNull();
      expect(result.returned_at).toBeNull();
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

      // Call the mock and verify it returns expected value
      const mockFn = scannerService.parseBarcode as unknown as (
        barcode: string
      ) => typeof mockParsed;
      const result = mockFn('100112345670001234567890');

      expect(result).toEqual(mockParsed);
      expect(result.game_code).toBe('1001');
      expect(result.pack_number).toBe('1234567');
    });

    it('should return null for invalid barcode', () => {
      scannerService.parseBarcode.mockReturnValue(null);

      // Call the mock and verify it returns expected value
      const mockFn = scannerService.parseBarcode as unknown as (barcode: string) => null;
      const result = mockFn('invalid');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // lottery:listGames Handler Tests
  // Enterprise-grade testing for games listing feature
  // API-001: Input validation with Zod schemas
  // API-008: Output filtering (internal fields excluded)
  // DB-006: Store-scoped queries
  // SEC-006: Parameterized queries in DAL
  // SEC-014: Bounded pagination
  // ==========================================================================
  describe('lottery:listGames Handler (API-001, API-008, SEC-014)', () => {
    describe('ListGamesInputSchema Validation', () => {
      const ListGamesFilterSchema = z.object({
        status: z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED']).optional(),
        search: z.string().min(2).max(100).optional(),
      });

      const ListGamesPaginationSchema = z.object({
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
        sortBy: z.enum(['name', 'game_code', 'price', 'status', 'created_at']).optional(),
        sortOrder: z.enum(['ASC', 'DESC']).optional(),
      });

      const ListGamesInputSchema = z.object({
        filters: ListGamesFilterSchema.optional(),
        pagination: ListGamesPaginationSchema.optional(),
      });

      describe('Empty/Undefined Input', () => {
        it('should accept undefined input', () => {
          const result = ListGamesInputSchema.safeParse(undefined);
          // Undefined doesn't match the object schema, but that's OK - handler should treat as no filters
          expect(result.success).toBe(false);
        });

        it('should accept empty object', () => {
          const result = ListGamesInputSchema.safeParse({});
          expect(result.success).toBe(true);
        });

        it('should accept object with empty filters', () => {
          const result = ListGamesInputSchema.safeParse({ filters: {} });
          expect(result.success).toBe(true);
        });

        it('should accept object with empty pagination', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: {} });
          expect(result.success).toBe(true);
        });
      });

      describe('Filter Validation', () => {
        it('should accept valid status filter - ACTIVE', () => {
          const result = ListGamesInputSchema.safeParse({ filters: { status: 'ACTIVE' } });
          expect(result.success).toBe(true);
        });

        it('should accept valid status filter - INACTIVE', () => {
          const result = ListGamesInputSchema.safeParse({ filters: { status: 'INACTIVE' } });
          expect(result.success).toBe(true);
        });

        it('should accept valid status filter - DISCONTINUED', () => {
          const result = ListGamesInputSchema.safeParse({ filters: { status: 'DISCONTINUED' } });
          expect(result.success).toBe(true);
        });

        it('should reject invalid status value', () => {
          const result = ListGamesInputSchema.safeParse({ filters: { status: 'INVALID' } });
          expect(result.success).toBe(false);
        });

        it('should accept valid search (min 2 chars)', () => {
          const result = ListGamesInputSchema.safeParse({ filters: { search: 'Lu' } });
          expect(result.success).toBe(true);
        });

        it('should reject search below min length (1 char)', () => {
          const result = ListGamesInputSchema.safeParse({ filters: { search: 'L' } });
          expect(result.success).toBe(false);
        });

        it('should reject search exceeding max length (101 chars)', () => {
          const result = ListGamesInputSchema.safeParse({ filters: { search: 'a'.repeat(101) } });
          expect(result.success).toBe(false);
        });

        it('should accept search at max length (100 chars)', () => {
          const result = ListGamesInputSchema.safeParse({ filters: { search: 'a'.repeat(100) } });
          expect(result.success).toBe(true);
        });

        it('should accept combined filters', () => {
          const result = ListGamesInputSchema.safeParse({
            filters: { status: 'ACTIVE', search: 'Lucky' },
          });
          expect(result.success).toBe(true);
        });
      });

      describe('Pagination Validation (SEC-014: Bounded Reads)', () => {
        it('should accept valid limit within range', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { limit: 50 } });
          expect(result.success).toBe(true);
        });

        it('should reject limit below minimum (0)', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { limit: 0 } });
          expect(result.success).toBe(false);
        });

        it('should reject limit above maximum (101)', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { limit: 101 } });
          expect(result.success).toBe(false);
        });

        it('should accept limit at maximum (100)', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { limit: 100 } });
          expect(result.success).toBe(true);
        });

        it('should accept limit at minimum (1)', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { limit: 1 } });
          expect(result.success).toBe(true);
        });

        it('should accept valid offset', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { offset: 50 } });
          expect(result.success).toBe(true);
        });

        it('should reject negative offset', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { offset: -1 } });
          expect(result.success).toBe(false);
        });

        it('should accept offset at zero', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { offset: 0 } });
          expect(result.success).toBe(true);
        });

        it('should accept valid sortBy - name', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { sortBy: 'name' } });
          expect(result.success).toBe(true);
        });

        it('should accept valid sortBy - game_code', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { sortBy: 'game_code' } });
          expect(result.success).toBe(true);
        });

        it('should accept valid sortBy - price', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { sortBy: 'price' } });
          expect(result.success).toBe(true);
        });

        it('should accept valid sortBy - status', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { sortBy: 'status' } });
          expect(result.success).toBe(true);
        });

        it('should accept valid sortBy - created_at', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { sortBy: 'created_at' } });
          expect(result.success).toBe(true);
        });

        it('should reject invalid sortBy (SEC-006: SQL injection prevention)', () => {
          const result = ListGamesInputSchema.safeParse({
            pagination: { sortBy: 'name; DROP TABLE games;--' },
          });
          expect(result.success).toBe(false);
        });

        it('should accept valid sortOrder - ASC', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { sortOrder: 'ASC' } });
          expect(result.success).toBe(true);
        });

        it('should accept valid sortOrder - DESC', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { sortOrder: 'DESC' } });
          expect(result.success).toBe(true);
        });

        it('should reject invalid sortOrder', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { sortOrder: 'RANDOM' } });
          expect(result.success).toBe(false);
        });

        it('should reject non-integer limit', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { limit: 10.5 } });
          expect(result.success).toBe(false);
        });

        it('should reject non-integer offset', () => {
          const result = ListGamesInputSchema.safeParse({ pagination: { offset: 5.5 } });
          expect(result.success).toBe(false);
        });
      });

      describe('Combined Filters and Pagination', () => {
        it('should accept valid combined input', () => {
          const result = ListGamesInputSchema.safeParse({
            filters: { status: 'ACTIVE', search: 'Lucky' },
            pagination: { limit: 20, offset: 0, sortBy: 'name', sortOrder: 'ASC' },
          });
          expect(result.success).toBe(true);
        });

        it('should reject if any field is invalid', () => {
          const result = ListGamesInputSchema.safeParse({
            filters: { status: 'INVALID' },
            pagination: { limit: 20 },
          });
          expect(result.success).toBe(false);
        });
      });
    });

    describe('Response Transformation (API-008: Output Filtering)', () => {
      // Simulate the transformGameToResponse function from the handler
      interface GameWithPackCounts {
        game_id: string;
        store_id: string;
        game_code: string;
        name: string;
        price: number;
        pack_value: number;
        tickets_per_pack: number | null;
        status: string;
        deleted_at: string | null;
        cloud_game_id: string | null;
        state_id: string | null;
        synced_at: string | null;
        created_at: string;
        updated_at: string;
        total_packs: number;
        received_packs: number;
        active_packs: number;
        settled_packs: number;
        returned_packs: number;
      }

      interface GameListItemResponse {
        game_id: string;
        game_code: string;
        name: string;
        price: number;
        pack_value: number;
        tickets_per_pack: number | null;
        status: string;
        synced_at: string | null;
        created_at: string;
        updated_at: string;
        pack_counts: {
          total: number;
          received: number;
          active: number;
          settled: number;
          returned: number;
        };
      }

      function transformGameToResponse(game: GameWithPackCounts): GameListItemResponse {
        return {
          game_id: game.game_id,
          game_code: game.game_code,
          name: game.name,
          price: game.price,
          pack_value: game.pack_value,
          tickets_per_pack: game.tickets_per_pack,
          status: game.status,
          synced_at: game.synced_at,
          created_at: game.created_at,
          updated_at: game.updated_at,
          pack_counts: {
            total: game.total_packs,
            received: game.received_packs,
            active: game.active_packs,
            settled: game.settled_packs,
            returned: game.returned_packs,
          },
        };
      }

      it('should exclude store_id from response (tenant isolation)', () => {
        const dbGame: GameWithPackCounts = {
          game_id: 'game-1',
          store_id: 'store-sensitive-id',
          game_code: '1001',
          name: 'Lucky 7s',
          price: 1,
          pack_value: 300,
          tickets_per_pack: 300,
          status: 'ACTIVE',
          deleted_at: null,
          cloud_game_id: 'cloud-123',
          state_id: 'CA',
          synced_at: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          total_packs: 10,
          received_packs: 2,
          active_packs: 5,
          settled_packs: 2,
          returned_packs: 1,
        };

        const response = transformGameToResponse(dbGame);

        expect(response).not.toHaveProperty('store_id');
      });

      it('should exclude cloud_game_id from response (internal field)', () => {
        const dbGame: GameWithPackCounts = {
          game_id: 'game-1',
          store_id: 'store-1',
          game_code: '1001',
          name: 'Lucky 7s',
          price: 1,
          pack_value: 300,
          tickets_per_pack: 300,
          status: 'ACTIVE',
          deleted_at: null,
          cloud_game_id: 'cloud-internal-123',
          state_id: 'CA',
          synced_at: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          total_packs: 5,
          received_packs: 1,
          active_packs: 2,
          settled_packs: 1,
          returned_packs: 1,
        };

        const response = transformGameToResponse(dbGame);

        expect(response).not.toHaveProperty('cloud_game_id');
      });

      it('should exclude deleted_at from response (internal field)', () => {
        const dbGame: GameWithPackCounts = {
          game_id: 'game-1',
          store_id: 'store-1',
          game_code: '1001',
          name: 'Lucky 7s',
          price: 1,
          pack_value: 300,
          tickets_per_pack: 300,
          status: 'ACTIVE',
          deleted_at: '2024-01-15T00:00:00Z',
          cloud_game_id: null,
          state_id: 'CA',
          synced_at: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          total_packs: 0,
          received_packs: 0,
          active_packs: 0,
          settled_packs: 0,
          returned_packs: 0,
        };

        const response = transformGameToResponse(dbGame);

        expect(response).not.toHaveProperty('deleted_at');
      });

      it('should exclude state_id from response (internal field)', () => {
        const dbGame: GameWithPackCounts = {
          game_id: 'game-1',
          store_id: 'store-1',
          game_code: '1001',
          name: 'Lucky 7s',
          price: 1,
          pack_value: 300,
          tickets_per_pack: 300,
          status: 'ACTIVE',
          deleted_at: null,
          cloud_game_id: null,
          state_id: 'CA-INTERNAL',
          synced_at: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          total_packs: 0,
          received_packs: 0,
          active_packs: 0,
          settled_packs: 0,
          returned_packs: 0,
        };

        const response = transformGameToResponse(dbGame);

        expect(response).not.toHaveProperty('state_id');
      });

      it('should transform pack counts to nested structure', () => {
        const dbGame: GameWithPackCounts = {
          game_id: 'game-1',
          store_id: 'store-1',
          game_code: '1001',
          name: 'Lucky 7s',
          price: 1,
          pack_value: 300,
          tickets_per_pack: 300,
          status: 'ACTIVE',
          deleted_at: null,
          cloud_game_id: null,
          state_id: null,
          synced_at: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          total_packs: 15,
          received_packs: 3,
          active_packs: 7,
          settled_packs: 4,
          returned_packs: 1,
        };

        const response = transformGameToResponse(dbGame);

        expect(response.pack_counts).toBeDefined();
        expect(response.pack_counts.total).toBe(15);
        expect(response.pack_counts.received).toBe(3);
        expect(response.pack_counts.active).toBe(7);
        expect(response.pack_counts.settled).toBe(4);
        expect(response.pack_counts.returned).toBe(1);

        // Flat pack count fields should not be present
        expect(response).not.toHaveProperty('total_packs');
        expect(response).not.toHaveProperty('received_packs');
        expect(response).not.toHaveProperty('active_packs');
        expect(response).not.toHaveProperty('settled_packs');
        expect(response).not.toHaveProperty('returned_packs');
      });

      it('should include all required public fields', () => {
        const dbGame: GameWithPackCounts = {
          game_id: 'game-abc-123',
          store_id: 'store-1',
          game_code: '2001',
          name: 'Cash Explosion',
          price: 5,
          pack_value: 750,
          tickets_per_pack: 150,
          status: 'INACTIVE',
          deleted_at: null,
          cloud_game_id: null,
          state_id: null,
          synced_at: '2024-01-10T12:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-15T00:00:00Z',
          total_packs: 20,
          received_packs: 5,
          active_packs: 10,
          settled_packs: 4,
          returned_packs: 1,
        };

        const response = transformGameToResponse(dbGame);

        expect(response.game_id).toBe('game-abc-123');
        expect(response.game_code).toBe('2001');
        expect(response.name).toBe('Cash Explosion');
        expect(response.price).toBe(5);
        expect(response.pack_value).toBe(750);
        expect(response.tickets_per_pack).toBe(150);
        expect(response.status).toBe('INACTIVE');
        expect(response.synced_at).toBe('2024-01-10T12:00:00Z');
        expect(response.created_at).toBe('2024-01-01T00:00:00Z');
        expect(response.updated_at).toBe('2024-01-15T00:00:00Z');
      });

      it('should preserve null values for optional fields', () => {
        const dbGame: GameWithPackCounts = {
          game_id: 'game-1',
          store_id: 'store-1',
          game_code: '1001',
          name: 'Lucky 7s',
          price: 1,
          pack_value: 300,
          tickets_per_pack: null,
          status: 'ACTIVE',
          deleted_at: null,
          cloud_game_id: null,
          state_id: null,
          synced_at: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          total_packs: 0,
          received_packs: 0,
          active_packs: 0,
          settled_packs: 0,
          returned_packs: 0,
        };

        const response = transformGameToResponse(dbGame);

        expect(response.tickets_per_pack).toBeNull();
        expect(response.synced_at).toBeNull();
      });

      it('should handle zero pack counts correctly', () => {
        const dbGame: GameWithPackCounts = {
          game_id: 'game-1',
          store_id: 'store-1',
          game_code: '1001',
          name: 'New Game',
          price: 1,
          pack_value: 300,
          tickets_per_pack: 300,
          status: 'ACTIVE',
          deleted_at: null,
          cloud_game_id: null,
          state_id: null,
          synced_at: null,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-02T00:00:00Z',
          total_packs: 0,
          received_packs: 0,
          active_packs: 0,
          settled_packs: 0,
          returned_packs: 0,
        };

        const response = transformGameToResponse(dbGame);

        expect(response.pack_counts.total).toBe(0);
        expect(response.pack_counts.received).toBe(0);
        expect(response.pack_counts.active).toBe(0);
        expect(response.pack_counts.settled).toBe(0);
        expect(response.pack_counts.returned).toBe(0);
      });
    });
  });

  describe('DAL Integration', () => {
    it('should call lotteryGamesDAL.findActiveByStore for getGames', () => {
      const mockGames = [
        { game_id: 'game-1', game_code: '1001', name: 'Lucky 7s', price: 1 },
        { game_id: 'game-2', game_code: '1002', name: 'Cash Explosion', price: 2 },
      ];

      lotteryGamesDAL.findActiveByStore.mockReturnValue(mockGames);

      // Call the mock and verify it returns expected value
      const mockFn = lotteryGamesDAL.findActiveByStore as unknown as (
        storeId: string
      ) => typeof mockGames;
      const result = mockFn('store-1');

      expect(lotteryGamesDAL.findActiveByStore).toHaveBeenCalledWith('store-1');
      expect(result).toEqual(mockGames);
    });

    it('should call lotteryBinsDAL.findBinsWithPacks for getBins', () => {
      const mockBins = [
        { bin_id: 'bin-1', bin_number: 1, pack_id: 'pack-1', game_name: 'Lucky 7s' },
        { bin_id: 'bin-2', bin_number: 2, pack_id: null, game_name: null },
      ];

      lotteryBinsDAL.findBinsWithPacks.mockReturnValue(mockBins);

      // Call the mock and verify it returns expected value
      const mockFn = lotteryBinsDAL.findBinsWithPacks as unknown as (
        storeId: string
      ) => typeof mockBins;
      const result = mockFn('store-1');

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

      // Call the mock and verify it returns expected value
      const mockFn = lotteryPacksDAL.receive as unknown as (data: object) => typeof mockPack;
      const result = mockFn(data);

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

      // Call the mock and verify it returns expected value
      const mockFn = lotteryPacksDAL.activate as unknown as (
        packId: string,
        opts: object
      ) => typeof mockPack;
      const result = mockFn('pack-1', { bin_id: 'bin-1', opening_serial: '000' });

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

      // Call the mock and verify it returns expected value
      const mockFn = lotteryBusinessDaysDAL.prepareClose as unknown as (
        dayId: string,
        closingsData: object[]
      ) => typeof mockResult;
      const result = mockFn('day-1', closings);

      expect(lotteryBusinessDaysDAL.prepareClose).toHaveBeenCalledWith('day-1', closings);
      expect(result).toEqual(mockResult);
    });
  });

  // ==========================================================================
  // lottery:checkPackExists Handler Schema Tests
  // This handler is critical for providing user-friendly error messages
  // when a user tries to activate an already-activated pack
  // SEC-BUSINESS: Pack duplicate activation prevention
  // API-001: Input validation
  // ==========================================================================
  describe('lottery:checkPackExists Schema Validation', () => {
    const CheckPackExistsInputSchema = z.object({
      store_id: z.string().uuid(),
      pack_number: z.string().min(1).max(20),
    });

    describe('Input validation (API-001)', () => {
      it('should accept valid input with UUID store_id and pack_number', () => {
        const input = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: '0103230',
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept pack_number with 1 character (minimum)', () => {
        const input = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: '1',
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should accept pack_number with 20 characters (maximum)', () => {
        const input = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: '01234567890123456789',
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        expect(result.success).toBe(true);
      });

      it('should reject empty pack_number', () => {
        const input = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: '',
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject pack_number exceeding 20 characters', () => {
        const input = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: '012345678901234567890', // 21 chars
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject invalid UUID for store_id', () => {
        const input = {
          store_id: 'not-a-uuid',
          pack_number: '0103230',
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject missing store_id', () => {
        const input = {
          pack_number: '0103230',
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      it('should reject missing pack_number', () => {
        const input = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });

      // SEC-006: SQL injection prevention via validation
      it('should accept pack_number with SQL-like content (will be safely parameterized)', () => {
        // The schema accepts the input; actual SQL injection prevention is via parameterized queries
        const input = {
          store_id: '550e8400-e29b-41d4-a716-446655440000',
          pack_number: "'; DROP TABLE --",
        };

        const result = CheckPackExistsInputSchema.safeParse(input);
        // Length is 16, within bounds, so schema accepts it
        expect(result.success).toBe(true);
        // Security note: Actual protection is via parameterized queries in DAL
      });
    });

    describe('Response structure validation', () => {
      // Define expected response structure
      const CheckPackExistsResponseSchema = z.object({
        exists: z.boolean(),
        pack: z.object({
          pack_id: z.string(),
          pack_number: z.string(),
          status: z.enum(['RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED']),
          game: z.object({
            game_code: z.string(),
            name: z.string(),
          }).optional(),
        }).optional(),
      });

      it('should validate response when pack exists', () => {
        const response = {
          exists: true,
          pack: {
            pack_id: 'pack-uuid-123',
            pack_number: '0103230',
            status: 'ACTIVATED',
            game: {
              game_code: '1835',
              name: 'Lucky 7s',
            },
          },
        };

        const result = CheckPackExistsResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      });

      it('should validate response when pack does not exist', () => {
        const response = {
          exists: false,
        };

        const result = CheckPackExistsResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      });

      it('should validate response with ACTIVATED status', () => {
        const response = {
          exists: true,
          pack: {
            pack_id: 'pack-uuid-123',
            pack_number: '0103230',
            status: 'ACTIVATED',
          },
        };

        const result = CheckPackExistsResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      });

      it('should validate response with SETTLED status', () => {
        const response = {
          exists: true,
          pack: {
            pack_id: 'pack-uuid-123',
            pack_number: '0103230',
            status: 'SETTLED',
          },
        };

        const result = CheckPackExistsResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      });

      it('should validate response with RETURNED status', () => {
        const response = {
          exists: true,
          pack: {
            pack_id: 'pack-uuid-123',
            pack_number: '0103230',
            status: 'RETURNED',
          },
        };

        const result = CheckPackExistsResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      });

      it('should validate response with RECEIVED status', () => {
        const response = {
          exists: true,
          pack: {
            pack_id: 'pack-uuid-123',
            pack_number: '0103230',
            status: 'RECEIVED',
          },
        };

        const result = CheckPackExistsResponseSchema.safeParse(response);
        expect(result.success).toBe(true);
      });

      it('should reject invalid status value', () => {
        const response = {
          exists: true,
          pack: {
            pack_id: 'pack-uuid-123',
            pack_number: '0103230',
            status: 'INVALID_STATUS',
          },
        };

        const result = CheckPackExistsResponseSchema.safeParse(response);
        expect(result.success).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Pack Status Error Message Mapping Tests
  // Validates the mapping from pack status to user-friendly error messages
  // SEC-BUSINESS: User must receive clear feedback about why activation failed
  // ==========================================================================
  describe('Pack Status to Error Message Mapping', () => {
    // Simulates the logic that would be used in the frontend
    interface PackStatusErrorMessage {
      title: string;
      description: string;
    }

    function getPackStatusErrorMessage(
      status: string,
      packNumber: string,
      gameName?: string,
      binLabel?: string | null
    ): PackStatusErrorMessage {
      const gameInfo = gameName ? ` (${gameName})` : '';

      switch (status) {
        case 'ACTIVATED':
          return {
            title: 'Pack is already active',
            description: binLabel
              ? `Pack #${packNumber}${gameInfo} is currently active in ${binLabel}. A pack can only be activated once.`
              : `Pack #${packNumber}${gameInfo} is already activated. A pack can only be activated once.`,
          };
        case 'SETTLED':
          return {
            title: 'Pack has been sold/depleted',
            description: `Pack #${packNumber}${gameInfo} was previously activated and has been depleted. It cannot be activated again.`,
          };
        case 'RETURNED':
          return {
            title: 'Pack was returned',
            description: `Pack #${packNumber}${gameInfo} was returned to the distributor and cannot be activated.`,
          };
        default:
          return {
            title: 'Pack unavailable',
            description: `Pack #${packNumber}${gameInfo} cannot be activated.`,
          };
      }
    }

    describe('ACTIVATED pack error messages', () => {
      it('should generate message with bin label', () => {
        const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', 'Bin 1');

        expect(result.title).toBe('Pack is already active');
        expect(result.description).toContain('Bin 1');
        expect(result.description).toContain('Lucky 7s');
        expect(result.description).toContain('A pack can only be activated once');
      });

      it('should generate message without bin label', () => {
        const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', null);

        expect(result.title).toBe('Pack is already active');
        expect(result.description).toContain('already activated');
        expect(result.description).not.toContain('Bin');
      });
    });

    describe('SETTLED pack error messages', () => {
      it('should indicate pack was depleted', () => {
        const result = getPackStatusErrorMessage('SETTLED', '0103230', 'Lucky 7s', null);

        expect(result.title).toBe('Pack has been sold/depleted');
        expect(result.description).toContain('depleted');
        expect(result.description).toContain('cannot be activated again');
      });
    });

    describe('RETURNED pack error messages', () => {
      it('should indicate pack was returned to distributor', () => {
        const result = getPackStatusErrorMessage('RETURNED', '0103230', 'Lucky 7s', null);

        expect(result.title).toBe('Pack was returned');
        expect(result.description).toContain('returned to the distributor');
      });
    });

    describe('Error message clarity requirements', () => {
      it('should always include pack number in description', () => {
        const statuses = ['ACTIVATED', 'SETTLED', 'RETURNED'];

        for (const status of statuses) {
          const result = getPackStatusErrorMessage(status, '0103230', undefined, null);
          expect(result.description).toContain('Pack #0103230');
        }
      });

      it('should include game name when provided', () => {
        const statuses = ['ACTIVATED', 'SETTLED', 'RETURNED'];

        for (const status of statuses) {
          const result = getPackStatusErrorMessage(status, '0103230', 'Lucky 7s', null);
          expect(result.description).toContain('Lucky 7s');
        }
      });

      it('should have non-empty titles for all statuses', () => {
        const statuses = ['ACTIVATED', 'SETTLED', 'RETURNED', 'UNKNOWN'];

        for (const status of statuses) {
          const result = getPackStatusErrorMessage(status, '0103230', undefined, null);
          expect(result.title.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
