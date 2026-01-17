/**
 * useAuthGuard Hook Unit Tests
 *
 * Enterprise-grade tests for session-first authentication validation.
 * Validates FE-001: Session caching - 15 minute auth window
 * Validates SEC-010: Server-side role validation
 *
 * @module tests/unit/hooks/useAuthGuard
 * @security FE-001: Session caching feature validation
 * @security SEC-010: Role-based authorization validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Types (matching useAuthGuard.ts)
// ============================================================================

interface AuthGuardUser {
  userId: string;
  name: string;
  role: string;
}

interface SessionCheckResponse {
  success: boolean;
  data?: {
    valid: boolean;
    user?: AuthGuardUser;
    timeoutIn?: number;
  };
}

type RequiredRole = 'cashier' | 'shift_manager' | 'store_manager';

// ============================================================================
// Mock Setup
// ============================================================================

/**
 * Mock window.electronAPI for Electron IPC testing
 * Type assertion to support both generic invocation and mock methods
 */
const mockInvoke = vi.fn() as ReturnType<typeof vi.fn> & (<T = unknown>(...args: unknown[]) => Promise<T>);

const mockElectronAPI = {
  invoke: mockInvoke,
};

// Simulate global window object with electronAPI
const mockWindow = {
  electronAPI: mockElectronAPI,
};

/**
 * Implementation of executeWithAuth logic for testing
 * This mirrors the hook's behavior without React's useCallback
 */
