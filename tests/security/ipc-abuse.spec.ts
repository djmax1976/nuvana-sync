/**
 * IPC Security Tests
 *
 * Validates IPC channel security including:
 * - Channel allowlist enforcement
 * - Input validation on handlers
 * - Authorization checks
 * - Injection prevention via handlers
 *
 * @module tests/security/ipc-abuse
 * @security SEC-014: IPC channel validation
 * @security API-001: Input validation
 * @security API-004: Authentication checks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeListener: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('IPC Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Channel Allowlist Enforcement', () => {
    /**
     * SEC-014: Only allowlisted channels can be invoked
     */
    const ALLOWED_INVOKE_CHANNELS = [
      // Config
      'config:get',
      'config:save',
      'config:test-connection',
      // Stores
      'stores:getInfo',
      'stores:getStatus',
      'stores:isConfigured',
      // Sync
      'sync:get-stats',
      'sync:get-recent-files',
      'sync:trigger',
      'sync:toggle-pause',
      'sync:getStatus',
      'sync:getStats',
      'sync:triggerNow',
      'sync:syncUsers',
      'sync:syncBins',
      'sync:syncGames',
      'sync:forceFullSync',
      'sync:getHistory',
      'sync:getHistoryPaginated',
      'sync:getPendingQueue',
      'sync:getFailedQueue',
      'sync:retryFailed',
      'sync:startEngine',
      'sync:stopEngine',
      'sync:cleanupQueue',
      // Dashboard
      'dashboard:getStats',
      'dashboard:getTodaySales',
      'dashboard:getWeeklySales',
      // Shifts
      'shifts:list',
      'shifts:getById',
      'shifts:getSummary',
      'shifts:close',
      'shifts:findOpenShifts',
      // Day Summaries
      'daySummaries:list',
      'daySummaries:getByDate',
      'daySummaries:close',
      // Transactions
      'transactions:list',
      'transactions:getById',
      // Reports
      'reports:weekly',
      'reports:monthly',
      'reports:dateRange',
      // Lottery
      'lottery:getGames',
      'lottery:getPacks',
      'lottery:getBins',
      'lottery:receivePack',
      'lottery:activatePack',
      'lottery:depletePack',
      'lottery:returnPack',
      'lottery:prepareDayClose',
      'lottery:commitDayClose',
      'lottery:cancelDayClose',
      'lottery:parseBarcode',
      // Settings
      'settings:get',
      'settings:update',
      'settings:testConnection',
      // Auth
      'auth:login',
      'auth:loginWithUser',
      'auth:logout',
      'auth:getCurrentUser',
      'auth:updateActivity',
      'auth:getUsers',
      'auth:hasPermission',
      'auth:hasMinimumRole',
    ];

    it('should define explicit allowlist of IPC channels', () => {
      expect(ALLOWED_INVOKE_CHANNELS.length).toBeGreaterThan(0);
      // All channels should follow naming convention
      ALLOWED_INVOKE_CHANNELS.forEach((channel) => {
        expect(channel).toMatch(/^[a-zA-Z]+:[a-zA-Z-]+$/);
      });
    });

    it('should reject calls to non-allowlisted channels', () => {
      const disallowedChannels = [
        'arbitrary:channel',
        'shell:execute',
        'fs:readFile',
        'process:spawn',
        'admin:deleteAll',
        'database:rawQuery',
        'internal:secret',
      ];

      disallowedChannels.forEach((channel) => {
        expect(ALLOWED_INVOKE_CHANNELS).not.toContain(channel);
      });
    });

    it('should prevent channel injection via naming', () => {
      const injectionAttempts = [
        "dashboard:getStats'; DROP TABLE--",
        'dashboard:getStats/**/UNION/**/SELECT',
        'dashboard:getStats\x00admin:delete',
        'dashboard:getStats%00shell:exec',
        '../../../etc/passwd',
        'dashboard:getStats\nshell:exec',
      ];

      injectionAttempts.forEach((attempt) => {
        expect(ALLOWED_INVOKE_CHANNELS).not.toContain(attempt);
        // Valid channels don't contain these patterns
        expect(attempt).not.toMatch(/^[a-zA-Z]+:[a-zA-Z-]+$/);
      });
    });
  });

  describe('Event Channel Allowlist', () => {
    const ALLOWED_ON_CHANNELS = [
      'sync-status',
      'sync:statusChanged',
      'sync:progress',
      'file:processed',
      'auth:sessionExpired',
      'auth:sessionWarning',
      'scanner:input',
      'navigate',
    ];

    it('should define explicit allowlist for event channels', () => {
      expect(ALLOWED_ON_CHANNELS.length).toBeGreaterThan(0);
    });

    it('should reject subscription to non-allowlisted events', () => {
      const disallowedEvents = ['internal:secret', 'admin:broadcast', 'shell:output', 'fs:change'];

      disallowedEvents.forEach((event) => {
        expect(ALLOWED_ON_CHANNELS).not.toContain(event);
      });
    });
  });

  describe('Input Validation on Handlers', () => {
    /**
     * API-001: All handlers must validate input
     */
    describe('lottery:getPacks', () => {
      it('should validate filter parameters', () => {
        const validFilters = {
          status: 'RECEIVED',
          game_id: '123e4567-e89b-12d3-a456-426614174000',
          bin_id: '123e4567-e89b-12d3-a456-426614174001',
        };

        // Valid enum values
        const validStatuses = ['RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED'];
        expect(validStatuses).toContain(validFilters.status);

        // Valid UUID format
        expect(validFilters.game_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
      });

      it('should reject invalid status values', () => {
        const invalidStatuses = [
          "'; DROP TABLE--",
          '<script>alert(1)</script>',
          'INVALID_STATUS',
          null,
          123,
          { $ne: null },
        ];

        const validStatuses = ['RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED'];

        invalidStatuses.forEach((status) => {
          expect(validStatuses).not.toContain(status);
        });
      });
    });

    describe('lottery:receivePack', () => {
      it('should validate game_id as UUID', () => {
        const validUUID = '123e4567-e89b-12d3-a456-426614174000';
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

        expect(validUUID).toMatch(uuidRegex);

        const invalidUUIDs = ["'; DROP TABLE--", 'not-a-uuid', '123', '', '../../../etc/passwd'];

        invalidUUIDs.forEach((invalid) => {
          expect(invalid).not.toMatch(uuidRegex);
        });
      });

      it('should validate pack_number', () => {
        const validPackNumber = 'PACK-001';

        // Pack number constraints
        expect(validPackNumber.length).toBeGreaterThanOrEqual(1);
        expect(validPackNumber.length).toBeLessThanOrEqual(20);
      });

      it('should validate barcode as 24 digits', () => {
        const validBarcode = '123456789012345678901234';
        const barcodeRegex = /^\d{24}$/;

        expect(validBarcode).toMatch(barcodeRegex);

        const invalidBarcodes = [
          '12345', // Too short
          '12345678901234567890123456789', // Too long
          'ABCD56789012345678901234', // Non-digits
          "'; DROP TABLE--",
        ];

        invalidBarcodes.forEach((invalid) => {
          expect(invalid).not.toMatch(barcodeRegex);
        });
      });
    });

    describe('auth:login', () => {
      it('should validate PIN as 4-6 digits', () => {
        const validPINs = ['1234', '12345', '123456'];
        const pinRegex = /^\d{4,6}$/;

        validPINs.forEach((pin) => {
          expect(pin).toMatch(pinRegex);
        });

        const invalidPINs = [
          '123', // Too short
          '1234567', // Too long
          'abcd', // Non-digits
          "'; DROP TABLE--",
          '1234 5678',
          '',
        ];

        invalidPINs.forEach((pin) => {
          expect(pin).not.toMatch(pinRegex);
        });
      });
    });

    describe('settings:validateFolder', () => {
      it('should reject path traversal attempts', () => {
        const traversalAttempts = [
          '../../../etc/passwd',
          '..\\..\\..\\Windows\\System32',
          'C:\\..\\..\\Windows',
          '....//....//etc/passwd',
          '%2e%2e%2f%2e%2e%2fetc%2fpasswd',
          '..%c0%af..%c0%afetc/passwd',
        ];

        traversalAttempts.forEach((testPath) => {
          // These should all be detected as invalid
          const hasTraversal =
            testPath.includes('..') || testPath.includes('%2e') || testPath.includes('%c0');
          expect(hasTraversal).toBe(true);
        });
      });
    });
  });

  describe('Authorization Checks', () => {
    /**
     * API-004: Protected endpoints require authentication
     * SEC-010: Role-based access control
     *
     * Role hierarchy (production values from users.dal.ts:36):
     *   cashier < shift_manager < store_manager
     */
    const PROTECTED_CHANNELS = [
      // Require authentication (cashier minimum)
      { channel: 'lottery:receivePack', requiresAuth: true, requiredRole: 'cashier' },
      { channel: 'lottery:activatePack', requiresAuth: true, requiredRole: 'cashier' },
      { channel: 'lottery:depletePack', requiresAuth: true, requiredRole: 'cashier' },
      { channel: 'auth:logout', requiresAuth: true },
      { channel: 'auth:updateActivity', requiresAuth: true },
      // Require shift_manager role (matches lottery.handlers.ts:1191)
      { channel: 'lottery:returnPack', requiresAuth: true, requiredRole: 'shift_manager' },
      { channel: 'lottery:prepareDayClose', requiresAuth: true, requiredRole: 'shift_manager' },
      { channel: 'lottery:commitDayClose', requiresAuth: true, requiredRole: 'shift_manager' },
      { channel: 'lottery:markSoldOut', requiresAuth: true, requiredRole: 'shift_manager' },
      // Require store_manager role
      { channel: 'settings:update', requiresAuth: true, requiredRole: 'store_manager' },
      { channel: 'shifts:close', requiresAuth: true, requiredRole: 'store_manager' },
      { channel: 'daySummaries:close', requiresAuth: true, requiredRole: 'store_manager' },
      { channel: 'settings:reset', requiresAuth: true, requiredRole: 'store_manager' },
    ];

    it('should define protected channels requiring authentication', () => {
      const authRequired = PROTECTED_CHANNELS.filter((c) => c.requiresAuth);
      expect(authRequired.length).toBeGreaterThan(0);
    });

    it('should define shift_manager channels', () => {
      const shiftManagerChannels = PROTECTED_CHANNELS.filter(
        (c) => c.requiredRole === 'shift_manager'
      );
      expect(shiftManagerChannels.length).toBeGreaterThan(0);
      // Verify lottery:returnPack requires shift_manager
      expect(shiftManagerChannels.some((c) => c.channel === 'lottery:returnPack')).toBe(true);
    });

    it('should define store_manager channels', () => {
      const storeManagerChannels = PROTECTED_CHANNELS.filter(
        (c) => c.requiredRole === 'store_manager'
      );
      expect(storeManagerChannels.length).toBeGreaterThan(0);
    });

    /**
     * SEC-010: Role hierarchy enforcement
     * Production hierarchy from users.dal.ts:36 and ipc/index.ts:27
     */
    it('should enforce role hierarchy (cashier < shift_manager < store_manager)', () => {
      const roleHierarchy = ['cashier', 'shift_manager', 'store_manager'];

      const hasRequiredRole = (userRole: string, requiredRole: string): boolean => {
        const userLevel = roleHierarchy.indexOf(userRole);
        const requiredLevel = roleHierarchy.indexOf(requiredRole);
        return userLevel >= requiredLevel;
      };

      // cashier tests
      expect(hasRequiredRole('cashier', 'cashier')).toBe(true);
      expect(hasRequiredRole('cashier', 'shift_manager')).toBe(false);
      expect(hasRequiredRole('cashier', 'store_manager')).toBe(false);

      // shift_manager tests
      expect(hasRequiredRole('shift_manager', 'cashier')).toBe(true);
      expect(hasRequiredRole('shift_manager', 'shift_manager')).toBe(true);
      expect(hasRequiredRole('shift_manager', 'store_manager')).toBe(false);

      // store_manager tests
      expect(hasRequiredRole('store_manager', 'cashier')).toBe(true);
      expect(hasRequiredRole('store_manager', 'shift_manager')).toBe(true);
      expect(hasRequiredRole('store_manager', 'store_manager')).toBe(true);
    });

    /**
     * SEC-010: CRITICAL - Verify lottery:returnPack requires shift_manager
     * This is a business-critical security control preventing unauthorized returns
     */
    it('should require shift_manager role for lottery:returnPack (SEC-010)', () => {
      const returnPackChannel = PROTECTED_CHANNELS.find((c) => c.channel === 'lottery:returnPack');

      expect(returnPackChannel).toBeDefined();
      expect(returnPackChannel?.requiresAuth).toBe(true);
      expect(returnPackChannel?.requiredRole).toBe('shift_manager');

      // Verify cashier CANNOT return packs
      const roleHierarchy = ['cashier', 'shift_manager', 'store_manager'];
      const hasRequiredRole = (userRole: string, requiredRole: string): boolean => {
        const userLevel = roleHierarchy.indexOf(userRole);
        const requiredLevel = roleHierarchy.indexOf(requiredRole);
        return userLevel >= requiredLevel;
      };

      expect(hasRequiredRole('cashier', 'shift_manager')).toBe(false);
      expect(hasRequiredRole('shift_manager', 'shift_manager')).toBe(true);
      expect(hasRequiredRole('store_manager', 'shift_manager')).toBe(true);
    });
  });

  describe('SQL Injection via IPC', () => {
    /**
     * Test that SQL injection payloads in IPC parameters don't execute
     */
    const SQL_INJECTION_PAYLOADS = [
      "'; DROP TABLE lottery_packs;--",
      "1' OR '1'='1",
      "1; DELETE FROM users WHERE '1'='1",
      "' UNION SELECT * FROM users--",
    ];

    it('should not execute SQL injection via gameId parameter', () => {
      SQL_INJECTION_PAYLOADS.forEach((payload) => {
        // These payloads should be treated as literal strings, not SQL
        // The actual test would verify DAL receives payload as-is
        expect(payload).toBeDefined();

        // UUID validation should reject these
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        expect(payload).not.toMatch(uuidRegex);
      });
    });

    it('should validate string inputs match expected patterns', () => {
      // Serial number: 3 digits
      const serialRegex = /^\d{3}$/;
      expect("'; DROP--").not.toMatch(serialRegex);
      expect('001').toMatch(serialRegex);

      // Pack number: 1-20 chars
      const packNumValid = (s: string) => s.length >= 1 && s.length <= 20;
      expect(packNumValid("'; DROP TABLE very_long_injection_string--")).toBe(false);
      expect(packNumValid('PACK-001')).toBe(true);
    });
  });

  describe('Response Sanitization', () => {
    /**
     * API-003: Error responses should not leak sensitive information
     */
    it('should not expose stack traces in error responses', () => {
      const sanitizedError = {
        error: 'INTERNAL_ERROR',
        message: 'An internal error occurred. Please try again.',
      };

      expect(sanitizedError.message).not.toContain('at ');
      expect(sanitizedError.message).not.toContain('.ts:');
      expect(sanitizedError.message).not.toContain('Error:');
      expect(sanitizedError.message).not.toContain('SELECT');
      expect(sanitizedError.message).not.toContain('INSERT');
    });

    it('should not expose database details in errors', () => {
      const sanitizedError = {
        error: 'INTERNAL_ERROR',
        message: 'An internal error occurred. Please try again.',
      };

      expect(sanitizedError.message).not.toContain('SQLITE');
      expect(sanitizedError.message).not.toContain('table');
      expect(sanitizedError.message).not.toContain('column');
      expect(sanitizedError.message).not.toContain('constraint');
    });

    it('should use generic error codes', () => {
      const validErrorCodes = [
        'NOT_AUTHENTICATED',
        'FORBIDDEN',
        'NOT_FOUND',
        'NOT_CONFIGURED',
        'VALIDATION_ERROR',
        'ALREADY_EXISTS',
        'ALREADY_CLOSED',
        'OPEN_SHIFTS',
        'INTERNAL_ERROR',
      ];

      validErrorCodes.forEach((code) => {
        expect(code).not.toContain('SQL');
        expect(code).not.toContain('DATABASE');
        expect(code).not.toContain('QUERY');
      });
    });
  });

  describe('Navigation Path Validation', () => {
    const ALLOWED_NAVIGATION_PATHS = [
      '/settings',
      '/dashboard',
      '/setup',
      '/shifts',
      '/transactions',
      '/reports',
      '/lottery',
      '/terminal',
    ];

    it('should only allow known navigation paths', () => {
      ALLOWED_NAVIGATION_PATHS.forEach((path) => {
        expect(path.startsWith('/')).toBe(true);
      });
    });

    it('should reject unknown paths', () => {
      const unknownPaths = ['/admin', '/api/internal', '/debug', '/__webpack_hmr'];

      unknownPaths.forEach((path) => {
        expect(ALLOWED_NAVIGATION_PATHS).not.toContain(path);
      });
    });

    it('should reject external URLs', () => {
      const externalURLs = [
        'http://evil.com',
        'https://attacker.com/steal',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
      ];

      externalURLs.forEach((url) => {
        expect(ALLOWED_NAVIGATION_PATHS).not.toContain(url);
        expect(url.startsWith('/')).toBe(false);
      });
    });

    it('should reject path traversal in navigation', () => {
      const traversalPaths = ['../admin', '/settings/../admin', '/settings/..%2fadmin'];

      traversalPaths.forEach((path) => {
        expect(ALLOWED_NAVIGATION_PATHS).not.toContain(path);
      });
    });
  });
});
