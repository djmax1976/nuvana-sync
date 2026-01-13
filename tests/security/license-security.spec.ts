/**
 * License Security Tests
 *
 * Enterprise-grade security tests for license enforcement.
 *
 * Validates:
 * - SEC-REVOKE: Immediate revocation on 401/403
 * - CDP-001: Encrypted storage integrity
 * - Tamper detection and prevention
 * - Privilege escalation prevention
 * - Abuse scenario handling
 *
 * Test Categories:
 * 1. Tamper detection and integrity
 * 2. Immediate revocation on auth failures
 * 3. Grace period bypass attempts
 * 4. Storage manipulation attacks
 * 5. Input validation attacks
 *
 * @module tests/security/license-security.spec
 */

// Using vitest globals (configured in vitest.config.ts)
import { randomBytes } from 'crypto';

// ============================================================================
// Mocks - Must be hoisted
// ============================================================================

// Mock electron (app and safeStorage)
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((data: string) => Buffer.from(`encrypted:${data}`)),
    decryptString: vi.fn((buffer: Buffer) => {
      const str = buffer.toString();
      if (str.startsWith('encrypted:')) {
        return str.substring(10);
      }
      throw new Error('Decryption failed - invalid ciphertext');
    }),
  },
}));

// Mock electron-store with internal store
vi.mock('electron-store', () => {
  const internalStore = new Map<string, unknown>();
  class MockStore {
    static __store = internalStore;
    get(key: string): unknown {
      return internalStore.get(key);
    }
    set(key: string, value: unknown): void {
      internalStore.set(key, value);
    }
    delete(key: string): void {
      internalStore.delete(key);
    }
    has(key: string): boolean {
      return internalStore.has(key);
    }
    clear(): void {
      internalStore.clear();
    }
  }
  return { default: MockStore };
});