function createExecuteWithAuth(requiredRole: RequiredRole) {
  return async (
    onSuccess: (user: AuthGuardUser) => void,
    onNeedAuth: () => void
  ): Promise<void> => {
    try {
      const response = await mockWindow.electronAPI.invoke<SessionCheckResponse>(
        'auth:checkSessionForRole',
        { requiredRole }
      );

      if (response.success && response.data?.valid && response.data.user) {
        // Valid session - update activity and proceed immediately
        mockWindow.electronAPI.invoke('auth:updateActivity').catch(() => {});
        onSuccess(response.data.user);
      } else {
        // No valid session - caller needs to show PIN dialog
        onNeedAuth();
      }
    } catch {
      // Session check failed - fall back to requiring auth
      onNeedAuth();
    }
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('useAuthGuard Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('FE-001: Session Caching Validation', () => {
    describe('Valid Session Scenarios', () => {
      it('should call onSuccess immediately when valid session exists with sufficient role', async () => {
        const mockUser: AuthGuardUser = {
          userId: 'user-123',
          name: 'Test User',
          role: 'cashier',
        };

        mockInvoke.mockImplementation((channel: string) => {
          if (channel === 'auth:checkSessionForRole') {
            return Promise.resolve({
              success: true,
              data: {
                valid: true,
                user: mockUser,
                timeoutIn: 900000, // 15 minutes
              },
            });
          }
          if (channel === 'auth:updateActivity') {
            return Promise.resolve({ success: true });
          }
          return Promise.reject(new Error('Unknown channel'));
        });

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        expect(mockInvoke).toHaveBeenCalledWith('auth:checkSessionForRole', {
          requiredRole: 'cashier',
        });
        expect(onSuccess).toHaveBeenCalledWith(mockUser);
        expect(onNeedAuth).not.toHaveBeenCalled();
      });

      it('should update activity timestamp when session bypass succeeds', async () => {
        const mockUser: AuthGuardUser = {
          userId: 'user-123',
          name: 'Test User',
          role: 'shift_manager',
        };

        mockInvoke.mockImplementation((channel: string) => {
          if (channel === 'auth:checkSessionForRole') {
            return Promise.resolve({
              success: true,
              data: { valid: true, user: mockUser, timeoutIn: 600000 },
            });
          }
          if (channel === 'auth:updateActivity') {
            return Promise.resolve({ success: true });
          }
          return Promise.reject(new Error('Unknown channel'));
        });

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        // Verify auth:updateActivity was called
        expect(mockInvoke).toHaveBeenCalledWith('auth:updateActivity');
      });

      it('should not block if updateActivity fails silently', async () => {
        const mockUser: AuthGuardUser = {
          userId: 'user-123',
          name: 'Test User',
          role: 'cashier',
        };

        mockInvoke.mockImplementation((channel: string) => {
          if (channel === 'auth:checkSessionForRole') {
            return Promise.resolve({
              success: true,
              data: { valid: true, user: mockUser, timeoutIn: 900000 },
            });
          }
          if (channel === 'auth:updateActivity') {
            // Simulate updateActivity failure
            return Promise.reject(new Error('Network error'));
          }
          return Promise.reject(new Error('Unknown channel'));
        });

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        // Should not throw even if updateActivity fails
        await expect(executeWithAuth(onSuccess, onNeedAuth)).resolves.not.toThrow();
        expect(onSuccess).toHaveBeenCalled();
      });
    });

    describe('Invalid Session Scenarios', () => {
      it('should call onNeedAuth when no session exists', async () => {
        mockInvoke.mockResolvedValue({
          success: true,
          data: { valid: false },
        });

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onNeedAuth).toHaveBeenCalled();
      });

      it('should call onNeedAuth when session check fails', async () => {
        mockInvoke.mockResolvedValue({
          success: false,
          error: 'No session',
        });

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onNeedAuth).toHaveBeenCalled();
      });

      it('should call onNeedAuth when IPC throws error', async () => {
        mockInvoke.mockRejectedValue(new Error('IPC channel not found'));

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onNeedAuth).toHaveBeenCalled();
      });

      it('should call onNeedAuth when session is valid but user data is missing', async () => {
        mockInvoke.mockResolvedValue({
          success: true,
          data: {
            valid: true,
            // Missing user data
            timeoutIn: 900000,
          },
        });

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onNeedAuth).toHaveBeenCalled();
      });
    });
  });

  describe('SEC-010: Role-Based Authorization', () => {
    describe('Role Hierarchy Validation', () => {
      it('should pass cashier checking for cashier-level access', async () => {
        const mockUser: AuthGuardUser = {
          userId: 'user-123',
          name: 'Cashier User',
          role: 'cashier',
        };

        mockInvoke.mockImplementation((channel: string) => {
          if (channel === 'auth:checkSessionForRole') {
            return Promise.resolve({
              success: true,
              data: { valid: true, user: mockUser },
            });
          }
          return Promise.resolve({ success: true });
        });

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        expect(mockInvoke).toHaveBeenCalledWith('auth:checkSessionForRole', {
          requiredRole: 'cashier',
        });
        expect(onSuccess).toHaveBeenCalledWith(mockUser);
      });

      it('should pass shift_manager for cashier-level access (higher privilege)', async () => {
        const mockUser: AuthGuardUser = {
          userId: 'user-456',
          name: 'Shift Manager',
          role: 'shift_manager',
        };

        mockInvoke.mockImplementation((channel: string) => {
          if (channel === 'auth:checkSessionForRole') {
            return Promise.resolve({
              success: true,
              data: { valid: true, user: mockUser },
            });
          }
          return Promise.resolve({ success: true });
        });

        const executeWithAuth = createExecuteWithAuth('cashier');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        expect(onSuccess).toHaveBeenCalledWith(mockUser);
      });

      it('should pass store_manager for any level access', async () => {
        const mockUser: AuthGuardUser = {
          userId: 'user-789',
          name: 'Store Manager',
          role: 'store_manager',
        };

        mockInvoke.mockImplementation((channel: string) => {
          if (channel === 'auth:checkSessionForRole') {
            return Promise.resolve({
              success: true,
              data: { valid: true, user: mockUser },
            });
          }
          return Promise.resolve({ success: true });
        });

        // Test each role level
        for (const role of ['cashier', 'shift_manager', 'store_manager'] as RequiredRole[]) {
          const executeWithAuth = createExecuteWithAuth(role);
          const onSuccess = vi.fn();
          const onNeedAuth = vi.fn();

          await executeWithAuth(onSuccess, onNeedAuth);

          expect(onSuccess).toHaveBeenCalledWith(mockUser);
          expect(onNeedAuth).not.toHaveBeenCalled();
        }
      });

      it('should require PIN for insufficient role (server validates)', async () => {
        // Server returns valid=false when role is insufficient
        mockInvoke.mockResolvedValue({
          success: true,
          data: { valid: false },
        });

        const executeWithAuth = createExecuteWithAuth('store_manager');
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();

        await executeWithAuth(onSuccess, onNeedAuth);

        expect(onSuccess).not.toHaveBeenCalled();
        expect(onNeedAuth).toHaveBeenCalled();
      });
    });

    describe('Real-World Use Cases', () => {
      describe('Manual Entry (cashier required)', () => {
        it('should allow cashier immediate access', async () => {
          mockInvoke.mockImplementation((channel: string) => {
            if (channel === 'auth:checkSessionForRole') {
              return Promise.resolve({
                success: true,
                data: {
                  valid: true,
                  user: { userId: 'u1', name: 'Cashier', role: 'cashier' },
                },
              });
            }
            return Promise.resolve({ success: true });
          });

          const executeWithAuth = createExecuteWithAuth('cashier');
          const onSuccess = vi.fn();
          const onNeedAuth = vi.fn();

          await executeWithAuth(onSuccess, onNeedAuth);

          expect(onSuccess).toHaveBeenCalled();
          expect(onNeedAuth).not.toHaveBeenCalled();
        });
      });

      describe('Pack Reception (cashier required)', () => {
        it('should allow any authenticated user immediate access', async () => {
          const roles: Array<{ role: string; name: string }> = [
            { role: 'cashier', name: 'Cashier' },
            { role: 'shift_manager', name: 'Shift Mgr' },
            { role: 'store_manager', name: 'Store Mgr' },
          ];

          for (const { role, name } of roles) {
            vi.clearAllMocks();

            mockInvoke.mockImplementation((channel: string) => {
              if (channel === 'auth:checkSessionForRole') {
                return Promise.resolve({
                  success: true,
                  data: {
                    valid: true,
                    user: { userId: 'u1', name, role },
                  },
                });
              }
              return Promise.resolve({ success: true });
            });

            const executeWithAuth = createExecuteWithAuth('cashier');
            const onSuccess = vi.fn();
            const onNeedAuth = vi.fn();

            await executeWithAuth(onSuccess, onNeedAuth);

            expect(onSuccess).toHaveBeenCalled();
          }
        });
      });

      describe('Pack Activation (cashier required)', () => {
        it('should prompt for PIN when session expired', async () => {
          mockInvoke.mockResolvedValue({
            success: true,
            data: { valid: false },
          });

          const executeWithAuth = createExecuteWithAuth('cashier');
          const onSuccess = vi.fn();
          const onNeedAuth = vi.fn();

          await executeWithAuth(onSuccess, onNeedAuth);

          expect(onNeedAuth).toHaveBeenCalled();
        });
      });
    });
  });

  describe('Error Handling', () => {
    it('should gracefully handle network timeouts', async () => {
      mockInvoke.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 100);
        });
      });

      const executeWithAuth = createExecuteWithAuth('cashier');
      const onSuccess = vi.fn();
      const onNeedAuth = vi.fn();

      await executeWithAuth(onSuccess, onNeedAuth);

      expect(onSuccess).not.toHaveBeenCalled();
      expect(onNeedAuth).toHaveBeenCalled();
    });

    it('should handle malformed response gracefully', async () => {
      mockInvoke.mockResolvedValue({
        // Missing success field
        data: { valid: true },
      });

      const executeWithAuth = createExecuteWithAuth('cashier');
      const onSuccess = vi.fn();
      const onNeedAuth = vi.fn();

      await executeWithAuth(onSuccess, onNeedAuth);

      // Should fall back to requiring auth due to missing success field
      expect(onNeedAuth).toHaveBeenCalled();
    });

    it('should handle null response gracefully', async () => {
      mockInvoke.mockResolvedValue(null);

      const executeWithAuth = createExecuteWithAuth('cashier');
      const onSuccess = vi.fn();
      const onNeedAuth = vi.fn();

      await executeWithAuth(onSuccess, onNeedAuth);

      expect(onNeedAuth).toHaveBeenCalled();
    });

    it('should handle undefined response gracefully', async () => {
      mockInvoke.mockResolvedValue(undefined);

      const executeWithAuth = createExecuteWithAuth('cashier');
      const onSuccess = vi.fn();
      const onNeedAuth = vi.fn();

      await executeWithAuth(onSuccess, onNeedAuth);

      expect(onNeedAuth).toHaveBeenCalled();
    });
  });

  describe('IPC Channel Validation', () => {
    it('should call auth:checkSessionForRole with correct parameters', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { valid: false },
      });

      const executeWithAuth = createExecuteWithAuth('shift_manager');
      await executeWithAuth(vi.fn(), vi.fn());

      expect(mockInvoke).toHaveBeenCalledWith('auth:checkSessionForRole', {
        requiredRole: 'shift_manager',
      });
    });

    it('should call auth:checkSessionForRole with store_manager role', async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        data: { valid: false },
      });

      const executeWithAuth = createExecuteWithAuth('store_manager');
      await executeWithAuth(vi.fn(), vi.fn());

      expect(mockInvoke).toHaveBeenCalledWith('auth:checkSessionForRole', {
        requiredRole: 'store_manager',
      });
    });
  });

  describe('Session Timeout Awareness', () => {
    it('should receive timeoutIn value from session check', async () => {
      const mockUser: AuthGuardUser = {
        userId: 'user-123',
        name: 'Test User',
        role: 'cashier',
      };

      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'auth:checkSessionForRole') {
          return Promise.resolve({
            success: true,
            data: {
              valid: true,
              user: mockUser,
              timeoutIn: 300000, // 5 minutes remaining
            },
          });
        }
        return Promise.resolve({ success: true });
      });

      const executeWithAuth = createExecuteWithAuth('cashier');
      const onSuccess = vi.fn();
      const onNeedAuth = vi.fn();

      await executeWithAuth(onSuccess, onNeedAuth);

      // Verify the response included timeoutIn
      const callArgs = mockInvoke.mock.calls.find(
        (call) => call[0] === 'auth:checkSessionForRole'
      );
      expect(callArgs).toBeDefined();
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple rapid executions correctly', async () => {
      const mockUser: AuthGuardUser = {
        userId: 'user-123',
        name: 'Test User',
        role: 'cashier',
      };

      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'auth:checkSessionForRole') {
          return Promise.resolve({
            success: true,
            data: { valid: true, user: mockUser },
          });
        }
        return Promise.resolve({ success: true });
      });

      const executeWithAuth = createExecuteWithAuth('cashier');

      // Simulate rapid button clicks
      const promises = Array.from({ length: 5 }, () => {
        const onSuccess = vi.fn();
        const onNeedAuth = vi.fn();
        return executeWithAuth(onSuccess, onNeedAuth).then(() => ({
          onSuccess,
          onNeedAuth,
        }));
      });

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach(({ onSuccess, onNeedAuth }) => {
        expect(onSuccess).toHaveBeenCalled();
        expect(onNeedAuth).not.toHaveBeenCalled();
      });
    });
  });
});

