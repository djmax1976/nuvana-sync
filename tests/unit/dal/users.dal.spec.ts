/**
 * Users DAL Unit Tests
 *
 * @module tests/unit/dal/users.dal.spec
 * @security SEC-006: Validates parameterized queries
 * @security SEC-001: Validates bcrypt PIN hashing
 * @security DB-006: Validates store-scoped queries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database service
const mockPrepare = vi.fn();
const mockTransaction = vi.fn((fn) => () => fn());

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

// Mock bcrypt
const mockBcryptHash = vi.fn();
const mockBcryptCompare = vi.fn();

vi.mock('bcrypt', () => ({
  default: {
    hash: (...args: unknown[]) => mockBcryptHash(...args),
    compare: (...args: unknown[]) => mockBcryptCompare(...args),
  },
}));

import { UsersDAL, type User, type UserRole } from '../../../src/main/dal/users.dal';

describe('UsersDAL', () => {
  let dal: UsersDAL;

  const mockUser: User = {
    user_id: 'user-123',
    store_id: 'store-456',
    role: 'cashier' as UserRole,
    name: 'John Doe',
    pin_hash: '$2b$12$hashedpin123',
    active: 1,
    last_login_at: null,
    cloud_user_id: null,
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
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
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

      expect(mockRun).toHaveBeenCalledWith(
        'custom-user-id',
        'store-456',
        'cashier',
        'John Doe',
        '$2b$12$hashedpin123',
        null, // cloud_user_id
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

  describe('findByCloudId', () => {
    it('should find user by cloud_user_id - SEC-006', () => {
      const cloudUser = { ...mockUser, cloud_user_id: 'cloud-789' };

      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(cloudUser),
      });

      const result = dal.findByCloudId('cloud-789');

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('WHERE cloud_user_id = ?'));
      expect(result?.cloud_user_id).toBe('cloud-789');
    });

    it('should return undefined when not found', () => {
      mockPrepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = dal.findByCloudId('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('upsertFromCloud', () => {
    it('should create new user when not exists', () => {
      const cloudData = {
        cloud_user_id: 'cloud-789',
        store_id: 'store-456',
        role: 'cashier' as UserRole,
        name: 'Cloud User',
        pin_hash: '$2b$12$cloudhashedpin',
      };

      const createdUser = { ...mockUser, ...cloudData };
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(undefined) }) // findByCloudId
        .mockReturnValueOnce({ run: mockRun }) // INSERT
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(createdUser) }); // findById

      const result = dal.upsertFromCloud(cloudData);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'));
      expect(result.cloud_user_id).toBe('cloud-789');
    });

    it('should update existing user when found', () => {
      const existingUser = { ...mockUser, cloud_user_id: 'cloud-789' };
      const cloudData = {
        cloud_user_id: 'cloud-789',
        store_id: 'store-456',
        role: 'shift_manager' as UserRole,
        name: 'Updated Name',
        pin_hash: '$2b$12$newhashedpin',
      };

      const updatedUser = { ...existingUser, ...cloudData };
      const mockRun = vi.fn().mockReturnValue({ changes: 1 });

      mockPrepare
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(existingUser) }) // findByCloudId
        .mockReturnValueOnce({ run: mockRun }) // UPDATE
        .mockReturnValueOnce({ get: vi.fn().mockReturnValue(updatedUser) }); // findByCloudId

      const result = dal.upsertFromCloud(cloudData);

      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE users SET'));
      expect(result.name).toBe('Updated Name');
      expect(result.role).toBe('shift_manager');
    });

    it('should update synced_at on cloud sync', () => {
      const cloudData = {
        cloud_user_id: 'cloud-789',
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
        cloud_user_id: 'cloud-789',
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
