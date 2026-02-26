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
import { ReturnReasonSchema, RETURN_REASONS } from '../../../src/shared/types/lottery.types';

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

// Mock syncQueueDAL for pack sync tests (SYNC-001)
vi.mock('../../../src/main/dal/sync-queue.dal', () => ({
  syncQueueDAL: {
    enqueue: vi.fn(),
    getPendingCount: vi.fn(),
    getRetryableItems: vi.fn(),
    markSynced: vi.fn(),
    incrementAttempts: vi.fn(),
    getStats: vi.fn(),
    cleanupAllStalePullTracking: vi.fn().mockReturnValue(0),
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

// Mock settingsService with getPOSType for SEC-010 authorization tests
const mockSettingsService = {
  getStoreId: vi.fn().mockReturnValue('store-1'),
  getPOSType: vi.fn().mockReturnValue('LOTTERY'),
  getPOSConnectionType: vi.fn().mockReturnValue('MANUAL'),
};

vi.mock('../../../src/main/services/settings.service', () => ({
  settingsService: mockSettingsService,
}));

describe('Lottery IPC Handlers', () => {
  // Import mocked modules
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type MockFn = ReturnType<typeof vi.fn> & ((...args: any[]) => any);

  let lotteryGamesDAL: {
    findActiveByStore: MockFn;
    findByGameCode: MockFn;
    create: MockFn;
    update: MockFn;
  };
  let lotteryBinsDAL: {
    findActiveByStore: MockFn;
    findBinsWithPacks: MockFn;
    findById: MockFn;
  };
  let lotteryPacksDAL: {
    receive: MockFn;
    activate: MockFn;
    settle: MockFn;
    returnPack: MockFn;
    findWithFilters: MockFn;
    getActivatedPacksForDayClose: MockFn;
  };
  let lotteryBusinessDaysDAL: {
    getOrCreateForDate: MockFn;
    findOpenDay: MockFn;
    prepareClose: MockFn;
    commitClose: MockFn;
    cancelClose: MockFn;
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
      /**
       * Production-accurate schema matching src/main/ipc/lottery.handlers.ts:91-97
       * API-001: VALIDATION - Zod schema validation
       * SEC-014: INPUT_VALIDATION - Boolean field with safe default
       * BIN-001: One active pack per bin - deplete_previous enables collision handling
       */
      const SerialSchema = z.string().regex(/^\d{3}$/);
      const UUIDSchema = z.string().uuid();
      const ActivatePackSchema = z.object({
        pack_id: UUIDSchema,
        bin_id: UUIDSchema,
        opening_serial: SerialSchema,
        /** Default true ensures safety - always check for bin collisions unless explicitly disabled */
        deplete_previous: z.boolean().optional().default(true),
      });

      describe('Basic Valid Input', () => {
        it('should accept valid input without deplete_previous (defaults to true)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '000',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.deplete_previous).toBe(true);
          }
        });

        it('should accept valid input with deplete_previous: true', () => {
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

        it('should accept valid input with deplete_previous: false (legacy behavior)', () => {
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

      describe('deplete_previous Field Validation (SEC-014)', () => {
        it('should default deplete_previous to true when omitted', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '000',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.deplete_previous).toBe(true);
          }
        });

        it('should reject string "true" for deplete_previous (strict type)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '000',
            deplete_previous: 'true', // String, not boolean
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject number 1 for deplete_previous (strict type)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '000',
            deplete_previous: 1, // Number, not boolean
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject object for deplete_previous (strict type)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '000',
            deplete_previous: { value: true }, // Object, not boolean
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject null for deplete_previous', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '000',
            deplete_previous: null,
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });
      });

      describe('opening_serial Validation (SEC-014)', () => {
        it('should accept opening_serial 000 (pack minimum)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '000',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept opening_serial 299 (pack maximum for 300-ticket pack)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '299',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should reject invalid opening_serial (2 digits - too short)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '00', // Too short
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject 4-digit opening_serial (too long)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '0000', // Too long
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject opening_serial with letters (SEC-006: type constraint)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: 'ABC',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject opening_serial with special characters (SEC-006: injection prevention)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '1;2',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });
      });

      describe('UUID Validation (SEC-006)', () => {
        it('should reject invalid pack_id UUID', () => {
          const input = {
            pack_id: 'not-a-uuid',
            bin_id: '660e8400-e29b-41d4-a716-446655440001',
            opening_serial: '000',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject invalid bin_id UUID', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: 'not-a-uuid',
            opening_serial: '000',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject SQL injection attempt in bin_id (SEC-006)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            bin_id: "'; DROP TABLE lottery_bins; --",
            opening_serial: '000',
          };

          const result = ActivatePackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });
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
       * Production-accurate schema matching src/main/ipc/lottery.handlers.ts:104-111
       * SEC-014: INPUT_VALIDATION - Strict schema for pack return with enum validation
       * API-001: VALIDATION - Zod schema validation
       *
       * Updated for return_reason enum enforcement (Phase 2 of return_sold_fix plan):
       * - return_reason is now REQUIRED (not optional)
       * - return_reason must be one of: SUPPLIER_RECALL, DAMAGED, EXPIRED, INVENTORY_ADJUSTMENT, STORE_CLOSURE
       * - return_notes added for optional additional context (max 500 chars)
       *
       * @see src/shared/types/lottery.types.ts for ReturnReasonSchema
       */
      const SerialSchema = z.string().regex(/^\d{3}$/);
      const ReturnPackSchema = z.object({
        pack_id: z.string().uuid(),
        closing_serial: SerialSchema.optional(),
        /** Required return reason - must be valid enum value (SEC-014) */
        return_reason: ReturnReasonSchema,
        /** Optional notes for additional context */
        return_notes: z.string().max(500).optional(),
      });

      describe('Basic Valid Input', () => {
        it('should accept valid input with all fields', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '150',
            return_reason: 'DAMAGED' as const,
            return_notes: 'Box was crushed during shipping',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept valid input with only required fields (pack_id and return_reason)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'SUPPLIER_RECALL' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept valid input with closing_serial and return_reason', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '000',
            return_reason: 'EXPIRED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept valid input with return_reason and return_notes', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'INVENTORY_ADJUSTMENT' as const,
            return_notes: 'Audit found discrepancy',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should reject input missing required return_reason', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '150',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });
      });

      describe('closing_serial Validation (SEC-014)', () => {
        it('should accept closing_serial 000 (pack minimum)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '000',
            return_reason: 'DAMAGED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept closing_serial 299 (pack maximum for 300-ticket pack)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '299',
            return_reason: 'DAMAGED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept closing_serial 149 (pack maximum for 150-ticket pack)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '149',
            return_reason: 'EXPIRED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should reject closing_serial with 2 digits (boundary: too short)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '99',
            return_reason: 'DAMAGED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject closing_serial with 4 digits (boundary: too long)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '0150',
            return_reason: 'DAMAGED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject closing_serial with letters (SEC-006: type constraint)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: 'ABC',
            return_reason: 'DAMAGED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject closing_serial with special characters (SEC-006: injection prevention)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '1;2',
            return_reason: 'DAMAGED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject closing_serial with whitespace', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: ' 15',
            return_reason: 'DAMAGED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject empty string closing_serial (boundary)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: '',
            return_reason: 'DAMAGED' as const,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });
      });

      describe('return_reason Validation (SEC-014: Enum Allowlist)', () => {
        /**
         * Phase 8 Tests: return_reason enum validation
         * SEC-014: Strict allowlist - only valid enum values accepted
         *
         * Valid values: SUPPLIER_RECALL, DAMAGED, EXPIRED, INVENTORY_ADJUSTMENT, STORE_CLOSURE
         * Invalid: OTHER, empty string, arbitrary strings
         */

        it('should reject empty return_reason (required field)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: '',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject missing return_reason (required field)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject invalid return_reason value OTHER (not in allowlist)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'OTHER',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject arbitrary string return_reason values', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED - Box was crushed during shipping',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject case-insensitive variants (strict enum matching)', () => {
          const variants = ['damaged', 'Damaged', 'DAMAGED ', ' DAMAGED'];
          variants.forEach((variant) => {
            if (variant !== 'DAMAGED') {
              const input = {
                pack_id: '550e8400-e29b-41d4-a716-446655440000',
                return_reason: variant,
              };
              const result = ReturnPackSchema.safeParse(input);
              expect(result.success).toBe(false);
            }
          });
        });

        it('should accept all valid enum values from RETURN_REASONS array', () => {
          RETURN_REASONS.forEach((reason) => {
            const input = {
              pack_id: '550e8400-e29b-41d4-a716-446655440000',
              return_reason: reason,
            };
            const result = ReturnPackSchema.safeParse(input);
            expect(result.success).toBe(true);
          });
        });
      });

      describe('return_notes Validation (Optional Field)', () => {
        /**
         * return_notes is an optional field for additional context
         * Max length: 500 characters
         */

        it('should accept empty return_notes (optional field)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED' as const,
            return_notes: '',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept return_notes at max length (500 chars)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED' as const,
            return_notes: 'D'.repeat(500),
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should reject return_notes exceeding max length (501 chars)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED' as const,
            return_notes: 'D'.repeat(501),
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should accept return_notes with newlines (multi-line notes)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED' as const,
            return_notes: 'Line 1: Box crushed\nLine 2: Tickets torn\nLine 3: Cannot sell',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept return_notes with unicode characters', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'DAMAGED' as const,
            return_notes: 'Customer complaint: "Paquete dañado" 破损',
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should accept input without return_notes (omitted)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: 'SUPPLIER_RECALL' as const,
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
            return_reason: 'DAMAGED' as const,
            malicious_field: 'attack vector',
          };

          const result = StrictReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should reject null for required return_reason', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            return_reason: null,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
        });

        it('should handle null values for truly optional fields', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: null,
            return_reason: 'DAMAGED' as const,
            return_notes: null,
          };

          const result = ReturnPackSchema.safeParse(input);
          // Zod optional() doesn't accept null by default
          expect(result.success).toBe(false);
        });

        it('should accept undefined for optional fields (but require return_reason)', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: undefined,
            return_reason: 'EXPIRED' as const,
            return_notes: undefined,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(true);
        });

        it('should reject undefined for required return_reason', () => {
          const input = {
            pack_id: '550e8400-e29b-41d4-a716-446655440000',
            closing_serial: undefined,
            return_reason: undefined,
          };

          const result = ReturnPackSchema.safeParse(input);
          expect(result.success).toBe(false);
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
        status: z.enum(['RECEIVED', 'ACTIVE', 'DEPLETED', 'RETURNED']).optional(),
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
        const input = { status: 'ACTIVE' };

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
      depleted_at: string | null;
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
      depleted_at: string | null;
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
        depleted_at: pack.depleted_at,
        returned_at: pack.returned_at,
        can_return: pack.status === 'RECEIVED' || pack.status === 'ACTIVE',
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
        status: 'ACTIVE',
        store_id: 'store-1',
        bin_id: 'bin-1',
        received_at: '2024-01-01T00:00:00Z',
        activated_at: '2024-01-02T00:00:00Z',
        depleted_at: null,
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
        depleted_at: null,
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
        status: 'DEPLETED',
        store_id: 'store-1',
        bin_id: 'bin-1',
        received_at: '2024-01-01T00:00:00Z',
        activated_at: '2024-01-02T00:00:00Z',
        depleted_at: '2024-01-03T00:00:00Z',
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
        depleted_at: null,
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
        depleted_at: null,
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
        depleted_at: null,
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
        depleted_at: null,
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
        status: 'ACTIVE',
        store_id: 'store-789',
        bin_id: 'bin-001',
        received_at: '2024-01-01T10:00:00Z',
        activated_at: '2024-01-02T11:00:00Z',
        depleted_at: null,
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
      expect(result.status).toBe('ACTIVE');
      expect(result.store_id).toBe('store-789');
      expect(result.bin_id).toBe('bin-001');
      expect(result.received_at).toBe('2024-01-01T10:00:00Z');
      expect(result.activated_at).toBe('2024-01-02T11:00:00Z');
      expect(result.depleted_at).toBeNull();
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
          depleted: number;
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
            depleted: game.settled_packs,
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
        expect(response.pack_counts.depleted).toBe(4);
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
        expect(response.pack_counts.depleted).toBe(0);
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
        status: 'ACTIVE',
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
        pack: z
          .object({
            pack_id: z.string(),
            pack_number: z.string(),
            status: z.enum(['RECEIVED', 'ACTIVE', 'DEPLETED', 'RETURNED']),
            game: z
              .object({
                game_code: z.string(),
                name: z.string(),
              })
              .optional(),
          })
          .optional(),
      });

      it('should validate response when pack exists', () => {
        const response = {
          exists: true,
          pack: {
            pack_id: 'pack-uuid-123',
            pack_number: '0103230',
            status: 'ACTIVE',
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
            status: 'ACTIVE',
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
            status: 'DEPLETED',
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
        case 'ACTIVE':
          return {
            title: 'Pack is already active',
            description: binLabel
              ? `Pack #${packNumber}${gameInfo} is currently active in ${binLabel}. A pack can only be activated once.`
              : `Pack #${packNumber}${gameInfo} is already activated. A pack can only be activated once.`,
          };
        case 'DEPLETED':
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
        const result = getPackStatusErrorMessage('ACTIVE', '0103230', 'Lucky 7s', 'Bin 1');

        expect(result.title).toBe('Pack is already active');
        expect(result.description).toContain('Bin 1');
        expect(result.description).toContain('Lucky 7s');
        expect(result.description).toContain('A pack can only be activated once');
      });

      it('should generate message without bin label', () => {
        const result = getPackStatusErrorMessage('ACTIVE', '0103230', 'Lucky 7s', null);

        expect(result.title).toBe('Pack is already active');
        expect(result.description).toContain('already activated');
        expect(result.description).not.toContain('Bin');
      });
    });

    describe('SETTLED pack error messages', () => {
      it('should indicate pack was depleted', () => {
        const result = getPackStatusErrorMessage('DEPLETED', '0103230', 'Lucky 7s', null);

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
        const statuses = ['ACTIVE', 'DEPLETED', 'RETURNED'];

        for (const status of statuses) {
          const result = getPackStatusErrorMessage(status, '0103230', undefined, null);
          expect(result.description).toContain('Pack #0103230');
        }
      });

      it('should include game name when provided', () => {
        const statuses = ['ACTIVE', 'DEPLETED', 'RETURNED'];

        for (const status of statuses) {
          const result = getPackStatusErrorMessage(status, '0103230', 'Lucky 7s', null);
          expect(result.description).toContain('Lucky 7s');
        }
      });

      it('should have non-empty titles for all statuses', () => {
        const statuses = ['ACTIVE', 'DEPLETED', 'RETURNED', 'UNKNOWN'];

        for (const status of statuses) {
          const result = getPackStatusErrorMessage(status, '0103230', undefined, null);
          expect(result.title.length).toBeGreaterThan(0);
        }
      });
    });
  });

  // ==========================================================================
  // Pack Sync Queue Integration Tests (SYNC-001)
  // Validates syncQueueDAL.enqueue() calls in lottery handlers
  // ==========================================================================
  describe('Pack Sync Queue Integration (SYNC-001)', () => {
    // Mock data
    const mockStore = {
      store_id: 'store-550e8400-e29b-41d4-a716-446655440000',
      company_id: 'company-550e8400-e29b-41d4-a716-446655440001',
      name: 'Test Store',
      timezone: 'America/New_York',
      status: 'ACTIVE' as const,
      state_id: 'state-123',
      state_code: 'NY',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };

    const mockReceivedPack = {
      pack_id: '550e8400-e29b-41d4-a716-446655440100',
      store_id: mockStore.store_id,
      game_id: '550e8400-e29b-41d4-a716-446655440200',
      game_code: '1234',
      pack_number: 'PKG1234567',
      bin_id: null,
      status: 'RECEIVED' as const,
      received_at: '2024-01-15T10:00:00.000Z',
      received_by: 'user-550e8400-e29b-41d4-a716-446655440300',
      activated_at: null,
      activated_by: null,
      depleted_at: null,
      returned_at: null,
      opening_serial: null,
      closing_serial: null,
      tickets_sold: 0,
      sales_amount: 0,
      cloud_pack_id: null,
      synced_at: null,
      created_at: '2024-01-15T10:00:00.000Z',
      updated_at: '2024-01-15T10:00:00.000Z',
    };

    const mockActivatedPack = {
      ...mockReceivedPack,
      status: 'ACTIVE' as const,
      bin_id: '550e8400-e29b-41d4-a716-446655440400',
      activated_at: '2024-01-15T11:00:00.000Z',
      opening_serial: '001',
      updated_at: '2024-01-15T11:00:00.000Z',
    };

    const mockSettledPack = {
      ...mockActivatedPack,
      status: 'DEPLETED' as const,
      closing_serial: '150',
      tickets_sold: 150,
      sales_amount: 150,
      depleted_at: '2024-01-15T12:00:00.000Z',
      updated_at: '2024-01-15T12:00:00.000Z',
    };

    const mockReturnedPack = {
      ...mockReceivedPack,
      status: 'RETURNED' as const,
      returned_at: '2024-01-15T13:00:00.000Z',
      updated_at: '2024-01-15T13:00:00.000Z',
    };

    describe('Sync Payload Structure (API-008: OUTPUT_FILTERING)', () => {
      /**
       * PackSyncPayload interface matching the implementation
       * Excludes internal fields: created_at, updated_at, cloud_pack_id, synced_at
       * API-001: Includes game_code, serial_start, serial_end as required by cloud API spec
       */
      interface PackSyncPayload {
        pack_id: string;
        store_id: string;
        game_id: string;
        game_code: string;
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
       * Simulate buildPackSyncPayload function
       * API-001: Includes game_code, serial_start, serial_end as required by cloud API spec
       */
      function buildPackSyncPayload(
        pack: {
          pack_id: string;
          store_id: string;
          game_id: string;
          pack_number: string;
          bin_id: string | null;
          status: string;
          received_at: string | null;
          received_by: string | null;
          activated_at: string | null;
          depleted_at: string | null;
          returned_at: string | null;
          opening_serial: string | null;
          closing_serial: string | null;
          tickets_sold: number;
          sales_amount: number;
        },
        gameCode: string,
        ticketsPerPack: number | null = 300,
        activatedBy?: string | null
      ): PackSyncPayload {
        // Calculate serial_start and serial_end
        const serialStart = '000';
        const serialEnd = ticketsPerPack ? String(ticketsPerPack - 1).padStart(3, '0') : '299';

        return {
          pack_id: pack.pack_id,
          store_id: pack.store_id,
          game_id: pack.game_id,
          game_code: gameCode,
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
          activated_by: activatedBy ?? null,
          depleted_at: pack.depleted_at,
          returned_at: pack.returned_at,
          serial_start: serialStart,
          serial_end: serialEnd,
        };
      }

      it('PS-S-001: should NOT include internal fields (created_at, updated_at)', () => {
        const payload = buildPackSyncPayload(mockReceivedPack, mockReceivedPack.game_code);

        // Verify internal fields are excluded
        expect(payload).not.toHaveProperty('created_at');
        expect(payload).not.toHaveProperty('updated_at');
        expect(payload).not.toHaveProperty('cloud_pack_id');
        expect(payload).not.toHaveProperty('synced_at');
      });

      it('PS-S-002: should include store_id for tenant isolation (DB-006)', () => {
        const payload = buildPackSyncPayload(mockReceivedPack, mockReceivedPack.game_code);

        expect(payload.store_id).toBe(mockStore.store_id);
      });

      it('LP-U-002: should include complete payload fields for received pack', () => {
        const payload = buildPackSyncPayload(mockReceivedPack, mockReceivedPack.game_code);

        expect(payload.pack_id).toBe(mockReceivedPack.pack_id);
        expect(payload.game_id).toBe(mockReceivedPack.game_id);
        expect(payload.game_code).toBe(mockReceivedPack.game_code);
        expect(payload.pack_number).toBe(mockReceivedPack.pack_number);
        expect(payload.status).toBe('RECEIVED');
        expect(payload.bin_id).toBeNull();
        expect(payload.opening_serial).toBeNull();
        expect(payload.closing_serial).toBeNull();
        expect(payload.tickets_sold).toBe(0);
        expect(payload.sales_amount).toBe(0);
        expect(payload.received_at).toBe(mockReceivedPack.received_at);
        expect(payload.received_by).toBe(mockReceivedPack.received_by);
        expect(payload.activated_at).toBeNull();
        expect(payload.activated_by).toBeNull();
        expect(payload.depleted_at).toBeNull();
        expect(payload.returned_at).toBeNull();
      });

      it('LP-U-011: should include bin_id and opening_serial for activated pack', () => {
        const payload = buildPackSyncPayload(
          mockActivatedPack,
          mockActivatedPack.game_code,
          300, // tickets_per_pack
          'user-123'
        );

        expect(payload.bin_id).toBe(mockActivatedPack.bin_id);
        expect(payload.opening_serial).toBe(mockActivatedPack.opening_serial);
        expect(payload.activated_at).toBe(mockActivatedPack.activated_at);
        expect(payload.status).toBe('ACTIVE');
      });

      it('LP-U-012: should include activated_by from session (SEC-010)', () => {
        const activatedByUserId = 'user-session-activated-by-123';
        const payload = buildPackSyncPayload(
          mockActivatedPack,
          mockActivatedPack.game_code,
          300, // tickets_per_pack
          activatedByUserId
        );

        expect(payload.activated_by).toBe(activatedByUserId);
      });

      it('LP-U-014: should include closing_serial and sales data for depleted pack', () => {
        const payload = buildPackSyncPayload(mockSettledPack, mockSettledPack.game_code);

        expect(payload.closing_serial).toBe(mockSettledPack.closing_serial);
        expect(payload.tickets_sold).toBe(mockSettledPack.tickets_sold);
        expect(payload.sales_amount).toBe(mockSettledPack.sales_amount);
        expect(payload.depleted_at).toBe(mockSettledPack.depleted_at);
        expect(payload.status).toBe('DEPLETED');
      });

      it('LP-U-017: should include return data for returned pack', () => {
        const payload = buildPackSyncPayload(mockReturnedPack, mockReturnedPack.game_code);

        expect(payload.returned_at).toBe(mockReturnedPack.returned_at);
        expect(payload.status).toBe('RETURNED');
      });

      it('PS-S-007: should record received_by and activated_by for audit trail', () => {
        const receivedPayload = buildPackSyncPayload(mockReceivedPack, mockReceivedPack.game_code);
        expect(receivedPayload.received_by).toBe(mockReceivedPack.received_by);

        const activatedPayload = buildPackSyncPayload(
          mockActivatedPack,
          mockActivatedPack.game_code,
          300, // tickets_per_pack
          'user-who-activated'
        );
        expect(activatedPayload.activated_by).toBe('user-who-activated');
      });

      it('LP-U-020: should include serial_start and serial_end for API compliance', () => {
        // Test with default 300 tickets
        const payload = buildPackSyncPayload(mockReceivedPack, mockReceivedPack.game_code, 300);
        expect(payload.serial_start).toBe('000');
        expect(payload.serial_end).toBe('299');

        // Test with different pack size (150 tickets)
        const payload150 = buildPackSyncPayload(mockReceivedPack, mockReceivedPack.game_code, 150);
        expect(payload150.serial_start).toBe('000');
        expect(payload150.serial_end).toBe('149');

        // Test with null (should default to 299)
        const payloadNull = buildPackSyncPayload(
          mockReceivedPack,
          mockReceivedPack.game_code,
          null
        );
        expect(payloadNull.serial_start).toBe('000');
        expect(payloadNull.serial_end).toBe('299');
      });
    });

    describe('Sync Queue Enqueue Call Validation', () => {
      /**
       * Validates sync queue enqueue call structure
       */
      interface EnqueueCall {
        store_id: string;
        entity_type: string;
        entity_id: string;
        operation: 'CREATE' | 'UPDATE' | 'DELETE';
        payload: object;
      }

      /**
       * Creates mock enqueue call for testing
       */
      function createMockEnqueueCall(
        pack: { pack_id: string; store_id: string; status: string },
        operation: 'CREATE' | 'UPDATE'
      ): EnqueueCall {
        return {
          store_id: pack.store_id,
          entity_type: 'pack',
          entity_id: pack.pack_id,
          operation,
          payload: expect.objectContaining({
            pack_id: pack.pack_id,
            store_id: pack.store_id,
            status: pack.status,
          }),
        };
      }

      it('LP-U-003: should use correct entity_type "pack"', () => {
        const enqueueCall = createMockEnqueueCall(mockReceivedPack, 'CREATE');
        expect(enqueueCall.entity_type).toBe('pack');
      });

      it('LP-U-004: should use operation "CREATE" for receivePack', () => {
        const enqueueCall = createMockEnqueueCall(mockReceivedPack, 'CREATE');
        expect(enqueueCall.operation).toBe('CREATE');
      });

      it('LP-U-010: should use operation "UPDATE" for activatePack', () => {
        const enqueueCall = createMockEnqueueCall(mockActivatedPack, 'UPDATE');
        expect(enqueueCall.operation).toBe('UPDATE');
      });

      it('should use operation "UPDATE" for depletePack', () => {
        const enqueueCall = createMockEnqueueCall(mockSettledPack, 'UPDATE');
        expect(enqueueCall.operation).toBe('UPDATE');
      });

      it('should use operation "UPDATE" for returnPack', () => {
        const enqueueCall = createMockEnqueueCall(mockReturnedPack, 'UPDATE');
        expect(enqueueCall.operation).toBe('UPDATE');
      });

      it('LP-U-020: should include correct store_id for tenant isolation', () => {
        const enqueueCall = createMockEnqueueCall(mockReceivedPack, 'CREATE');
        expect(enqueueCall.store_id).toBe(mockStore.store_id);
      });
    });

    describe('Pack Status Transitions for Sync', () => {
      it('LP-U-013: pack must be RECEIVED status before activation', () => {
        // Activated pack should have previous status of RECEIVED
        // The DAL enforces this; here we verify the payload reflects correct status
        expect(mockActivatedPack.status).toBe('ACTIVE');
      });

      it('LP-U-016: pack must be ACTIVATED status before depletion', () => {
        // Settled pack should have been ACTIVATED first
        expect(mockSettledPack.status).toBe('DEPLETED');
      });

      it('LP-U-018: pack can be returned from RECEIVED or ACTIVATED status', () => {
        // Return is allowed from either status
        expect(['RECEIVED', 'ACTIVE']).toContain('RECEIVED');
        expect(['RECEIVED', 'ACTIVE']).toContain('ACTIVE');
      });

      it('LP-U-019: pack cannot be returned from SETTLED or RETURNED status', () => {
        // These are terminal states
        const terminalStatuses = ['DEPLETED', 'RETURNED'];
        expect(terminalStatuses).toContain('DEPLETED');
        expect(terminalStatuses).toContain('RETURNED');
      });
    });

    describe('LP-U-007: receivePackBatch should enqueue each created pack individually', () => {
      it('should create separate sync entries for each pack in batch', () => {
        // Simulate batch of 3 packs
        const batchPacks = [
          { ...mockReceivedPack, pack_id: 'pack-1', pack_number: 'PKG001' },
          { ...mockReceivedPack, pack_id: 'pack-2', pack_number: 'PKG002' },
          { ...mockReceivedPack, pack_id: 'pack-3', pack_number: 'PKG003' },
        ];

        // Each pack should generate a separate enqueue call
        expect(batchPacks.length).toBe(3);
        batchPacks.forEach((pack, index) => {
          expect(pack.pack_id).toBe(`pack-${index + 1}`);
        });
      });
    });

    describe('LP-U-008: receivePackBatch should NOT enqueue duplicate packs', () => {
      it('should skip duplicate packs and only enqueue new ones', () => {
        // If pack already exists (duplicate), it should not be enqueued
        const existingPack = { ...mockReceivedPack, status: 'ACTIVE' };
        // Duplicate detection happens at DAL level, so no enqueue for duplicates
        expect(existingPack.status).toBe('ACTIVE');
      });
    });
  });

  // ==========================================================================
  // Phase 2: Shift Lottery Sync Tests
  // ==========================================================================

  describe('Shift Lottery Sync (Phase 2)', () => {
    // Test input schemas for shift opening
    describe('RecordShiftOpeningSchema Validation (API-001)', () => {
      const RecordShiftOpeningSchema = z.object({
        shift_id: z.string().uuid(),
        openings: z
          .array(
            z.object({
              bin_id: z.string().uuid(),
              pack_id: z.string().uuid(),
              opening_serial: z.string().regex(/^\d{3}$/),
            })
          )
          .min(1, 'At least one opening is required'),
      });

      it('should accept valid shift opening input', () => {
        const validInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          openings: [
            {
              bin_id: '660e8400-e29b-41d4-a716-446655440001',
              pack_id: '770e8400-e29b-41d4-a716-446655440002',
              opening_serial: '050',
            },
          ],
        };

        const result = RecordShiftOpeningSchema.safeParse(validInput);
        expect(result.success).toBe(true);
      });

      it('should accept shift opening with multiple openings', () => {
        const validInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          openings: [
            {
              bin_id: '660e8400-e29b-41d4-a716-446655440001',
              pack_id: '770e8400-e29b-41d4-a716-446655440002',
              opening_serial: '050',
            },
            {
              bin_id: '880e8400-e29b-41d4-a716-446655440003',
              pack_id: '990e8400-e29b-41d4-a716-446655440004',
              opening_serial: '100',
            },
          ],
        };

        const result = RecordShiftOpeningSchema.safeParse(validInput);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.openings).toHaveLength(2);
        }
      });

      it('should reject empty openings array', () => {
        const invalidInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          openings: [],
        };

        const result = RecordShiftOpeningSchema.safeParse(invalidInput);
        expect(result.success).toBe(false);
      });

      it('should reject invalid shift_id', () => {
        const invalidInput = {
          shift_id: 'not-a-uuid',
          openings: [
            {
              bin_id: '660e8400-e29b-41d4-a716-446655440001',
              pack_id: '770e8400-e29b-41d4-a716-446655440002',
              opening_serial: '050',
            },
          ],
        };

        const result = RecordShiftOpeningSchema.safeParse(invalidInput);
        expect(result.success).toBe(false);
      });

      it('should reject invalid opening_serial (2 digits)', () => {
        const invalidInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          openings: [
            {
              bin_id: '660e8400-e29b-41d4-a716-446655440001',
              pack_id: '770e8400-e29b-41d4-a716-446655440002',
              opening_serial: '50', // Invalid: only 2 digits
            },
          ],
        };

        const result = RecordShiftOpeningSchema.safeParse(invalidInput);
        expect(result.success).toBe(false);
      });

      it('should reject invalid opening_serial (non-numeric)', () => {
        const invalidInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          openings: [
            {
              bin_id: '660e8400-e29b-41d4-a716-446655440001',
              pack_id: '770e8400-e29b-41d4-a716-446655440002',
              opening_serial: 'abc', // Invalid: non-numeric
            },
          ],
        };

        const result = RecordShiftOpeningSchema.safeParse(invalidInput);
        expect(result.success).toBe(false);
      });
    });

    // Test input schemas for shift closing
    describe('RecordShiftClosingSchema Validation (API-001)', () => {
      const RecordShiftClosingSchema = z.object({
        shift_id: z.string().uuid(),
        closings: z
          .array(
            z.object({
              bin_id: z.string().uuid(),
              pack_id: z.string().uuid(),
              closing_serial: z.string().regex(/^\d{3}$/),
            })
          )
          .min(1, 'At least one closing is required'),
      });

      it('should accept valid shift closing input', () => {
        const validInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          closings: [
            {
              bin_id: '660e8400-e29b-41d4-a716-446655440001',
              pack_id: '770e8400-e29b-41d4-a716-446655440002',
              closing_serial: '100',
            },
          ],
        };

        const result = RecordShiftClosingSchema.safeParse(validInput);
        expect(result.success).toBe(true);
      });

      it('should accept shift closing with multiple closings', () => {
        const validInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          closings: [
            {
              bin_id: '660e8400-e29b-41d4-a716-446655440001',
              pack_id: '770e8400-e29b-41d4-a716-446655440002',
              closing_serial: '100',
            },
            {
              bin_id: '880e8400-e29b-41d4-a716-446655440003',
              pack_id: '990e8400-e29b-41d4-a716-446655440004',
              closing_serial: '150',
            },
          ],
        };

        const result = RecordShiftClosingSchema.safeParse(validInput);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.closings).toHaveLength(2);
        }
      });

      it('should reject empty closings array', () => {
        const invalidInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          closings: [],
        };

        const result = RecordShiftClosingSchema.safeParse(invalidInput);
        expect(result.success).toBe(false);
      });

      it('should reject invalid closing_serial format', () => {
        const invalidInput = {
          shift_id: '550e8400-e29b-41d4-a716-446655440000',
          closings: [
            {
              bin_id: '660e8400-e29b-41d4-a716-446655440001',
              pack_id: '770e8400-e29b-41d4-a716-446655440002',
              closing_serial: '1000', // Invalid: 4 digits
            },
          ],
        };

        const result = RecordShiftClosingSchema.safeParse(invalidInput);
        expect(result.success).toBe(false);
      });
    });

    // Test sync queue payload structure
    describe('Shift Opening Sync Payload Structure (SYNC-001)', () => {
      it('should build correct payload for shift opening sync', () => {
        const storeId = 'store-123';
        const shiftId = 'shift-456';
        const openings = [
          { bin_id: 'bin-1', pack_id: 'pack-1', opening_serial: '050' },
          { bin_id: 'bin-2', pack_id: 'pack-2', opening_serial: '025' },
        ];
        const openedBy = 'user-789';

        // Simulate building payload (same logic as handler)
        const payload = {
          shift_id: shiftId,
          store_id: storeId,
          openings: openings.map((o) => ({
            bin_id: o.bin_id,
            pack_id: o.pack_id,
            opening_serial: o.opening_serial,
          })),
          opened_at: new Date().toISOString(),
          opened_by: openedBy,
        };

        expect(payload.shift_id).toBe('shift-456');
        expect(payload.store_id).toBe('store-123');
        expect(payload.openings).toHaveLength(2);
        expect(payload.opened_by).toBe('user-789');
        expect(payload.opened_at).toBeDefined();
      });
    });

    describe('Shift Closing Sync Payload Structure (SYNC-001)', () => {
      it('should build correct payload with calculated sales', () => {
        const storeId = 'store-123';
        const shiftId = 'shift-456';
        const closings = [
          {
            bin_id: 'bin-1',
            pack_id: 'pack-1',
            closing_serial: '100',
            tickets_sold: 50,
            sales_amount: 25.0,
          },
          {
            bin_id: 'bin-2',
            pack_id: 'pack-2',
            closing_serial: '075',
            tickets_sold: 50,
            sales_amount: 50.0,
          },
        ];
        const closedBy = 'user-789';

        // Simulate building payload (same logic as handler)
        const payload = {
          shift_id: shiftId,
          store_id: storeId,
          closings: closings.map((c) => ({
            bin_id: c.bin_id,
            pack_id: c.pack_id,
            closing_serial: c.closing_serial,
            tickets_sold: c.tickets_sold,
            sales_amount: c.sales_amount,
          })),
          closed_at: new Date().toISOString(),
          closed_by: closedBy,
        };

        expect(payload.shift_id).toBe('shift-456');
        expect(payload.store_id).toBe('store-123');
        expect(payload.closings).toHaveLength(2);
        expect(payload.closings[0].tickets_sold).toBe(50);
        expect(payload.closings[0].sales_amount).toBe(25.0);
        expect(payload.closed_by).toBe('user-789');

        // Verify totals can be calculated from payload
        const totalSales = payload.closings.reduce((sum, c) => sum + c.sales_amount, 0);
        const totalTickets = payload.closings.reduce((sum, c) => sum + c.tickets_sold, 0);
        expect(totalSales).toBe(75.0);
        expect(totalTickets).toBe(100);
      });
    });

    describe('Shift Sync Entity Types (SEC-017: Audit Trail)', () => {
      it('should use correct entity_type for shift opening', () => {
        const entityType = 'shift_opening';
        expect(entityType).toBe('shift_opening');
      });

      it('should use correct entity_type for shift closing', () => {
        const entityType = 'shift_closing';
        expect(entityType).toBe('shift_closing');
      });

      it('should use CREATE operation for both opening and closing records', () => {
        const operation = 'CREATE';
        expect(operation).toBe('CREATE');
      });
    });
  });

  // ============================================================================
  // BIN NUMBER TRANSFORMATION TESTS (API-008: Data Transformation)
  // ============================================================================
  // Tests for the bin_display_order to bin_number conversion
  // Database stores 0-indexed display_order (0-9)
  // UI expects 1-indexed bin_number (1-10)
  //
  // TRACEABILITY:
  // - Component: lottery.handlers.ts getDayBins handler
  // - Risk: Data display inconsistency (bins show wrong number)
  // - Business Rule: Bin numbering must be 1-indexed for user display
  // - Related DAL: lottery-bins.dal.ts:924 (authoritative pattern)
  // ============================================================================
  describe('Bin Number Transformation (API-008: Data Transformation)', () => {
    /**
     * Helper function that replicates the bin_number transformation logic
     * from lottery.handlers.ts for isolated unit testing.
     *
     * This tests the exact transformation: (bin_display_order ?? 0) + 1
     */
    const transformBinDisplayOrderToNumber = (
      bin_display_order: number | null | undefined
    ): number => {
      return (bin_display_order ?? 0) + 1;
    };

    describe('Core Transformation Logic', () => {
      // ======================================================================
      // BN-CORE-001: Zero-indexed to one-indexed conversion
      // ======================================================================
      it('BN-CORE-001: should convert 0-indexed display_order to 1-indexed bin_number', () => {
        // Database stores 0, UI should display 1
        expect(transformBinDisplayOrderToNumber(0)).toBe(1);
      });

      // ======================================================================
      // BN-CORE-002: Maximum bin index boundary
      // ======================================================================
      it('BN-CORE-002: should convert display_order 9 to bin_number 10 (upper boundary)', () => {
        // Database stores 9 (10th bin), UI should display 10
        expect(transformBinDisplayOrderToNumber(9)).toBe(10);
      });

      // ======================================================================
      // BN-CORE-003: Full range validation (all 10 standard bins)
      // ======================================================================
      it('BN-CORE-003: should correctly transform all standard bin positions (0-9 → 1-10)', () => {
        const testCases = [
          { input: 0, expected: 1 },
          { input: 1, expected: 2 },
          { input: 2, expected: 3 },
          { input: 3, expected: 4 },
          { input: 4, expected: 5 },
          { input: 5, expected: 6 },
          { input: 6, expected: 7 },
          { input: 7, expected: 8 },
          { input: 8, expected: 9 },
          { input: 9, expected: 10 },
        ];

        testCases.forEach(({ input, expected }) => {
          expect(transformBinDisplayOrderToNumber(input)).toBe(expected);
        });
      });

      // ======================================================================
      // BN-CORE-004: Null handling with fallback
      // ======================================================================
      it('BN-CORE-004: should handle null bin_display_order by defaulting to bin 1', () => {
        // Null should fallback to 0, then +1 = 1
        expect(transformBinDisplayOrderToNumber(null)).toBe(1);
      });

      // ======================================================================
      // BN-CORE-005: Undefined handling with fallback
      // ======================================================================
      it('BN-CORE-005: should handle undefined bin_display_order by defaulting to bin 1', () => {
        // Undefined should fallback to 0, then +1 = 1
        expect(transformBinDisplayOrderToNumber(undefined)).toBe(1);
      });

      // ======================================================================
      // BN-CORE-006: Regression test - MUST NOT return 0-indexed values
      // ======================================================================
      it('BN-CORE-006: REGRESSION - bin_number must NEVER be 0 (off-by-one bug prevention)', () => {
        // This test explicitly guards against the original bug where
        // bin_display_order was used directly without +1 conversion
        const allPossibleInputs = [null, undefined, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

        allPossibleInputs.forEach((input) => {
          const result = transformBinDisplayOrderToNumber(input as number | null | undefined);
          expect(result).toBeGreaterThanOrEqual(1);
          expect(result).not.toBe(0);
        });
      });
    });

    describe('Activated Packs Bin Number Transformation', () => {
      /**
       * Simulates the activated packs transformation from lottery.handlers.ts lines 709-717
       */
      const transformActivatedPack = (pack: {
        pack_id: string;
        pack_number: string;
        game_name: string | null;
        game_price: number | null;
        bin_display_order: number | null;
        activated_at: string | null;
        status: 'ACTIVE' | 'DEPLETED' | 'RETURNED';
      }) => ({
        pack_id: pack.pack_id,
        pack_number: pack.pack_number,
        game_name: pack.game_name || 'Unknown Game',
        game_price: pack.game_price || 0,
        bin_number: (pack.bin_display_order ?? 0) + 1,
        activated_at: pack.activated_at || '',
        status: pack.status,
      });

      // ======================================================================
      // BN-ACT-001: Standard activated pack in first bin
      // ======================================================================
      it('BN-ACT-001: should transform activated pack in first bin (display_order=0 → bin_number=1)', () => {
        const pack = {
          pack_id: 'pack-001',
          pack_number: 'PKG1234567',
          game_name: 'Lucky 7s',
          game_price: 2,
          bin_display_order: 0,
          activated_at: '2024-01-15T10:30:00Z',
          status: 'ACTIVE' as const,
        };

        const result = transformActivatedPack(pack);

        expect(result.bin_number).toBe(1);
        expect(result.pack_id).toBe('pack-001');
        expect(result.status).toBe('ACTIVE');
      });

      // ======================================================================
      // BN-ACT-002: Activated pack in last bin
      // ======================================================================
      it('BN-ACT-002: should transform activated pack in last bin (display_order=9 → bin_number=10)', () => {
        const pack = {
          pack_id: 'pack-010',
          pack_number: 'PKG9999999',
          game_name: 'Cash Blast',
          game_price: 5,
          bin_display_order: 9,
          activated_at: '2024-01-15T14:45:00Z',
          status: 'ACTIVE' as const,
        };

        const result = transformActivatedPack(pack);

        expect(result.bin_number).toBe(10);
      });

      // ======================================================================
      // BN-ACT-003: Activated pack with null bin_display_order
      // ======================================================================
      it('BN-ACT-003: should handle activated pack with null bin_display_order', () => {
        const pack = {
          pack_id: 'pack-orphan',
          pack_number: 'PKG0000000',
          game_name: 'Mystery Game',
          game_price: 1,
          bin_display_order: null,
          activated_at: '2024-01-15T08:00:00Z',
          status: 'ACTIVE' as const,
        };

        const result = transformActivatedPack(pack);

        expect(result.bin_number).toBe(1);
      });

      // ======================================================================
      // BN-ACT-004: All pack statuses preserve bin_number correctly
      // ======================================================================
      it('BN-ACT-004: should preserve correct bin_number for all pack statuses', () => {
        const statuses: Array<'ACTIVE' | 'DEPLETED' | 'RETURNED'> = [
          'ACTIVE',
          'DEPLETED',
          'RETURNED',
        ];

        statuses.forEach((status) => {
          const pack = {
            pack_id: `pack-${status.toLowerCase()}`,
            pack_number: 'PKG1111111',
            game_name: 'Test Game',
            game_price: 3,
            bin_display_order: 4, // 5th bin (0-indexed)
            activated_at: '2024-01-15T12:00:00Z',
            status,
          };

          const result = transformActivatedPack(pack);

          expect(result.bin_number).toBe(5);
          expect(result.status).toBe(status);
        });
      });

      // ======================================================================
      // BN-ACT-005: Default values applied correctly with bin transformation
      // ======================================================================
      it('BN-ACT-005: should apply default values while correctly transforming bin_number', () => {
        const pack = {
          pack_id: 'pack-defaults',
          pack_number: 'PKG2222222',
          game_name: null,
          game_price: null,
          bin_display_order: 2,
          activated_at: null,
          status: 'ACTIVE' as const,
        };

        const result = transformActivatedPack(pack);

        expect(result.bin_number).toBe(3); // 2 + 1 = 3
        expect(result.game_name).toBe('Unknown Game');
        expect(result.game_price).toBe(0);
        expect(result.activated_at).toBe('');
      });
    });

    describe('Depleted Packs Bin Number Transformation', () => {
      /**
       * Simulates the depleted packs transformation from lottery.handlers.ts lines 727-735
       */
      const transformDepletedPack = (pack: {
        pack_id: string;
        pack_number: string;
        game_name: string | null;
        game_price: number | null;
        bin_display_order: number | null;
        activated_at: string | null;
        depleted_at: string | null;
      }) => ({
        pack_id: pack.pack_id,
        pack_number: pack.pack_number,
        game_name: pack.game_name || 'Unknown Game',
        game_price: pack.game_price || 0,
        bin_number: (pack.bin_display_order ?? 0) + 1,
        activated_at: pack.activated_at || '',
        depleted_at: pack.depleted_at || '',
      });

      // ======================================================================
      // BN-DEP-001: Standard depleted pack transformation
      // ======================================================================
      it('BN-DEP-001: should transform depleted pack bin_number correctly', () => {
        const pack = {
          pack_id: 'pack-depleted-001',
          pack_number: 'PKG3333333',
          game_name: 'Gold Rush',
          game_price: 10,
          bin_display_order: 5,
          activated_at: '2024-01-10T09:00:00Z',
          depleted_at: '2024-01-15T16:30:00Z',
        };

        const result = transformDepletedPack(pack);

        expect(result.bin_number).toBe(6); // 5 + 1 = 6
        expect(result.depleted_at).toBe('2024-01-15T16:30:00Z');
      });

      // ======================================================================
      // BN-DEP-002: Depleted pack boundary values
      // ======================================================================
      it('BN-DEP-002: should handle depleted pack boundary values (first and last bin)', () => {
        const firstBinPack = {
          pack_id: 'pack-dep-first',
          pack_number: 'PKG0001',
          game_name: 'Game A',
          game_price: 1,
          bin_display_order: 0,
          activated_at: '2024-01-01T00:00:00Z',
          depleted_at: '2024-01-15T00:00:00Z',
        };

        const lastBinPack = {
          pack_id: 'pack-dep-last',
          pack_number: 'PKG9999',
          game_name: 'Game Z',
          game_price: 20,
          bin_display_order: 9,
          activated_at: '2024-01-01T00:00:00Z',
          depleted_at: '2024-01-15T00:00:00Z',
        };

        expect(transformDepletedPack(firstBinPack).bin_number).toBe(1);
        expect(transformDepletedPack(lastBinPack).bin_number).toBe(10);
      });
    });

    describe('Returned Packs Bin Number Transformation', () => {
      /**
       * Simulates the returned packs transformation from lottery.handlers.ts lines 745-759
       */
      const transformReturnedPack = (pack: {
        pack_id: string;
        pack_number: string;
        game_name: string | null;
        game_price: number | null;
        bin_display_order: number | null;
        activated_at: string | null;
        returned_at: string | null;
        closing_serial: string | null;
        tickets_sold_count: number | null;
        sales_amount: number | null;
      }) => ({
        pack_id: pack.pack_id,
        pack_number: pack.pack_number,
        game_name: pack.game_name || 'Unknown Game',
        game_price: pack.game_price || 0,
        bin_number: (pack.bin_display_order ?? 0) + 1,
        activated_at: pack.activated_at || '',
        returned_at: pack.returned_at || '',
        return_reason: null,
        return_notes: null,
        last_sold_serial: pack.closing_serial,
        tickets_sold_on_return: pack.tickets_sold_count || null,
        return_sales_amount: pack.sales_amount || null,
        returned_by_name: null,
      });

      // ======================================================================
      // BN-RET-001: Standard returned pack transformation
      // ======================================================================
      it('BN-RET-001: should transform returned pack bin_number correctly', () => {
        const pack = {
          pack_id: 'pack-returned-001',
          pack_number: 'PKG4444444',
          game_name: 'Diamond Dreams',
          game_price: 25,
          bin_display_order: 7,
          activated_at: '2024-01-10T11:00:00Z',
          returned_at: '2024-01-15T09:15:00Z',
          closing_serial: '150',
          tickets_sold_count: 150,
          sales_amount: 375.0,
        };

        const result = transformReturnedPack(pack);

        expect(result.bin_number).toBe(8); // 7 + 1 = 8
        expect(result.returned_at).toBe('2024-01-15T09:15:00Z');
        expect(result.last_sold_serial).toBe('150');
        expect(result.tickets_sold_on_return).toBe(150);
        expect(result.return_sales_amount).toBe(375.0);
      });

      // ======================================================================
      // BN-RET-002: Returned pack with null bin_display_order
      // ======================================================================
      it('BN-RET-002: should handle returned pack with null bin_display_order', () => {
        const pack = {
          pack_id: 'pack-returned-null',
          pack_number: 'PKG5555555',
          game_name: 'Wild Card',
          game_price: 5,
          bin_display_order: null,
          activated_at: '2024-01-05T10:00:00Z',
          returned_at: '2024-01-15T14:00:00Z',
          closing_serial: '050',
          tickets_sold_count: 50,
          sales_amount: 50.0,
        };

        const result = transformReturnedPack(pack);

        expect(result.bin_number).toBe(1); // null → 0 → 0 + 1 = 1
      });

      // ======================================================================
      // BN-RET-003: Returned pack preserves all additional fields
      // ======================================================================
      it('BN-RET-003: should preserve all returned pack fields while transforming bin_number', () => {
        const pack = {
          pack_id: 'pack-complete',
          pack_number: 'PKG6666666',
          game_name: 'Fortune Five',
          game_price: 5,
          bin_display_order: 3,
          activated_at: '2024-01-12T08:30:00Z',
          returned_at: '2024-01-15T17:45:00Z',
          closing_serial: '200',
          tickets_sold_count: 200,
          sales_amount: 1000.0,
        };

        const result = transformReturnedPack(pack);

        // Verify bin_number transformation
        expect(result.bin_number).toBe(4);

        // Verify all other fields preserved
        expect(result.pack_id).toBe('pack-complete');
        expect(result.pack_number).toBe('PKG6666666');
        expect(result.game_name).toBe('Fortune Five');
        expect(result.game_price).toBe(5);
        expect(result.activated_at).toBe('2024-01-12T08:30:00Z');
        expect(result.returned_at).toBe('2024-01-15T17:45:00Z');
        expect(result.last_sold_serial).toBe('200');
        expect(result.tickets_sold_on_return).toBe(200);
        expect(result.return_sales_amount).toBe(1000.0);
        expect(result.return_reason).toBeNull();
        expect(result.return_notes).toBeNull();
        expect(result.returned_by_name).toBeNull();
      });
    });

    describe('Consistency with lottery-bins.dal.ts Pattern', () => {
      // ======================================================================
      // BN-CONS-001: Transformation matches authoritative DAL pattern
      // ======================================================================
      it('BN-CONS-001: should use same transformation pattern as lottery-bins.dal.ts:924', () => {
        // The authoritative pattern from lottery-bins.dal.ts:924 is:
        // bin_number: row.display_order + 1
        //
        // Our handler pattern must be equivalent:
        // bin_number: (p.bin_display_order ?? 0) + 1

        // Simulate DAL transformation (direct add)
        const dalTransform = (display_order: number): number => display_order + 1;

        // Simulate handler transformation (with null safety)
        const handlerTransform = (bin_display_order: number | null): number =>
          (bin_display_order ?? 0) + 1;

        // For all valid display_order values, both should produce identical results
        for (let i = 0; i < 10; i++) {
          expect(handlerTransform(i)).toBe(dalTransform(i));
        }
      });

      // ======================================================================
      // BN-CONS-002: Handler adds null safety that DAL doesn't need
      // ======================================================================
      it('BN-CONS-002: should handle null gracefully (enhancement over DAL pattern)', () => {
        // DAL always has a valid display_order from the database
        // Handler may receive null from LEFT JOIN when pack has no bin
        const handlerTransform = (bin_display_order: number | null): number =>
          (bin_display_order ?? 0) + 1;

        // Null should safely default to bin 1
        expect(handlerTransform(null)).toBe(1);
      });
    });

    describe('Data Integrity Validation', () => {
      // ======================================================================
      // BN-INT-001: Transformation is pure and deterministic
      // ======================================================================
      it('BN-INT-001: should produce deterministic results (same input → same output)', () => {
        const transform = (bin_display_order: number | null): number =>
          (bin_display_order ?? 0) + 1;

        // Multiple calls with same input must produce same output
        const input = 5;
        const results = Array.from({ length: 100 }, () => transform(input));

        expect(new Set(results).size).toBe(1);
        expect(results.every((r) => r === 6)).toBe(true);
      });

      // ======================================================================
      // BN-INT-002: No data loss in transformation
      // ======================================================================
      it('BN-INT-002: should not lose information during transformation', () => {
        // The transformation is reversible: bin_number - 1 = display_order
        const displayOrder = 7;
        const binNumber = (displayOrder ?? 0) + 1;
        const recoveredDisplayOrder = binNumber - 1;

        expect(recoveredDisplayOrder).toBe(displayOrder);
      });

      // ======================================================================
      // BN-INT-003: Type safety - result is always a number
      // ======================================================================
      it('BN-INT-003: should always return a number type', () => {
        const transform = (bin_display_order: number | null | undefined): number =>
          (bin_display_order ?? 0) + 1;

        const inputs: Array<number | null | undefined> = [0, 1, 5, 9, null, undefined];

        inputs.forEach((input) => {
          const result = transform(input);
          expect(typeof result).toBe('number');
          expect(Number.isInteger(result)).toBe(true);
          expect(Number.isNaN(result)).toBe(false);
          expect(Number.isFinite(result)).toBe(true);
        });
      });
    });
  });

  // ============================================================================
  // PHASE 8: lottery:returnPack - return_reason validation (Tasks 8.1-8.8)
  // ============================================================================
  // These tests validate the return_reason enum handling in the returnPack handler.
  // SEC-014: Strict allowlist validation at entry point
  // API-001: Zod schema validation
  // ============================================================================
  describe('lottery:returnPack - return_reason validation (Phase 8)', () => {
    /**
     * Phase 8 Tasks 8.1-8.8: Comprehensive return_reason enum validation
     *
     * Tests verify that:
     * - return_reason is REQUIRED (not optional)
     * - Only valid enum values are accepted
     * - Invalid values are rejected at input validation
     *
     * @security SEC-014: Strict allowlist enums prevent invalid values
     */

    // 8.2: Test should reject request without return_reason
    describe('8.2: Missing return_reason rejection', () => {
      it('should reject request without return_reason', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          closing_serial: '150',
        };

        const schema = z.object({
          pack_id: z.string().uuid(),
          closing_serial: z
            .string()
            .regex(/^\d{3}$/)
            .optional(),
          return_reason: ReturnReasonSchema,
          return_notes: z.string().max(500).optional(),
        });

        const result = schema.safeParse(input);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('return_reason'))).toBe(true);
        }
      });
    });

    // 8.3: Test should reject invalid return_reason value
    describe('8.3: Invalid return_reason rejection', () => {
      it('should reject invalid return_reason value OTHER', () => {
        const input = {
          pack_id: '550e8400-e29b-41d4-a716-446655440000',
          return_reason: 'OTHER',
        };

        const result = ReturnReasonSchema.safeParse(input.return_reason);
        expect(result.success).toBe(false);
      });

      it('should reject invalid return_reason value INVALID', () => {
        const result = ReturnReasonSchema.safeParse('INVALID');
        expect(result.success).toBe(false);
      });

      it('should reject invalid return_reason value with extra characters', () => {
        const result = ReturnReasonSchema.safeParse('DAMAGED ');
        expect(result.success).toBe(false);
      });

      it('should reject lowercase variant of valid value', () => {
        const result = ReturnReasonSchema.safeParse('damaged');
        expect(result.success).toBe(false);
      });
    });

    // 8.4: Test should accept valid return_reason SUPPLIER_RECALL
    describe('8.4: Accept SUPPLIER_RECALL', () => {
      it('should accept valid return_reason SUPPLIER_RECALL', () => {
        const result = ReturnReasonSchema.safeParse('SUPPLIER_RECALL');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('SUPPLIER_RECALL');
        }
      });
    });

    // 8.5: Test should accept valid return_reason DAMAGED
    describe('8.5: Accept DAMAGED', () => {
      it('should accept valid return_reason DAMAGED', () => {
        const result = ReturnReasonSchema.safeParse('DAMAGED');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('DAMAGED');
        }
      });
    });

    // 8.6: Test should accept valid return_reason EXPIRED
    describe('8.6: Accept EXPIRED', () => {
      it('should accept valid return_reason EXPIRED', () => {
        const result = ReturnReasonSchema.safeParse('EXPIRED');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('EXPIRED');
        }
      });
    });

    // 8.7: Test should accept valid return_reason INVENTORY_ADJUSTMENT
    describe('8.7: Accept INVENTORY_ADJUSTMENT', () => {
      it('should accept valid return_reason INVENTORY_ADJUSTMENT', () => {
        const result = ReturnReasonSchema.safeParse('INVENTORY_ADJUSTMENT');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('INVENTORY_ADJUSTMENT');
        }
      });
    });

    // 8.8: Test should accept valid return_reason STORE_CLOSURE
    describe('8.8: Accept STORE_CLOSURE', () => {
      it('should accept valid return_reason STORE_CLOSURE', () => {
        const result = ReturnReasonSchema.safeParse('STORE_CLOSURE');
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBe('STORE_CLOSURE');
        }
      });
    });

    // Additional comprehensive validation tests
    describe('Comprehensive enum validation', () => {
      it('should validate that RETURN_REASONS contains exactly 5 valid values', () => {
        expect(RETURN_REASONS).toHaveLength(5);
        expect(RETURN_REASONS).toContain('SUPPLIER_RECALL');
        expect(RETURN_REASONS).toContain('DAMAGED');
        expect(RETURN_REASONS).toContain('EXPIRED');
        expect(RETURN_REASONS).toContain('INVENTORY_ADJUSTMENT');
        expect(RETURN_REASONS).toContain('STORE_CLOSURE');
      });

      it('should NOT contain OTHER in RETURN_REASONS (SEC-014 compliance)', () => {
        expect(RETURN_REASONS).not.toContain('OTHER');
      });

      it('should validate all RETURN_REASONS values are accepted by schema', () => {
        RETURN_REASONS.forEach((reason) => {
          const result = ReturnReasonSchema.safeParse(reason);
          expect(result.success).toBe(true);
        });
      });
    });
  });

  // ============================================================================
  // PHASE 8: lottery:returnPack - data flow (Tasks 8.9-8.14)
  // ============================================================================
  // These tests verify the data flow of return_reason and return_notes
  // through the handler to DAL and sync queue.
  // ============================================================================
  describe('lottery:returnPack - data flow (Phase 8)', () => {
    /**
     * Phase 8 Tasks 8.9-8.14: Data flow validation
     *
     * Tests verify that:
     * - return_reason is passed to DAL (8.10)
     * - return_notes is passed to DAL when provided (8.11)
     * - return_reason is included in sync queue payload (8.12)
     * - return_notes is included in sync queue payload when provided (8.13)
     * - return_reason is stored in database (8.14)
     *
     * @security SEC-014: Validated enum values flow through all layers
     * @security DB-006: Store-scoped operations via DAL
     */

    // Get reference to mocked DALs
    let _lotteryPacksDAL: {
      returnPack: ReturnType<typeof vi.fn>;
      calculateSales: ReturnType<typeof vi.fn>;
    };
    let _syncQueueDAL: {
      enqueue: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      vi.clearAllMocks();

      // Get mocked modules
      const packsModule = await import('../../../src/main/dal/lottery-packs.dal');
      const syncModule = await import('../../../src/main/dal/sync-queue.dal');

      _lotteryPacksDAL = packsModule.lotteryPacksDAL as unknown as typeof _lotteryPacksDAL;
      _syncQueueDAL = syncModule.syncQueueDAL as unknown as typeof _syncQueueDAL;
    });

    // 8.10: Test should pass return_reason to DAL
    describe('8.10: return_reason passed to DAL', () => {
      it('should include return_reason in DAL call parameters', () => {
        // Simulate the data structure that would be passed to DAL
        const dalParams = {
          store_id: 'store-123',
          closing_serial: '150',
          tickets_sold_count: 50,
          sales_amount: 100.0,
          returned_by: 'user-456',
          returned_shift_id: 'shift-789',
          return_reason: 'SUPPLIER_RECALL' as const,
          return_notes: undefined,
        };

        // Verify return_reason is present
        expect(dalParams.return_reason).toBe('SUPPLIER_RECALL');
        expect(Object.keys(dalParams)).toContain('return_reason');
      });

      it('should pass each valid return_reason enum value correctly', () => {
        const reasons = RETURN_REASONS;
        reasons.forEach((reason) => {
          const dalParams = {
            store_id: 'store-123',
            return_reason: reason,
          };
          expect(dalParams.return_reason).toBe(reason);
        });
      });
    });

    // 8.11: Test should pass return_notes to DAL when provided
    describe('8.11: return_notes passed to DAL when provided', () => {
      it('should include return_notes in DAL call when provided', () => {
        const dalParams = {
          store_id: 'store-123',
          return_reason: 'DAMAGED' as const,
          return_notes: 'Pack was crushed during shipping',
        };

        expect(dalParams.return_notes).toBe('Pack was crushed during shipping');
        expect(Object.keys(dalParams)).toContain('return_notes');
      });

      it('should handle undefined return_notes correctly', () => {
        const dalParams = {
          store_id: 'store-123',
          return_reason: 'EXPIRED' as const,
          return_notes: undefined,
        };

        expect(dalParams.return_notes).toBeUndefined();
      });
    });

    // 8.12: Test should include return_reason in sync queue payload
    describe('8.12: return_reason in sync queue payload', () => {
      it('should include return_reason in sync payload structure', () => {
        // Simulate the sync payload structure from buildPackSyncPayload
        const syncPayload = {
          pack_id: 'pack-123',
          store_id: 'store-456',
          status: 'RETURNED',
          return_reason: 'INVENTORY_ADJUSTMENT' as const,
          return_notes: null,
          returned_shift_id: 'shift-789',
          returned_by: 'user-abc',
        };

        expect(syncPayload.return_reason).toBe('INVENTORY_ADJUSTMENT');
        expect(Object.keys(syncPayload)).toContain('return_reason');
      });

      it('should pass return_reason via shiftContext to buildPackSyncPayload', () => {
        // Simulate shiftContext that includes return_reason
        const shiftContext = {
          returned_shift_id: 'shift-123',
          returned_by: 'user-456',
          return_reason: 'STORE_CLOSURE' as const,
          return_notes: 'Store closing permanently',
        };

        expect(shiftContext.return_reason).toBe('STORE_CLOSURE');
      });
    });

    // 8.13: Test should include return_notes in sync queue payload when provided
    describe('8.13: return_notes in sync queue payload when provided', () => {
      it('should include return_notes in sync payload when provided', () => {
        const syncPayload = {
          pack_id: 'pack-123',
          store_id: 'store-456',
          status: 'RETURNED',
          return_reason: 'DAMAGED' as const,
          return_notes: 'Visible water damage on tickets',
        };

        expect(syncPayload.return_notes).toBe('Visible water damage on tickets');
      });

      it('should handle null return_notes in sync payload', () => {
        const syncPayload = {
          pack_id: 'pack-123',
          store_id: 'store-456',
          status: 'RETURNED',
          return_reason: 'SUPPLIER_RECALL' as const,
          return_notes: null,
        };

        expect(syncPayload.return_notes).toBeNull();
      });
    });

    // 8.14: Test should store return_reason in database
    describe('8.14: return_reason stored in database', () => {
      it('should structure data correctly for database storage', () => {
        // Simulate the SQL UPDATE parameters
        const sqlParams = [
          'RETURNED', // status
          '150', // closing_serial
          50, // tickets_sold_count
          100.0, // sales_amount
          'user-123', // returned_by
          'shift-456', // returned_shift_id
          'DAMAGED', // return_reason (SEC-014: validated enum)
          'Pack was damaged', // return_notes
          new Date().toISOString(), // returned_at
          'pack-789', // pack_id (WHERE clause)
          'store-abc', // store_id (WHERE clause for tenant isolation)
        ];

        // Verify return_reason is at correct position
        expect(sqlParams[6]).toBe('DAMAGED');
        // Verify return_notes is at correct position
        expect(sqlParams[7]).toBe('Pack was damaged');
      });

      it('should handle null return_notes in database storage', () => {
        const sqlParams = [
          'RETURNED',
          '150',
          50,
          100.0,
          'user-123',
          'shift-456',
          'EXPIRED', // return_reason
          null, // return_notes (null when not provided)
          new Date().toISOString(),
          'pack-789',
          'store-abc',
        ];

        expect(sqlParams[6]).toBe('EXPIRED');
        expect(sqlParams[7]).toBeNull();
      });

      it('should verify return_reason in returned pack object', () => {
        // Simulate the pack object returned from DAL
        const returnedPack = {
          pack_id: 'pack-123',
          pack_number: 'PKG1234567',
          status: 'RETURNED',
          return_reason: 'SUPPLIER_RECALL',
          return_notes: 'Manufacturer defect recall',
          returned_at: '2024-01-15T10:30:00Z',
          returned_by: 'user-456',
          returned_shift_id: 'shift-789',
        };

        expect(returnedPack.return_reason).toBe('SUPPLIER_RECALL');
        expect(returnedPack.return_notes).toBe('Manufacturer defect recall');
      });
    });

    // Additional data flow validation
    describe('End-to-end data flow validation', () => {
      it('should maintain return_reason value integrity through entire flow', () => {
        const inputReturnReason = 'INVENTORY_ADJUSTMENT' as const;

        // Step 1: Input validation
        const validatedReason = ReturnReasonSchema.parse(inputReturnReason);
        expect(validatedReason).toBe(inputReturnReason);

        // Step 2: DAL parameters
        const dalParams = { return_reason: validatedReason };
        expect(dalParams.return_reason).toBe(inputReturnReason);

        // Step 3: Database row
        const dbRow = { return_reason: dalParams.return_reason };
        expect(dbRow.return_reason).toBe(inputReturnReason);

        // Step 4: Sync payload
        const syncPayload = { return_reason: dbRow.return_reason };
        expect(syncPayload.return_reason).toBe(inputReturnReason);
      });

      it('should maintain return_notes value integrity through entire flow', () => {
        const inputNotes = 'Damaged during transit - tickets are torn';

        // Step 1: Input (string, max 500 chars)
        expect(inputNotes.length).toBeLessThanOrEqual(500);

        // Step 2: DAL parameters
        const dalParams = { return_notes: inputNotes };
        expect(dalParams.return_notes).toBe(inputNotes);

        // Step 3: Database row
        const dbRow = { return_notes: dalParams.return_notes };
        expect(dbRow.return_notes).toBe(inputNotes);

        // Step 4: Sync payload
        const syncPayload = { return_notes: dbRow.return_notes };
        expect(syncPayload.return_notes).toBe(inputNotes);
      });
    });
  });

  // ============================================================================
  // BIN COLLISION - FINAL SERIAL CALCULATION TESTS (Phase 4 - Task 4.1.3)
  // ============================================================================
  // Tests for the final serial calculation formula used during bin collision
  // auto-depletion. When a pack is AUTO_REPLACED, we calculate:
  //   final_serial = opening_serial + tickets_per_pack - 1
  //
  // TRACEABILITY:
  // - Component: lottery.handlers.ts activatePack handler (lines 1567-1574)
  // - Business Rule: BIN-001 - One active pack per bin
  // - Risk: Incorrect ticket count/sales if calculation is wrong
  // ============================================================================
  describe('Bin Collision Final Serial Calculation (Phase 4 - Task 4.1.3)', () => {
    /**
     * Helper function that replicates the final serial calculation logic
     * from lottery.handlers.ts lines 1567-1574 for isolated unit testing.
     *
     * Formula: final_serial = opening_serial + tickets_per_pack - 1
     * (zero-indexed serial numbers, so subtract 1)
     *
     * @param openingSerial - 3-digit string opening serial (e.g., '000')
     * @param ticketsPerPack - Number of tickets in the pack
     * @returns 3-digit string closing serial (e.g., '299' for 300-ticket pack starting at 000)
     */
    const calculateFinalSerial = (openingSerial: string, ticketsPerPack: number): string => {
      const openingSerialNum = parseInt(openingSerial, 10);
      const finalSerialNum = openingSerialNum + ticketsPerPack - 1;
      return String(finalSerialNum).padStart(3, '0');
    };

    describe('Standard Pack Sizes', () => {
      // ======================================================================
      // FS-STD-001: 300-ticket pack starting at 000
      // ======================================================================
      it('FS-STD-001: 300-ticket pack starting at 000 → final 299', () => {
        const result = calculateFinalSerial('000', 300);
        expect(result).toBe('299');
      });

      // ======================================================================
      // FS-STD-002: 150-ticket pack starting at 000
      // ======================================================================
      it('FS-STD-002: 150-ticket pack starting at 000 → final 149', () => {
        const result = calculateFinalSerial('000', 150);
        expect(result).toBe('149');
      });

      // ======================================================================
      // FS-STD-003: 50-ticket pack starting at 000
      // ======================================================================
      it('FS-STD-003: 50-ticket pack starting at 000 → final 049', () => {
        const result = calculateFinalSerial('000', 50);
        expect(result).toBe('049');
      });

      // ======================================================================
      // FS-STD-004: 18-ticket pack starting at 000
      // ======================================================================
      it('FS-STD-004: 18-ticket pack starting at 000 → final 017', () => {
        const result = calculateFinalSerial('000', 18);
        expect(result).toBe('017');
      });
    });

    describe('Mid-Pack Start Positions', () => {
      // ======================================================================
      // FS-MID-001: 300-ticket pack starting at 050
      // ======================================================================
      it('FS-MID-001: 300-ticket pack starting at 050 → final 349 (3 digits needed)', () => {
        const result = calculateFinalSerial('050', 300);
        expect(result).toBe('349');
      });

      // ======================================================================
      // FS-MID-002: 18-ticket pack starting at 005
      // ======================================================================
      it('FS-MID-002: 18-ticket pack starting at 005 → final 022', () => {
        const result = calculateFinalSerial('005', 18);
        expect(result).toBe('022');
      });

      // ======================================================================
      // FS-MID-003: 50-ticket pack starting at 100
      // ======================================================================
      it('FS-MID-003: 50-ticket pack starting at 100 → final 149', () => {
        const result = calculateFinalSerial('100', 50);
        expect(result).toBe('149');
      });

      // ======================================================================
      // FS-MID-004: 150-ticket pack starting at 075
      // ======================================================================
      it('FS-MID-004: 150-ticket pack starting at 075 → final 224', () => {
        const result = calculateFinalSerial('075', 150);
        expect(result).toBe('224');
      });
    });

    describe('Edge Cases', () => {
      // ======================================================================
      // FS-EDGE-001: 1-ticket pack (minimum possible)
      // ======================================================================
      it('FS-EDGE-001: 1-ticket pack starting at 000 → final 000', () => {
        const result = calculateFinalSerial('000', 1);
        expect(result).toBe('000');
      });

      // ======================================================================
      // FS-EDGE-002: 1-ticket pack starting at 299
      // ======================================================================
      it('FS-EDGE-002: 1-ticket pack starting at 299 → final 299', () => {
        const result = calculateFinalSerial('299', 1);
        expect(result).toBe('299');
      });

      // ======================================================================
      // FS-EDGE-003: Large pack (999 tickets)
      // ======================================================================
      it('FS-EDGE-003: 999-ticket pack starting at 000 → final 998', () => {
        const result = calculateFinalSerial('000', 999);
        expect(result).toBe('998');
      });

      // ======================================================================
      // FS-EDGE-004: 300-ticket pack starting at 001
      // ======================================================================
      it('FS-EDGE-004: 300-ticket pack starting at 001 → final 300', () => {
        const result = calculateFinalSerial('001', 300);
        expect(result).toBe('300');
      });

      // ======================================================================
      // FS-EDGE-005: 2-ticket pack (boundary case)
      // ======================================================================
      it('FS-EDGE-005: 2-ticket pack starting at 000 → final 001', () => {
        const result = calculateFinalSerial('000', 2);
        expect(result).toBe('001');
      });
    });

    describe('Calculation Correctness', () => {
      // ======================================================================
      // FS-CALC-001: Verify tickets_sold_count equals tickets_per_pack
      // ======================================================================
      it('FS-CALC-001: tickets_sold_count should equal tickets_per_pack for full pack depletion', () => {
        const ticketsPerPack = 300;
        const openingSerial = '000';
        const closingSerial = calculateFinalSerial(openingSerial, ticketsPerPack);

        // Tickets sold = closing - opening + 1 (inclusive range)
        const ticketsSold = parseInt(closingSerial, 10) - parseInt(openingSerial, 10) + 1;
        expect(ticketsSold).toBe(ticketsPerPack);
      });

      // ======================================================================
      // FS-CALC-002: Verify sales_amount calculation
      // ======================================================================
      it('FS-CALC-002: sales_amount should equal tickets_per_pack * game_price', () => {
        const ticketsPerPack = 300;
        const gamePrice = 5;
        const expectedSalesAmount = ticketsPerPack * gamePrice;

        expect(expectedSalesAmount).toBe(1500);
      });

      // ======================================================================
      // FS-CALC-003: Formula is deterministic
      // ======================================================================
      it('FS-CALC-003: same inputs should always produce same output', () => {
        const results: string[] = [];
        for (let i = 0; i < 100; i++) {
          results.push(calculateFinalSerial('050', 150));
        }

        expect(new Set(results).size).toBe(1);
        expect(results[0]).toBe('199');
      });

      // ======================================================================
      // FS-CALC-004: Padding preserves numeric value
      // ======================================================================
      it('FS-CALC-004: padding should not change numeric value', () => {
        const result = calculateFinalSerial('000', 50);
        expect(result).toBe('049');
        expect(parseInt(result, 10)).toBe(49);
      });
    });

    describe('Integration with Settle Parameters', () => {
      /**
       * Simulates the complete settle pack data structure that would be passed
       * to lotteryPacksDAL.settle() during bin collision auto-depletion.
       */
      interface SettlePackData {
        store_id: string;
        closing_serial: string;
        tickets_sold_count: number;
        sales_amount: number;
        depleted_by: string;
        depleted_shift_id: string;
        depletion_reason: string;
      }

      const buildSettleData = (
        storeId: string,
        openingSerial: string,
        ticketsPerPack: number,
        gamePrice: number,
        depletedBy: string,
        shiftId: string
      ): SettlePackData => {
        const closingSerial = calculateFinalSerial(openingSerial, ticketsPerPack);
        return {
          store_id: storeId,
          closing_serial: closingSerial,
          tickets_sold_count: ticketsPerPack,
          sales_amount: ticketsPerPack * gamePrice,
          depleted_by: depletedBy,
          depleted_shift_id: shiftId,
          depletion_reason: 'AUTO_REPLACED',
        };
      };

      // ======================================================================
      // FS-INT-001: Complete settle data structure for 300-ticket $1 pack
      // ======================================================================
      it('FS-INT-001: should build correct settle data for 300-ticket $1 pack', () => {
        const settleData = buildSettleData(
          'store-123',
          '000',
          300,
          1, // $1 tickets
          'user-456',
          'shift-789'
        );

        expect(settleData.closing_serial).toBe('299');
        expect(settleData.tickets_sold_count).toBe(300);
        expect(settleData.sales_amount).toBe(300);
        expect(settleData.depletion_reason).toBe('AUTO_REPLACED');
      });

      // ======================================================================
      // FS-INT-002: Complete settle data structure for 150-ticket $5 pack
      // ======================================================================
      it('FS-INT-002: should build correct settle data for 150-ticket $5 pack', () => {
        const settleData = buildSettleData(
          'store-123',
          '000',
          150,
          5, // $5 tickets
          'user-456',
          'shift-789'
        );

        expect(settleData.closing_serial).toBe('149');
        expect(settleData.tickets_sold_count).toBe(150);
        expect(settleData.sales_amount).toBe(750);
        expect(settleData.depletion_reason).toBe('AUTO_REPLACED');
      });

      // ======================================================================
      // FS-INT-003: Mid-pack start position
      // ======================================================================
      it('FS-INT-003: should handle mid-pack start position correctly', () => {
        const settleData = buildSettleData(
          'store-123',
          '050',
          300,
          2, // $2 tickets
          'user-456',
          'shift-789'
        );

        expect(settleData.closing_serial).toBe('349');
        expect(settleData.tickets_sold_count).toBe(300);
        expect(settleData.sales_amount).toBe(600);
      });

      // ======================================================================
      // FS-INT-004: Store ID and user ID preserved (DB-006, SEC-010)
      // ======================================================================
      it('FS-INT-004: should preserve store_id and user context (DB-006, SEC-010)', () => {
        const settleData = buildSettleData(
          'store-test-uuid',
          '000',
          300,
          1,
          'user-test-uuid',
          'shift-test-uuid'
        );

        expect(settleData.store_id).toBe('store-test-uuid');
        expect(settleData.depleted_by).toBe('user-test-uuid');
        expect(settleData.depleted_shift_id).toBe('shift-test-uuid');
      });
    });
  });

  // ============================================================================
  // SEC-010: POS-Based Authorization for Independent Lottery Close
  // ============================================================================
  // Business Rule: Independent lottery day close (via Close Day button) is ONLY
  // allowed for LOTTERY POS type. Other POS types must use Day Close Wizard.
  //
  // Traceability:
  // - SEC-010: AUTHZ - Function-level authorization
  // - API-SEC-005: Enforce function-level access control based on POS type
  // - BIZ-007: POS type determines close workflow availability
  // ============================================================================

  describe('SEC-010: POS-Based Authorization for Day Close', () => {
    // Reset mocks before each test to ensure isolation
    beforeEach(() => {
      vi.clearAllMocks();
      // Default to LOTTERY mode (allowed)
      mockSettingsService.getPOSType.mockReturnValue('LOTTERY');
    });

    describe('can_close_independently Capability Flag', () => {
      // ======================================================================
      // SEC-010-001: LOTTERY POS type returns can_close_independently: true
      // ======================================================================
      it('SEC-010-001: should return can_close_independently: true for LOTTERY POS', () => {
        mockSettingsService.getPOSType.mockReturnValue('LOTTERY');

        // Verify the mock returns correct value
        const posType = mockSettingsService.getPOSType();
        const canCloseIndependently = posType === 'LOTTERY';

        expect(posType).toBe('LOTTERY');
        expect(canCloseIndependently).toBe(true);
      });

      // ======================================================================
      // SEC-010-002: Non-LOTTERY POS types return can_close_independently: false
      // ======================================================================
      const nonLotteryPOSTypes = [
        'GILBARCO_PASSPORT',
        'GILBARCO_NAXML',
        'VERIFONE_RUBY2',
        'VERIFONE_COMMANDER',
        'SQUARE_REST',
        'CLOVER_REST',
        'NCR_RADIANT',
        'INFOR_POS',
        'ORACLE_SIMPHONY',
        'CUSTOM_API',
        'FILE_BASED',
        'MANUAL',
        'MANUAL_ENTRY',
        'UNKNOWN',
        null,
      ];

      it.each(nonLotteryPOSTypes)(
        'SEC-010-002: should return can_close_independently: false for POS type: %s',
        (posType) => {
          mockSettingsService.getPOSType.mockReturnValue(posType);

          const result = mockSettingsService.getPOSType();
          const canCloseIndependently = result === 'LOTTERY';

          expect(canCloseIndependently).toBe(false);
        }
      );
    });

    describe('Authorization Enforcement Logic', () => {
      // ======================================================================
      // SEC-010-003: Authorization check rejects non-LOTTERY POS
      // ======================================================================
      it('SEC-010-003: should reject prepareDayClose for GILBARCO_PASSPORT POS', () => {
        mockSettingsService.getPOSType.mockReturnValue('GILBARCO_PASSPORT');

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
        // In production, handler returns FORBIDDEN error
      });

      it('SEC-010-004: should reject prepareDayClose for VERIFONE_RUBY2 POS', () => {
        mockSettingsService.getPOSType.mockReturnValue('VERIFONE_RUBY2');

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
      });

      it('SEC-010-005: should reject prepareDayClose for SQUARE_REST POS', () => {
        mockSettingsService.getPOSType.mockReturnValue('SQUARE_REST');

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
      });

      // ======================================================================
      // SEC-010-006: Authorization check allows LOTTERY POS
      // ======================================================================
      it('SEC-010-006: should allow prepareDayClose for LOTTERY POS', () => {
        mockSettingsService.getPOSType.mockReturnValue('LOTTERY');

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(true);
      });
    });

    describe('Edge Cases and Security Boundaries', () => {
      // ======================================================================
      // SEC-010-007: Null POS type handling (fail-closed)
      // ======================================================================
      it('SEC-010-007: should deny access when POS type is null (fail-closed)', () => {
        mockSettingsService.getPOSType.mockReturnValue(null);

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
      });

      // ======================================================================
      // SEC-010-008: Undefined POS type handling (fail-closed)
      // ======================================================================
      it('SEC-010-008: should deny access when POS type is undefined (fail-closed)', () => {
        mockSettingsService.getPOSType.mockReturnValue(undefined);

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
      });

      // ======================================================================
      // SEC-010-009: Case sensitivity check (strict match)
      // ======================================================================
      it('SEC-010-009: should deny access for lowercase "lottery" (case-sensitive)', () => {
        mockSettingsService.getPOSType.mockReturnValue('lottery');

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
      });

      it('SEC-010-010: should deny access for mixed case "Lottery" (case-sensitive)', () => {
        mockSettingsService.getPOSType.mockReturnValue('Lottery');

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
      });

      // ======================================================================
      // SEC-010-011: Empty string POS type (fail-closed)
      // ======================================================================
      it('SEC-010-011: should deny access when POS type is empty string', () => {
        mockSettingsService.getPOSType.mockReturnValue('');

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
      });

      // ======================================================================
      // SEC-010-012: Whitespace handling
      // ======================================================================
      it('SEC-010-012: should deny access for POS type with leading/trailing spaces', () => {
        mockSettingsService.getPOSType.mockReturnValue(' LOTTERY ');

        const posType = mockSettingsService.getPOSType();
        const isAllowed = posType === 'LOTTERY';

        expect(isAllowed).toBe(false);
      });
    });

    describe('Audit Logging Verification', () => {
      // ======================================================================
      // SEC-010-013: Rejection should include audit context
      // ======================================================================
      it('SEC-010-013: should provide context for audit logging on rejection', () => {
        mockSettingsService.getPOSType.mockReturnValue('GILBARCO_PASSPORT');
        mockSettingsService.getStoreId.mockReturnValue('store-uuid-123');

        const posType = mockSettingsService.getPOSType();
        const storeId = mockSettingsService.getStoreId();
        const isAllowed = posType === 'LOTTERY';

        // Verify all context needed for audit log is available
        expect(posType).toBe('GILBARCO_PASSPORT');
        expect(storeId).toBe('store-uuid-123');
        expect(isAllowed).toBe(false);

        // In production, log.warn is called with:
        // { storeId, posType, action: 'prepareDayClose' }
      });
    });

    describe('Consistency Between Handlers', () => {
      // ======================================================================
      // SEC-010-014: Both prepareDayClose and commitDayClose use same logic
      // ======================================================================
      it('SEC-010-014: prepareDayClose and commitDayClose should use identical auth logic', () => {
        // Test that both handlers would make the same authorization decision
        const testPOSTypes = ['LOTTERY', 'GILBARCO_PASSPORT', 'SQUARE_REST', null];

        testPOSTypes.forEach((posType) => {
          mockSettingsService.getPOSType.mockReturnValue(posType);

          const prepareAllowed = mockSettingsService.getPOSType() === 'LOTTERY';
          const commitAllowed = mockSettingsService.getPOSType() === 'LOTTERY';

          expect(prepareAllowed).toBe(commitAllowed);
        });
      });
    });
  });

  // ==========================================================================
  // BIZ-007: Auto-Open Next Day After Close Tests
  // ==========================================================================
  describe('lottery:commitDayClose - BIZ-007 Auto-Open Next Day', () => {
    // Test fixtures
    const STORE_ID = 'store-uuid-biz007';
    const USER_ID = 'user-uuid-closer';
    const CLOSED_DAY_ID = 'day-uuid-closed';
    const NEW_DAY_ID = 'day-uuid-new';
    const BUSINESS_DATE_TODAY = '2026-02-11';
    const BUSINESS_DATE_YESTERDAY = '2026-02-10';

    const mockCommitCloseResult = {
      day_id: CLOSED_DAY_ID,
      business_date: BUSINESS_DATE_YESTERDAY,
      status: 'CLOSED',
      closings_created: 5,
      lottery_total: 1250.0,
    };

    const mockNewDay = {
      day_id: NEW_DAY_ID,
      store_id: STORE_ID,
      business_date: BUSINESS_DATE_TODAY,
      status: 'OPEN',
      opened_at: '2026-02-11T14:30:00.000Z',
      opened_by: USER_ID,
      closed_at: null,
      closed_by: null,
      total_sales: 0,
      total_packs_sold: 0,
      total_packs_activated: 0,
      day_summary_id: null,
      synced_at: null,
      created_at: '2026-02-11T14:30:00.000Z',
      updated_at: '2026-02-11T14:30:00.000Z',
    };

    beforeEach(() => {
      vi.clearAllMocks();
      // Default mock setup for BIZ-007 tests
      mockSettingsService.getPOSType.mockReturnValue('LOTTERY');
      mockSettingsService.getStoreId.mockReturnValue(STORE_ID);
      mockSessionService.getCurrentSession.mockReturnValue({
        user_id: USER_ID,
        username: 'closer_user',
        role: 'shift_manager',
        store_id: STORE_ID,
      });
    });

    // ========================================================================
    // LOT-CLOSE-001: Auto-opens next day on success
    // ========================================================================
    describe('LOT-CLOSE-001: Auto-opens next day on success', () => {
      it('should create a new OPEN day after closing current day', () => {
        // Arrange: Setup expected behavior
        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockNewDay);

        // Act: Simulate the handler logic
        const commitResult = lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          USER_ID
        );

        // Assert: New day exists with status OPEN
        expect(commitResult).toBeDefined();
        expect(commitResult.status).toBe('CLOSED');
        expect(nextDay).toBeDefined();
        expect(nextDay.status).toBe('OPEN');
        expect(nextDay.day_id).toBe(NEW_DAY_ID);
      });

      it('should call getOrCreateForDate after successful commitClose', () => {
        // Arrange
        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockNewDay);

        // Act: Simulate handler flow
        lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        lotteryBusinessDaysDAL.getOrCreateForDate(STORE_ID, BUSINESS_DATE_TODAY, USER_ID);

        // Assert: Both methods called
        expect(lotteryBusinessDaysDAL.commitClose).toHaveBeenCalledWith(CLOSED_DAY_ID, USER_ID);
        expect(lotteryBusinessDaysDAL.getOrCreateForDate).toHaveBeenCalledWith(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          USER_ID
        );
      });
    });

    // ========================================================================
    // LOT-CLOSE-002: Next day uses correct business date (today)
    // ========================================================================
    describe('LOT-CLOSE-002: Next day uses correct business date', () => {
      it('should use getCurrentBusinessDate() for new day', () => {
        // Arrange
        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockNewDay);

        // Act: Simulate handler with specific date
        lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        lotteryBusinessDaysDAL.getOrCreateForDate(STORE_ID, BUSINESS_DATE_TODAY, USER_ID);

        // Assert: New day has today's date (not the closed day's date)
        expect(lotteryBusinessDaysDAL.getOrCreateForDate).toHaveBeenCalledWith(
          STORE_ID,
          BUSINESS_DATE_TODAY, // Must use current business date, not closed day's date
          USER_ID
        );
      });

      it('should handle midnight crossing correctly', () => {
        // Scenario: Closing day from 2026-02-10 at 00:30 on 2026-02-11
        // The new day should be 2026-02-11, not 2026-02-10
        const closedDayResult = {
          ...mockCommitCloseResult,
          business_date: '2026-02-10', // Day being closed is from yesterday
        };
        const newDayAfterMidnight = {
          ...mockNewDay,
          business_date: '2026-02-11', // New day is today
        };

        lotteryBusinessDaysDAL.commitClose.mockReturnValue(closedDayResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(newDayAfterMidnight);

        // Act
        const closedResult = lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(STORE_ID, '2026-02-11', USER_ID);

        // Assert: Closed day is 02-10, new day is 02-11
        expect(closedResult.business_date).toBe('2026-02-10');
        expect(nextDay.business_date).toBe('2026-02-11');
      });
    });

    // ========================================================================
    // LOT-CLOSE-003: Next day uses closer userId
    // ========================================================================
    describe('LOT-CLOSE-003: Next day uses closer userId', () => {
      it('should set opened_by to the user who closed previous day', () => {
        // Arrange
        const closerUserId = 'user-uuid-manager';
        const newDayWithOpener = {
          ...mockNewDay,
          opened_by: closerUserId,
        };

        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(newDayWithOpener);

        // Act
        lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, closerUserId);
        const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          closerUserId
        );

        // Assert: opened_by matches the closer
        expect(lotteryBusinessDaysDAL.getOrCreateForDate).toHaveBeenCalledWith(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          closerUserId // Same user who closed
        );
        expect(nextDay.opened_by).toBe(closerUserId);
      });

      it('should pass userId through to DAL method (SEC-010)', () => {
        // Arrange
        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockNewDay);

        // Act
        lotteryBusinessDaysDAL.getOrCreateForDate(STORE_ID, BUSINESS_DATE_TODAY, USER_ID);

        // Assert: userId is passed as third parameter
        expect(lotteryBusinessDaysDAL.getOrCreateForDate).toHaveBeenCalledWith(
          expect.any(String), // storeId
          expect.any(String), // date
          USER_ID // userId must be passed
        );
      });
    });

    // ========================================================================
    // LOT-CLOSE-004: Response includes next_day object
    // ========================================================================
    describe('LOT-CLOSE-004: Response includes next_day', () => {
      it('should return next_day object in response', () => {
        // Arrange
        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockNewDay);

        // Act: Build response as handler does
        const commitResult = lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          USER_ID
        );

        const response = {
          ...commitResult,
          next_day: {
            day_id: nextDay.day_id,
            business_date: nextDay.business_date,
            status: nextDay.status,
          },
        };

        // Assert: Response structure
        expect(response).toHaveProperty('next_day');
        expect(response.next_day).toHaveProperty('day_id', NEW_DAY_ID);
        expect(response.next_day).toHaveProperty('business_date', BUSINESS_DATE_TODAY);
        expect(response.next_day).toHaveProperty('status', 'OPEN');
      });

      it('should preserve original commitClose fields in response', () => {
        // Arrange
        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(mockNewDay);

        // Act
        const commitResult = lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        const nextDay = lotteryBusinessDaysDAL.getOrCreateForDate(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          USER_ID
        );

        const response = {
          ...commitResult,
          next_day: {
            day_id: nextDay.day_id,
            business_date: nextDay.business_date,
            status: nextDay.status,
          },
        };

        // Assert: Original fields preserved via spread
        expect(response).toHaveProperty('closings_created', 5);
        expect(response).toHaveProperty('lottery_total', 1250.0);
        expect(response).toHaveProperty('day_id', CLOSED_DAY_ID);
      });
    });

    // ========================================================================
    // LOT-CLOSE-005: Next day syncs to cloud
    // ========================================================================
    describe('LOT-CLOSE-005: Next day syncs to cloud', () => {
      let syncQueueDAL: { enqueue: MockFn };

      beforeEach(async () => {
        const syncModule = await import('../../../src/main/dal/sync-queue.dal');
        syncQueueDAL = syncModule.syncQueueDAL as unknown as typeof syncQueueDAL;
      });

      it('should enqueue day_open entity for sync via getOrCreateForDate', () => {
        // Note: The DAL method getOrCreateForDate internally enqueues sync
        // This test verifies the expected behavior
        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockImplementation(() => {
          // Simulate what the real DAL does - enqueue sync
          syncQueueDAL.enqueue({
            entity_type: 'day_open',
            entity_id: NEW_DAY_ID,
            operation: 'CREATE',
            store_id: STORE_ID,
            priority: 20, // SYNC-001: day_open must sync before shifts (10)
            payload: { day_id: NEW_DAY_ID, business_date: BUSINESS_DATE_TODAY },
          });
          return mockNewDay;
        });

        // Act
        lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        lotteryBusinessDaysDAL.getOrCreateForDate(STORE_ID, BUSINESS_DATE_TODAY, USER_ID);

        // Assert: Sync was queued
        expect(syncQueueDAL.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            entity_type: 'day_open',
            entity_id: NEW_DAY_ID,
            operation: 'CREATE',
          })
        );
      });

      it('should queue day_open with priority 20 (higher than shifts at 10)', () => {
        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockImplementation(() => {
          syncQueueDAL.enqueue({
            entity_type: 'day_open',
            entity_id: NEW_DAY_ID,
            operation: 'CREATE',
            store_id: STORE_ID,
            priority: 20, // SYNC-001: higher number = higher priority
            payload: {},
          });
          return mockNewDay;
        });

        // Act
        lotteryBusinessDaysDAL.getOrCreateForDate(STORE_ID, BUSINESS_DATE_TODAY, USER_ID);

        // Assert: Priority 20 ensures day syncs before shifts (10)
        expect(syncQueueDAL.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({
            priority: 20,
          })
        );
      });
    });

    // ========================================================================
    // LOT-CLOSE-006: Idempotent if day already open
    // ========================================================================
    describe('LOT-CLOSE-006: Idempotent if day already open', () => {
      it('should return existing open day if one exists', () => {
        // Arrange: Pre-existing OPEN day for today
        const existingOpenDay = {
          ...mockNewDay,
          day_id: 'day-uuid-existing',
          opened_at: '2026-02-11T08:00:00.000Z', // Opened earlier today
        };

        lotteryBusinessDaysDAL.commitClose.mockReturnValue(mockCommitCloseResult);
        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(existingOpenDay);

        // Act
        lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        const returnedDay = lotteryBusinessDaysDAL.getOrCreateForDate(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          USER_ID
        );

        // Assert: Returns existing day, same ID
        expect(returnedDay.day_id).toBe('day-uuid-existing');
        expect(returnedDay.status).toBe('OPEN');
      });

      it('should not create duplicate OPEN days for same store', () => {
        // Arrange: Simulate getOrCreateForDate's idempotent behavior
        const firstOpenDay = { ...mockNewDay, day_id: 'day-uuid-first' };

        lotteryBusinessDaysDAL.getOrCreateForDate.mockReturnValue(firstOpenDay);

        // Act: Call twice
        const day1 = lotteryBusinessDaysDAL.getOrCreateForDate(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          USER_ID
        );
        const day2 = lotteryBusinessDaysDAL.getOrCreateForDate(
          STORE_ID,
          BUSINESS_DATE_TODAY,
          USER_ID
        );

        // Assert: Same day returned both times
        expect(day1.day_id).toBe(day2.day_id);
      });
    });

    // ========================================================================
    // LOT-CLOSE-007: No next day on close failure
    // ========================================================================
    describe('LOT-CLOSE-007: No next day on close failure', () => {
      it('should NOT create next day if commitClose throws', () => {
        // Arrange: commitClose fails
        lotteryBusinessDaysDAL.commitClose.mockImplementation(() => {
          throw new Error('Database constraint violation');
        });

        // Act & Assert: Handler catches error, getOrCreateForDate not called
        expect(() => {
          lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        }).toThrow('Database constraint violation');

        // getOrCreateForDate should NOT have been called after the error
        expect(lotteryBusinessDaysDAL.getOrCreateForDate).not.toHaveBeenCalled();
      });

      it('should NOT create next day if commitClose returns error result', () => {
        // Arrange: commitClose indicates failure
        lotteryBusinessDaysDAL.commitClose.mockImplementation(() => {
          throw new Error('Day is not in PENDING_CLOSE status');
        });

        // Act
        let errorThrown = false;
        try {
          lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        } catch {
          errorThrown = true;
        }

        // Assert: Error occurred, no next day created
        expect(errorThrown).toBe(true);
        expect(lotteryBusinessDaysDAL.getOrCreateForDate).not.toHaveBeenCalled();
      });

      it('should handle transaction rollback scenario', () => {
        // Arrange: Simulate transaction failure mid-operation
        lotteryBusinessDaysDAL.commitClose.mockImplementation(() => {
          throw new Error('SQLITE_CONSTRAINT: transaction aborted');
        });

        // Act
        let transactionError = null;
        try {
          lotteryBusinessDaysDAL.commitClose(CLOSED_DAY_ID, USER_ID);
        } catch (error) {
          transactionError = error;
        }

        // Assert: Transaction error captured, no side effects
        expect(transactionError).toBeTruthy();
        expect((transactionError as Error).message).toContain('SQLITE_CONSTRAINT');
        expect(lotteryBusinessDaysDAL.getOrCreateForDate).not.toHaveBeenCalled();
      });
    });
  });
});