vi.mock('../../src/main/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ============================================================================
// Test Setup
// ============================================================================

import {
  LicenseService,
  LicenseApiResponseSchema,
  LICENSE_STORE_KEY,
  GRACE_PERIOD_DAYS,
  type LicenseApiResponse,
} from '../../src/main/services/license.service';
import Store from 'electron-store';

// Access the mock's internal store via static property
type MockStoreClass = typeof Store & { __store: Map<string, unknown> };

describe('License Security Tests', () => {
  let service: LicenseService;
  let safeStorageMock: {
    isEncryptionAvailable: ReturnType<typeof vi.fn>;
    encryptString: ReturnType<typeof vi.fn>;
    decryptString: ReturnType<typeof vi.fn>;
  };
  let mockStoreData: Map<string, unknown>;

  const daysFromNow = (days: number): string => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString();
  };

  const createValidResponse = (daysUntilExpiry: number = 90): LicenseApiResponse => ({
    expiresAt: daysFromNow(daysUntilExpiry),
    status: 'active',
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get access to mock store data
    mockStoreData = (Store as unknown as MockStoreClass).__store;
    mockStoreData.clear();

    const electron = await import('electron');
    safeStorageMock = electron.safeStorage as typeof safeStorageMock;
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true);

    service = new LicenseService();
  });

  afterEach(() => {
    mockStoreData.clear();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Tamper Detection and Integrity Tests
  // ==========================================================================

  describe('Tamper Detection', () => {
    it('should detect and reject tampered integrity hash', () => {
      service.updateFromApiResponse(createValidResponse(90));
      expect(service.isValid()).toBe(true);

      // Tamper with the integrity hash
      const stored = mockStoreData.get(LICENSE_STORE_KEY) as {
        encryptedData: string;
        integrityHash: string;
        storedAt: string;
      };

      stored.integrityHash = randomBytes(32).toString('hex');
      mockStoreData.set(LICENSE_STORE_KEY, stored);

      // New instance should detect tampering
      const service2 = new LicenseService();
      expect(service2.isValid()).toBe(false);
      expect(service2.getState().status).toBeNull();
    });

    it('should detect and reject tampered encrypted data', () => {
      service.updateFromApiResponse(createValidResponse(90));

      const stored = mockStoreData.get(LICENSE_STORE_KEY) as {
        encryptedData: string;
        integrityHash: string;
      };

      // Tamper with encrypted data
      stored.encryptedData = Buffer.from('tampered-data').toString('base64');
      mockStoreData.set(LICENSE_STORE_KEY, stored);

      const service2 = new LicenseService();
      expect(service2.isValid()).toBe(false);
    });

    it('should detect hash length mismatch attacks', () => {
      service.updateFromApiResponse(createValidResponse(90));

      const stored = mockStoreData.get(LICENSE_STORE_KEY) as {
        encryptedData: string;
        integrityHash: string;
      };

      // Try short hash (potential timing attack setup)
      stored.integrityHash = 'short';
      mockStoreData.set(LICENSE_STORE_KEY, stored);

      const service2 = new LicenseService();
      expect(service2.isValid()).toBe(false);
    });

    it('should detect null byte injection in hash', () => {
      service.updateFromApiResponse(createValidResponse(90));

      const stored = mockStoreData.get(LICENSE_STORE_KEY) as {
        encryptedData: string;
        integrityHash: string;
      };

      // Null byte injection attempt
      stored.integrityHash = stored.integrityHash.substring(0, 32) + '\x00' + 'a'.repeat(31);
      mockStoreData.set(LICENSE_STORE_KEY, stored);

      const service2 = new LicenseService();
      expect(service2.isValid()).toBe(false);
    });

    it('should clear storage on integrity failure (prevent replay)', () => {
      service.updateFromApiResponse(createValidResponse(90));

      const stored = mockStoreData.get(LICENSE_STORE_KEY) as {
        encryptedData: string;
        integrityHash: string;
      };

      stored.integrityHash = 'invalid';
      mockStoreData.set(LICENSE_STORE_KEY, stored);

      // Load tampered data
      new LicenseService();

      // Storage should be cleared
      expect(mockStoreData.has(LICENSE_STORE_KEY)).toBe(false);
    });
  });

  // ==========================================================================
  // 2. Immediate Revocation Tests (SEC-REVOKE)
  // ==========================================================================

  describe('Immediate Revocation (SEC-REVOKE)', () => {
    it('should immediately invalidate on markSuspended() - no grace period', () => {
      // Even with 90 days remaining
      service.updateFromApiResponse(createValidResponse(90));
      expect(service.isValid()).toBe(true);

      service.markSuspended();

      expect(service.isValid()).toBe(false);
      expect(service.isInGracePeriod()).toBe(false);
      expect(service.getState().status).toBe('suspended');
    });

    it('should immediately invalidate on markCancelled() - no grace period', () => {
      service.updateFromApiResponse(createValidResponse(90));
      expect(service.isValid()).toBe(true);

      service.markCancelled();

      expect(service.isValid()).toBe(false);
      expect(service.isInGracePeriod()).toBe(false);
      expect(service.getState().status).toBe('cancelled');
    });

    it('should persist suspended status across restarts', () => {
      service.updateFromApiResponse(createValidResponse(90));
      service.markSuspended();

      // Simulate restart
      const service2 = new LicenseService();

      expect(service2.isValid()).toBe(false);
      expect(service2.getState().status).toBe('suspended');
    });

    it('should persist cancelled status across restarts', () => {
      service.updateFromApiResponse(createValidResponse(90));
      service.markCancelled();

      const service2 = new LicenseService();

      expect(service2.isValid()).toBe(false);
      expect(service2.getState().status).toBe('cancelled');
    });

    it('should not grant grace period for suspended even if recently active', () => {
      // Recently expired but should have grace
      service.updateFromApiResponse({
        expiresAt: daysFromNow(-1),
        status: 'active',
      });
      expect(service.isInGracePeriod()).toBe(true);

      // Now suspend
      service.markSuspended();

      expect(service.isValid()).toBe(false);
      expect(service.isInGracePeriod()).toBe(false); // No grace for suspended
    });
  });

  // ==========================================================================
  // 3. Grace Period Bypass Prevention Tests
  // ==========================================================================

  describe('Grace Period Bypass Prevention', () => {
    it('should not allow status manipulation to gain grace period', () => {
      // Expired beyond grace
      service.updateFromApiResponse({
        expiresAt: daysFromNow(-10),
        status: 'active',
      });
      expect(service.isValid()).toBe(false);

      // Try to "restore" by updating with past_due
      service.updateFromApiResponse({
        expiresAt: daysFromNow(-10),
        status: 'past_due',
      });

      // Still invalid - can't bypass by changing status
      expect(service.isValid()).toBe(false);
    });

    it('should enforce grace period boundary strictly', () => {
      // Just within grace boundary (1 day less than boundary)
      service.updateFromApiResponse({
        expiresAt: daysFromNow(-(GRACE_PERIOD_DAYS - 1)),
        status: 'active',
      });
      expect(service.isValid()).toBe(true); // Safely within

      // At exact boundary - due to strict > comparison, this is invalid
      service.updateFromApiResponse({
        expiresAt: daysFromNow(-GRACE_PERIOD_DAYS),
        status: 'active',
      });
      expect(service.isValid()).toBe(false); // At boundary = invalid (strict > comparison)

      // One day beyond
      service.updateFromApiResponse({
        expiresAt: daysFromNow(-(GRACE_PERIOD_DAYS + 1)),
        status: 'active',
      });
      expect(service.isValid()).toBe(false); // Beyond grace
    });

    it('should not extend grace by updating with suspended->active', () => {
      service.updateFromApiResponse({
        expiresAt: daysFromNow(-10), // Expired
        status: 'active',
      });
      service.markSuspended();
      expect(service.isValid()).toBe(false);

      // Try to restore
      service.updateFromApiResponse({
        expiresAt: daysFromNow(-10),
        status: 'active',
      });

      // Still expired beyond grace
      expect(service.isValid()).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Storage Manipulation Attack Tests
  // ==========================================================================

  describe('Storage Manipulation Attacks', () => {
    it('should handle corrupted JSON in encrypted data', () => {
      service.updateFromApiResponse(createValidResponse(90));

      const stored = mockStoreData.get(LICENSE_STORE_KEY) as {
        encryptedData: string;
        integrityHash: string;
      };

      // Corrupt the encrypted data to produce invalid JSON when decrypted
      safeStorageMock.decryptString.mockReturnValueOnce('not-valid-json{{{');

      const service2 = new LicenseService();
      expect(service2.isValid()).toBe(false);
    });

    it('should handle prototype pollution attempt in stored data', () => {
      const maliciousData = {
        encryptedData: 'ZW5jcnlwdGVkOnt9', // base64 of "encrypted:{}"
        integrityHash: 'a'.repeat(64),
        storedAt: new Date().toISOString(),
        __proto__: { isAdmin: true },
        constructor: { prototype: { isAdmin: true } },
      };

      mockStoreData.set(LICENSE_STORE_KEY, maliciousData);

      // Should not throw or be exploited
      expect(() => new LicenseService()).not.toThrow();
    });

    it('should handle extremely large stored data', () => {
      const hugeData = {
        encryptedData: 'x'.repeat(10 * 1024 * 1024), // 10MB
        integrityHash: 'a'.repeat(64),
        storedAt: new Date().toISOString(),
      };

      mockStoreData.set(LICENSE_STORE_KEY, hugeData);

      // Should handle without crashing
      expect(() => new LicenseService()).not.toThrow();
    });

    it('should handle null/undefined stored values', () => {
      mockStoreData.set(LICENSE_STORE_KEY, null);

      const service2 = new LicenseService();
      expect(service2.isValid()).toBe(false);

      mockStoreData.set(LICENSE_STORE_KEY, undefined);

      const service3 = new LicenseService();
      expect(service3.isValid()).toBe(false);
    });

    it('should handle stored data with missing required fields', () => {
      mockStoreData.set(LICENSE_STORE_KEY, {
        // Missing encryptedData
        integrityHash: 'a'.repeat(64),
      });

      const service2 = new LicenseService();
      expect(service2.isValid()).toBe(false);
    });
  });

  // ==========================================================================
  // 5. Input Validation Attack Tests
  // ==========================================================================

  describe('Input Validation Attacks', () => {
    describe('Schema Bypass Attempts', () => {
      it('should reject SQL injection in status field', () => {
        const malicious = {
          expiresAt: daysFromNow(90),
          status: "active'; DROP TABLE licenses; --",
        };

        const result = LicenseApiResponseSchema.safeParse(malicious);
        expect(result.success).toBe(false);
      });

      it('should reject XSS in expiresAt field', () => {
        const malicious = {
          expiresAt: '<script>alert(document.cookie)</script>',
          status: 'active',
        };

        const result = LicenseApiResponseSchema.safeParse(malicious);
        expect(result.success).toBe(false);
      });

      it('should reject command injection in expiresAt', () => {
        const malicious = {
          expiresAt: '$(rm -rf /)',
          status: 'active',
        };

        const result = LicenseApiResponseSchema.safeParse(malicious);
        expect(result.success).toBe(false);
      });

      it('should reject path traversal in status', () => {
        const malicious = {
          expiresAt: daysFromNow(90),
          status: '../../../etc/passwd',
        };

        const result = LicenseApiResponseSchema.safeParse(malicious);
        expect(result.success).toBe(false);
      });

      it('should reject null bytes in fields', () => {
        const malicious = {
          expiresAt: '2026-01-01T00:00:00.000Z\x00extra',
          status: 'active\x00admin',
        };

        // Status should fail enum validation
        const result = LicenseApiResponseSchema.safeParse(malicious);
        expect(result.success).toBe(false);
      });
    });

    describe('Type Coercion Attacks', () => {
      it('should reject array instead of string for status', () => {
        const malicious = {
          expiresAt: daysFromNow(90),
          status: ['active', 'suspended'],
        };

        const result = LicenseApiResponseSchema.safeParse(malicious);
        expect(result.success).toBe(false);
      });

      it('should reject object instead of string for expiresAt', () => {
        const malicious = {
          expiresAt: { year: 2026, month: 1, day: 1 },
          status: 'active',
        };

        const result = LicenseApiResponseSchema.safeParse(malicious);
        expect(result.success).toBe(false);
      });

      it('should reject number coerced to string for status', () => {
        const malicious = {
          expiresAt: daysFromNow(90),
          status: 0, // Might coerce to "0"
        };

        const result = LicenseApiResponseSchema.safeParse(malicious);
        expect(result.success).toBe(false);
      });
    });

    describe('Boundary Value Attacks', () => {
      it('should handle Unix epoch date', () => {
        const epoch = {
          expiresAt: '1970-01-01T00:00:00.000Z',
          status: 'active',
        };

        const result = LicenseApiResponseSchema.safeParse(epoch);
        expect(result.success).toBe(true);

        service.updateFromApiResponse(epoch as LicenseApiResponse);
        expect(service.isValid()).toBe(false); // Long expired
      });

      it('should handle year 9999 date', () => {
        const farFuture = {
          expiresAt: '9999-12-31T23:59:59.999Z',
          status: 'active',
        };

        const result = LicenseApiResponseSchema.safeParse(farFuture);
        expect(result.success).toBe(true);

        service.updateFromApiResponse(farFuture as LicenseApiResponse);
        expect(service.isValid()).toBe(true);
      });

      it('should reject invalid date values', () => {
        const invalidDates = [
          '2026-13-01T00:00:00.000Z', // Month 13
          '2026-01-32T00:00:00.000Z', // Day 32
          '2026-02-30T00:00:00.000Z', // Feb 30
          '2026-01-01T25:00:00.000Z', // Hour 25
          '2026-01-01T00:60:00.000Z', // Minute 60
        ];

        for (const date of invalidDates) {
          const result = LicenseApiResponseSchema.safeParse({
            expiresAt: date,
            status: 'active',
          });
          expect(result.success).toBe(false);
        }
      });
    });
  });

  // ==========================================================================
  // 6. Encryption Security Tests
  // ==========================================================================

  describe('Encryption Security', () => {
    it('should not store plaintext in production when encryption unavailable', () => {
      safeStorageMock.isEncryptionAvailable.mockReturnValue(false);
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const prodService = new LicenseService();
      prodService.updateFromApiResponse(createValidResponse(90));

      // Check that data wasn't stored in plaintext
      const stored = mockStoreData.get(LICENSE_STORE_KEY) as { encryptedData?: string };

      if (stored?.encryptedData) {
        // If something was stored, it should be encrypted
        // In our mock, plaintext would start with the actual JSON
        expect(stored.encryptedData).not.toContain('"status"');
        expect(stored.encryptedData).not.toContain('"expiresAt"');
      }

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle decryption failures gracefully', () => {
      service.updateFromApiResponse(createValidResponse(90));

      // Simulate decryption failure
      safeStorageMock.decryptString.mockImplementationOnce(() => {
        throw new Error('Decryption failed');
      });

      const service2 = new LicenseService();
      expect(service2.isValid()).toBe(false);
      expect(service2.getState().status).toBeNull();
    });

    it('should handle encryption failures gracefully', () => {
      safeStorageMock.encryptString.mockImplementationOnce(() => {
        throw new Error('Encryption failed');
      });

      // Should not throw, just fail to persist
      expect(() => {
        service.updateFromApiResponse(createValidResponse(90));
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // 7. Race Condition and Concurrency Tests
  // ==========================================================================

  describe('Concurrency Security', () => {
    it('should handle concurrent status updates safely', async () => {
      // Simulate concurrent updates
      const updates = [
        () => service.updateFromApiResponse(createValidResponse(90)),
        () => service.markSuspended(),
        () =>
          service.updateFromApiResponse({
            expiresAt: daysFromNow(30),
            status: 'past_due',
          }),
      ];

      await Promise.all(updates.map((fn) => Promise.resolve().then(fn)));

      // State should be deterministic (last update wins)
      const state = service.getState();
      expect(state.status).toBeDefined();
      expect(['active', 'past_due', 'suspended']).toContain(state.status);
    });

    it('should not corrupt data under rapid updates', () => {
      // Rapid fire updates
      for (let i = 0; i < 100; i++) {
        service.updateFromApiResponse(createValidResponse(90 - i));
      }

      const state = service.getState();
      expect(state.status).toBe('active');
      expect(state.daysRemaining).toBeDefined();
    });
  });
});