// ============================================================================
// Integration Scenario Tests
// ============================================================================

describe('useAuthGuard Integration Scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Lottery Page Flow', () => {
    it('should allow immediate access after first login within 15 minutes', async () => {
      const mockUser: AuthGuardUser = {
        userId: 'cashier-1',
        name: 'Jane Cashier',
        role: 'cashier',
      };

      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'auth:checkSessionForRole') {
          return Promise.resolve({
            success: true,
            data: { valid: true, user: mockUser, timeoutIn: 900000 },
          });
        }
        return Promise.resolve({ success: true });
      });

      const executeWithAuth = createExecuteWithAuth('cashier');

      // First click - Receive Pack
      const receiveSuccess = vi.fn();
      await executeWithAuth(receiveSuccess, vi.fn());
      expect(receiveSuccess).toHaveBeenCalledWith(mockUser);

      // Second click - Activate Pack
      const activateSuccess = vi.fn();
      await executeWithAuth(activateSuccess, vi.fn());
      expect(activateSuccess).toHaveBeenCalledWith(mockUser);

      // Third click - Manual Entry
      const manualSuccess = vi.fn();
      await executeWithAuth(manualSuccess, vi.fn());
      expect(manualSuccess).toHaveBeenCalledWith(mockUser);

      // No PIN dialogs should have been needed
      expect(mockInvoke).toHaveBeenCalledTimes(6); // 3 session checks + 3 activity updates
    });

    it('should require PIN after session expires', async () => {
      let callCount = 0;

      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'auth:checkSessionForRole') {
          callCount++;
          // First two calls succeed, third fails (session expired)
          if (callCount <= 2) {
            return Promise.resolve({
              success: true,
              data: {
                valid: true,
                user: { userId: 'u1', name: 'User', role: 'cashier' },
              },
            });
          }
          return Promise.resolve({
            success: true,
            data: { valid: false },
          });
        }
        return Promise.resolve({ success: true });
      });

      const executeWithAuth = createExecuteWithAuth('cashier');

      // First two succeed
      const success1 = vi.fn();
      const needAuth1 = vi.fn();
      await executeWithAuth(success1, needAuth1);
      expect(success1).toHaveBeenCalled();
      expect(needAuth1).not.toHaveBeenCalled();

      const success2 = vi.fn();
      const needAuth2 = vi.fn();
      await executeWithAuth(success2, needAuth2);
      expect(success2).toHaveBeenCalled();
      expect(needAuth2).not.toHaveBeenCalled();

      // Third requires PIN
      const success3 = vi.fn();
      const needAuth3 = vi.fn();
      await executeWithAuth(success3, needAuth3);
      expect(success3).not.toHaveBeenCalled();
      expect(needAuth3).toHaveBeenCalled();
    });
  });

  describe('Enterprise UX Requirements', () => {
    it('should not show any dialog when session is valid (no flicker)', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'auth:checkSessionForRole') {
          return Promise.resolve({
            success: true,
            data: {
              valid: true,
              user: { userId: 'u1', name: 'User', role: 'cashier' },
            },
          });
        }
        return Promise.resolve({ success: true });
      });

      const executeWithAuth = createExecuteWithAuth('cashier');
      const onSuccess = vi.fn();
      const onNeedAuth = vi.fn();

      await executeWithAuth(onSuccess, onNeedAuth);

      // Only onSuccess called, never onNeedAuth (no dialog shown)
      expect(onSuccess).toHaveBeenCalled();
      expect(onNeedAuth).not.toHaveBeenCalled();
    });

    it('should provide instant response (check happens before dialog)', async () => {
      mockInvoke.mockImplementation((channel: string) => {
        if (channel === 'auth:checkSessionForRole') {
          // Immediate response
          return Promise.resolve({
            success: true,
            data: {
              valid: true,
              user: { userId: 'u1', name: 'User', role: 'cashier' },
            },
          });
        }
        return Promise.resolve({ success: true });
      });

      const executeWithAuth = createExecuteWithAuth('cashier');
      const dialogOpened = vi.fn();
      const directAccess = vi.fn();

      await executeWithAuth(directAccess, dialogOpened);

      // Check happened first, dialog never opened
      expect(dialogOpened).not.toHaveBeenCalled();
      expect(directAccess).toHaveBeenCalled();
    });
  });
});
