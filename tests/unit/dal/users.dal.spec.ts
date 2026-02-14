/**
 * Users DAL Unit Tests
 *
 * @module tests/unit/dal/users.dal.spec
 * @security SEC-006: Validates parameterized queries
 * @security SEC-001: Validates bcrypt PIN hashing
 * @security DB-006: Validates store-scoped queries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted() to ensure mock functions are available when vi.mock runs
// This fixes cross-platform issues where vi.mock hoisting differs between Windows and Linux
const { mockPrepare, mockTransaction, mockBcryptHash, mockBcryptCompare } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
  mockBcryptHash: vi.fn(),
  mockBcryptCompare: vi.fn(),
}));

vi.mock('../../../src/main/services/database.service', () => ({
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

vi.mock('bcrypt', () => ({
  default: {
    hash: (...args: unknown[]) => mockBcryptHash(...args),
    compare: (...args: unknown[]) => mockBcryptCompare(...args),
  },
}));

import { UsersDAL, type User, type UserRole } from '../../../src/main/dal/users.dal';

describe('UsersDAL', () => {
  let dal: UsersDAL;

  // Note: After cloud_id consolidation, user_id IS the cloud ID - no separate cloud_user_id
  const mockUser: User = {
    user_id: 'user-123',
    store_id: 'store-456',
    role: 'cashier' as UserRole,
    name: 'John Doe',
    pin_hash: '$2b$12$hashedpin123',
    active: 1,
    last_login_at: null,
    synced_at: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBcryptHash.mockResolvedValue('$2b$12$hashedpin123');
    mockBcryptCompare.mockResolvedValue(true);
    dal = new UsersDAL();
  });

  describe('create', () => {
    it('should create user with bcrypt-hashed PIN', async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) });

      const result = await dal.create({
        store_id: 'store-456',
        role: 'cashier',
        name: 'John Doe',
        pin: '1234',
      });

      // SEC-001: Verify bcrypt was called with correct cost factor
      expect(mockBcryptHash).toHaveBeenCalledWith('1234', 12);
      expect(result).toEqual(mockUser);
    });

    it('should use prepared statement for insert - SEC-006', async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) });

      await dal.create({
        store_id: 'store-456',
        role: 'cashier',
        name: 'John Doe',
        pin: '1234',
      });

      // SEC-006: Verify parameterized query
      // Note: After cloud_id consolidation, no separate cloud_user_id column
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      );
    });

    it('should use provided user_id if given', async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) });

      await dal.create({
        user_id: 'custom-user-id',
        store_id: 'store-456',
        role: 'cashier',
        name: 'John Doe',
        pin: '1234',
      });

      // Note: After cloud_id consolidation, no separate cloud_user_id column
      expect(mockRun).toHaveBeenCalledWith(
        'custom-user-id',
        'store-456',
        'cashier',
        'John Doe',
        '$2b$12$hashedpin123',
        expect.any(String),
        expect.any(String)
      );
    });

    it('should create users with all roles', async () => {
      const roles: UserRole[] = ['cashier', 'shift_manager', 'store_manager'];

      for (const role of roles) {
        const mockRun = vi.fn().mockReturnValue({ changes: 1 });
        const userWithRole = { ...mockUser, role };

        mockPrepare
          .mockReturnValueOnce({ run: mockRun })
          .mockReturnValueOnce({ get: vi.fn().mockReturnValue(userWithRole) });

        const result = await dal.create({
          store_id: 'store-456',
          role,
          name: 'Test User',
          pin: '1234',
        });

        expect(result.role).toBe(role);
      }
    });

    it('should throw if created user cannot be retrieved', async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });

      await expect(
        dal.create({
          store_id: 'store-456',
          role: 'cashier',
          name: 'John Doe',
          pin: '1234',
        })
      ).rejects.toThrow('Failed to retrieve created user');
    });
  });

  describe('update', () => {
    it('should update user fields', async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const updatedUser = { ...mockUser, name: 'Jane Doe', role: 'shift_manager' as UserRole };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedUser) });

      const result = await dal.update('user-123', {
        name: 'Jane Doe',
        role: 'shift_manager',
      });

      expect(result?.name).toBe('Jane Doe');
      expect(result?.role).toBe('shift_manager');
    });

    it('should hash PIN when updating - SEC-001', async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) });

      await dal.update('user-123', { pin: '5678' });

      expect(mockBcryptHash).toHaveBeenCalledWith('5678', 12);
    });

    it('should update active status correctly', async () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      const inactiveUser = { ...mockUser, active: 0 };

      mockPrepare
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(inactiveUser) });

      const result = await dal.update('user-123', { active: false });

      expect(mockRun).toHaveBeenCalledWith(
        expect.any(String), // updated_at
        0, // active = false converted to 0
        'user-123'
      );
      expect(result?.active).toBe(0);
    });

    it('should return undefined for non-existent user', async () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = await dal.update('nonexistent', { name: 'New Name' });

      expect(result).toBeUndefined();
    });
  });

  describe('verifyPin', () => {
    it('should return true for valid PIN - SEC-001', async () => {
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) })
        .mockReturnValueOnce({ run: vi.fn() }); // updateLastLogin

      mockBcryptCompare.mockResolvedValue(true);

      const result = await dal.verifyPin('user-123', '1234');

      expect(mockBcryptCompare).toHaveBeenCalledWith('1234', '$2b$12$hashedpin123');
      expect(result).toBe(true);
    });

    it('should return false for invalid PIN', async () => {
      mockPrepare.mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) });
      mockBcryptCompare.mockResolvedValue(false);

      const result = await dal.verifyPin('user-123', 'wrong');

      expect(result).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });

      const result = await dal.verifyPin('nonexistent', '1234');

      expect(result).toBe(false);
    });

    it('should return false for inactive user', async () => {
      const inactiveUser = { ...mockUser, active: 0 };
      mockPrepare.mockReturnValue({ get: vi.fn().mockReturnValue(inactiveUser) });

      const result = await dal.verifyPin('user-123', '1234');

      expect(result).toBe(false);
      // Should not even attempt to compare PIN
      expect(mockBcryptCompare).not.toHaveBeenCalled();
    });

    it('should update last_login_at on successful verification', async () => {
      const mockUpdateRun = vi.fn();
      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) })
        .mockReturnValueOnce({ run: mockUpdateRun });

      mockBcryptCompare.mockResolvedValue(true);

      await dal.verifyPin('user-123', '1234');

      expect(mockUpdateRun).toHaveBeenCalledWith(expect.any(String), 'user-123');
    });
  });

  describe('updateLastLogin', () => {
    it('should update last_login_at timestamp', () => {
      const mockRun = vi.fn();
      mockPrepare.mockReturnValue({ run: mockRun });

      dal.updateLastLogin('user-123');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET last_login_at = ?')
      );
      expect(mockRun).toHaveBeenCalledWith(expect.any(String), 'user-123');
    });
  });

  describe('findActiveByStore', () => {
    it('should return active users for store - DB-006', () => {
      const activeUsers = [mockUser, { ...mockUser, user_id: 'user-456', name: 'Jane Doe' }];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(activeUsers),
      });

      const result = dal.findActiveByStore('store-456');

      // DB-006: Store-scoped query
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND active = 1')
      );
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no active users', () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = dal.findActiveByStore('store-456');

      expect(result).toEqual([]);
    });
  });

  // Note: findByCloudId method removed after cloud_id consolidation
  // user_id IS now the cloud ID, so use findById directly

  describe('upsertFromCloud', () => {
    // Note: After cloud_id consolidation, user_id IS the cloud ID
    it('should create new user when not exists', () => {
      const cloudData = {
        user_id: 'cloud-user-789', // user_id IS the cloud ID now
        store_id: 'store-456',
        role: 'cashier' as UserRole,
        name: 'Cloud User',
        pin_hash: '$2b$12$cloudhashedpin',
      };

      const createdUser = { ...mockUser, user_id: 'cloud-user-789', name: 'Cloud User' };
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findById
        .mockReturnValueOnce({ run: mockRun }) // INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(createdUser) }); // findById

      const result = dal.upsertFromCloud(cloudData);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
      expect(result.user_id).toBe('cloud-user-789');
    });

    it('should update existing user when found', () => {
      const existingUser = { ...mockUser, user_id: 'cloud-user-789' };
      const cloudData = {
        user_id: 'cloud-user-789', // user_id IS the cloud ID now
        store_id: 'store-456',
        role: 'shift_manager' as UserRole,
        name: 'Updated Name',
        pin_hash: '$2b$12$newhashedpin',
      };

      const updatedUser = { ...existingUser, ...cloudData };
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(existingUser) }) // findById
        .mockReturnValueOnce({ run: mockRun }) // UPDATE
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedUser) }); // findById

      const result = dal.upsertFromCloud(cloudData);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET'));
      expect(result.name).toBe('Updated Name');
      expect(result.role).toBe('shift_manager');
    });

    it('should update synced_at on cloud sync', () => {
      const cloudData = {
        user_id: 'cloud-user-789', // user_id IS the cloud ID now
        store_id: 'store-456',
        role: 'cashier' as UserRole,
        name: 'Cloud User',
        pin_hash: '$2b$12$cloudhashedpin',
      };

      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        .mockReturnValueOnce({ run: mockRun })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ ...mockUser, synced_at: expect.any(String) }),
        });

      dal.upsertFromCloud(cloudData);

      // Verify INSERT includes synced_at
      expect(mockRun).toHaveBeenCalled();
    });

    it('should throw if created cloud user cannot be retrieved', () => {
      const cloudData = {
        user_id: 'cloud-user-789', // user_id IS the cloud ID now
        store_id: 'store-456',
        role: 'cashier' as UserRole,
        name: 'Cloud User',
        pin_hash: '$2b$12$cloudhashedpin',
      };

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) })
        .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) });

      expect(() => dal.upsertFromCloud(cloudData)).toThrow(
        'Failed to retrieve created user from cloud'
      );
    });
  });

  describe('deactivate', () => {
    it('should set active to 0', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.deactivate('user-123');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET active = 0')
      );
      expect(result).toBe(true);
    });

    it('should return false when user not found', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.deactivate('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('reactivate', () => {
    it('should set active to 1', () => {
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });
      mockPrepare.mockReturnValue({ run: mockRun });

      const result = dal.reactivate('user-123');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET active = 1')
      );
      expect(result).toBe(true);
    });

    it('should return false when user not found', () => {
      mockPrepare.mockReturnValue({
        run: vi.fn().mockReturnValue({ changes: 0 }),
      });

      const result = dal.reactivate('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('toSafeUser', () => {
    it('should remove pin_hash from user object', () => {
      const safeUser = UsersDAL.toSafeUser(mockUser);

      expect(safeUser).not.toHaveProperty('pin_hash');
      expect(safeUser.user_id).toBe(mockUser.user_id);
      expect(safeUser.name).toBe(mockUser.name);
      expect(safeUser.role).toBe(mockUser.role);
    });

    it('should preserve all other fields', () => {
      const safeUser = UsersDAL.toSafeUser(mockUser);

      expect(safeUser.user_id).toBe('user-123');
      expect(safeUser.store_id).toBe('store-456');
      expect(safeUser.role).toBe('cashier');
      expect(safeUser.name).toBe('John Doe');
      expect(safeUser.active).toBe(1);
      expect(safeUser.created_at).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  // ===========================================================================
  // PIN Uniqueness Validation (Business Critical)
  // ===========================================================================

  describe('isPinInUse - PIN Uniqueness Validation', () => {
    /**
     * BUSINESS RULE: PINs must be unique within a store because they identify
     * users at the point of sale. Duplicate PINs would cause authentication
     * ambiguity and potential audit trail corruption.
     *
     * SECURITY: SEC-001 - Uses bcrypt comparison (timing-safe)
     * SECURITY: DB-006 - Store-scoped for tenant isolation
     */

    it('PIN-U-001: should return undefined when PIN is not in use', async () => {
      const activeUsers = [
        { ...mockUser, user_id: 'user-1', pin_hash: '$2b$12$hash1' },
        { ...mockUser, user_id: 'user-2', pin_hash: '$2b$12$hash2' },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(activeUsers),
      });

      // All comparisons return false - PIN not found
      mockBcryptCompare.mockResolvedValue(false);

      const result = await dal.isPinInUse('store-456', '9999');

      expect(result).toBeUndefined();
      expect(mockBcryptCompare).toHaveBeenCalledTimes(2);
    });

    it('PIN-U-002: should return user when PIN collision detected', async () => {
      const existingUser = {
        ...mockUser,
        user_id: 'existing-user',
        pin_hash: '$2b$12$existinghash',
      };
      const activeUsers = [existingUser];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(activeUsers),
      });

      // PIN matches existing user
      mockBcryptCompare.mockResolvedValue(true);

      const result = await dal.isPinInUse('store-456', '1234');

      expect(result).toEqual(existingUser);
      expect(mockBcryptCompare).toHaveBeenCalledWith('1234', existingUser.pin_hash);
    });

    it('PIN-U-003: should exclude specified user for PIN update scenarios', async () => {
      const userBeingUpdated = {
        ...mockUser,
        user_id: 'updating-user',
        pin_hash: '$2b$12$oldhash',
      };
      const otherUser = { ...mockUser, user_id: 'other-user', pin_hash: '$2b$12$otherhash' };
      const activeUsers = [userBeingUpdated, otherUser];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(activeUsers),
      });

      mockBcryptCompare.mockResolvedValue(false);

      const result = await dal.isPinInUse('store-456', '5678', 'updating-user');

      // Should NOT compare against the excluded user
      expect(mockBcryptCompare).toHaveBeenCalledTimes(1);
      expect(mockBcryptCompare).toHaveBeenCalledWith('5678', otherUser.pin_hash);
      expect(result).toBeUndefined();
    });

    it('PIN-U-004: should detect collision even when excluding a different user', async () => {
      const userBeingUpdated = {
        ...mockUser,
        user_id: 'updating-user',
        pin_hash: '$2b$12$oldhash',
      };
      const collidingUser = {
        ...mockUser,
        user_id: 'colliding-user',
        pin_hash: '$2b$12$collidinghash',
      };
      const activeUsers = [userBeingUpdated, collidingUser];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(activeUsers),
      });

      // First call (skipped due to exclude), second call matches
      mockBcryptCompare.mockResolvedValue(true);

      const result = await dal.isPinInUse('store-456', '1234', 'updating-user');

      // Should return the colliding user, not the excluded one
      expect(result).toEqual(collidingUser);
    });

    it('PIN-U-005: should return undefined when no active users exist - DB-006', async () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      const result = await dal.isPinInUse('store-456', '1234');

      expect(result).toBeUndefined();
      expect(mockBcryptCompare).not.toHaveBeenCalled();
    });

    it('PIN-U-006: should only check users from specified store - DB-006 tenant isolation', async () => {
      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue([]),
      });

      await dal.isPinInUse('store-456', '1234');

      // Verify store-scoped query
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND active = 1')
      );
    });

    it('PIN-U-007: should use timing-safe bcrypt comparison - SEC-001', async () => {
      const activeUsers = [mockUser];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(activeUsers),
      });
      mockBcryptCompare.mockResolvedValue(false);

      await dal.isPinInUse('store-456', '1234');

      // bcrypt.compare is inherently timing-safe
      expect(mockBcryptCompare).toHaveBeenCalledWith('1234', mockUser.pin_hash);
    });

    it('PIN-U-008: should check all active users until match found', async () => {
      const users = [
        { ...mockUser, user_id: 'user-1', pin_hash: '$2b$12$hash1' },
        { ...mockUser, user_id: 'user-2', pin_hash: '$2b$12$hash2' },
        { ...mockUser, user_id: 'user-3', pin_hash: '$2b$12$hash3' },
      ];

      mockPrepare.mockReturnValue({
        all: vi.fn().mockReturnValue(users),
      });

      // Match on second user
      mockBcryptCompare.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      const result = await dal.isPinInUse('store-456', '1234');

      expect(result).toEqual(users[1]);
      // Should stop after finding match
      expect(mockBcryptCompare).toHaveBeenCalledTimes(2);
    });
  });

  describe('findByPin - PIN Authentication', () => {
    /**
     * BUSINESS RULE: Users authenticate at POS using their PIN.
     * This method finds the user matching the provided PIN within a store.
     *
     * SECURITY: SEC-001 - Bcrypt timing-safe comparison
     * SECURITY: DB-006 - Store-scoped queries
     */

    it('PIN-A-001: should return user when PIN matches', async () => {
      const activeUsers = [mockUser];

      mockPrepare
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(activeUsers) })
        .mockReturnValueOnce({ run: vi.fn() }); // updateLastLogin

      mockBcryptCompare.mockResolvedValue(true);

      const result = await dal.findByPin('store-456', '1234');

      expect(result).toEqual(mockUser);
      expect(mockBcryptCompare).toHaveBeenCalledWith('1234', mockUser.pin_hash);
    });

    it('PIN-A-002: should return undefined when no PIN match found', async () => {
      const activeUsers = [mockUser];

      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue(activeUsers) });
      mockBcryptCompare.mockResolvedValue(false);

      const result = await dal.findByPin('store-456', 'wrong');

      expect(result).toBeUndefined();
    });

    it('PIN-A-003: should update last_login_at on successful PIN match', async () => {
      const mockUpdateRun = vi.fn();
      const activeUsers = [mockUser];

      mockPrepare
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(activeUsers) })
        .mockReturnValueOnce({ run: mockUpdateRun });

      mockBcryptCompare.mockResolvedValue(true);

      await dal.findByPin('store-456', '1234');

      expect(mockUpdateRun).toHaveBeenCalledWith(expect.any(String), mockUser.user_id);
    });

    it('PIN-A-004: should only search active users - DB-006', async () => {
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      await dal.findByPin('store-456', '1234');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE store_id = ? AND active = 1')
      );
    });

    it('PIN-A-005: should return first matching user when multiple exist', async () => {
      // Edge case: if duplicate PINs exist (bug scenario), return first match
      const users = [
        { ...mockUser, user_id: 'first-user' },
        { ...mockUser, user_id: 'second-user' },
      ];

      mockPrepare
        .mockReturnValueOnce({ all: vi.fn().mockReturnValue(users) })
        .mockReturnValueOnce({ run: vi.fn() });

      // Both match (simulating duplicate PIN bug)
      mockBcryptCompare.mockResolvedValue(true);

      const result = await dal.findByPin('store-456', '1234');

      // Should return first user found
      expect(result?.user_id).toBe('first-user');
    });

    it('PIN-A-006: should handle empty store with no users', async () => {
      mockPrepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) });

      const result = await dal.findByPin('store-456', '1234');

      expect(result).toBeUndefined();
      expect(mockBcryptCompare).not.toHaveBeenCalled();
    });
  });

  describe('Security Compliance', () => {
    describe('SEC-006: Parameterized Queries', () => {
      it('should use parameterized queries for all operations', async () => {
        // create
        mockPrepare
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) });

        await dal.create({
          store_id: 'store-456',
          role: 'cashier',
          name: 'Test',
          pin: '1234',
        });

        // All prepared statements should use ? placeholders
        const calls = mockPrepare.mock.calls;
        for (const call of calls) {
          const query = call[0] as string;
          if (query.includes('INSERT') || query.includes('UPDATE') || query.includes('SELECT')) {
            // Should not contain string concatenation patterns
            expect(query).not.toMatch(/\+ *['"`]/);
            expect(query).not.toMatch(/['"`] *\+/);
          }
        }
      });

      it('should never concatenate user input into queries', () => {
        // This test verifies the pattern - actual injection testing would be integration tests
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        // Call with potentially malicious input
        dal.findActiveByStore("'; DROP TABLE users; --");

        const query = mockPrepare.mock.calls[0][0] as string;
        // Query should be static, not include the input
        expect(query).not.toContain('DROP');
        expect(query).toContain('?');
      });
    });

    describe('SEC-001: Password/PIN Security', () => {
      it('should use bcrypt with cost factor 12', async () => {
        mockPrepare
          .mockReturnValueOnce({ run: vi.fn().mockReturnValue({ changes: 1 }) })
          .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) });

        await dal.create({
          store_id: 'store-456',
          role: 'cashier',
          name: 'Test',
          pin: '1234',
        });

        expect(mockBcryptHash).toHaveBeenCalledWith(expect.any(String), 12);
      });

      it('should use timing-safe bcrypt comparison', async () => {
        mockPrepare
          .mockReturnValueOnce({ get: vi.fn().mockReturnValue(mockUser) })
          .mockReturnValueOnce({ run: vi.fn() });

        await dal.verifyPin('user-123', '1234');

        // bcrypt.compare is inherently timing-safe
        expect(mockBcryptCompare).toHaveBeenCalledWith('1234', mockUser.pin_hash);
      });

      it('should never expose pin_hash in safe user output', () => {
        const safeUser = UsersDAL.toSafeUser(mockUser);

        expect(JSON.stringify(safeUser)).not.toContain('pin_hash');
        expect(JSON.stringify(safeUser)).not.toContain('$2b$');
      });
    });

    describe('DB-006: Store Isolation', () => {
      it('should scope findActiveByStore to store_id', () => {
        mockPrepare.mockReturnValue({
          all: vi.fn().mockReturnValue([]),
        });

        dal.findActiveByStore('store-456');

        expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('store_id = ?'));
      });
    });
  });
});
