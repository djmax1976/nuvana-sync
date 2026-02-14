/**
 * IPC Client for Renderer
 *
 * Provides a type-safe client for IPC communication with the main process.
 * Wraps window.electronAPI with error handling and TypeScript types.
 *
 * In development mode (browser without Electron), automatically uses mock data
 * to allow UI development and testing.
 *
 * @module renderer/lib/api/ipc-client
 * @security SEC-014: Uses preload's allowlisted channels
 */

import * as mockData from './mock-data';

// ============================================================================
// Environment Detection
// ============================================================================

/**
 * Check if running in Electron environment
 */
export const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

// ============================================================================
// Types
// ============================================================================

/**
 * Standard IPC error response from main process
 */
export interface IPCErrorResponse {
  error: string;
  message: string;
}

/**
 * Custom error class for IPC errors
 */
export class IPCError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IPCError';
    this.code = code;
  }
}

// ============================================================================
// IPC Client Class
// ============================================================================

/**
 * IPC Client for communicating with the main process
 * Uses window.electronAPI exposed by the preload script
 * Falls back to mock data in dev mode (browser without Electron)
 */
class IPCClient {
  /**
   * Invoke an IPC channel and handle errors
   *
   * @template T - Expected response type
   * @param channel - IPC channel name
   * @param args - Arguments to pass to the handler
   * @returns Promise resolving to the response data
   * @throws IPCError if the handler returns an error response
   */
  async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    // In dev mode without Electron, return mock data
    if (!isElectron) {
      return this.getMockData<T>(channel, args);
    }

    try {
      const response = await window.electronAPI.invoke<
        T | IPCErrorResponse | { success: boolean; data?: T; error?: string; message?: string }
      >(channel, ...args);

      // Check for error response format
      if (response && typeof response === 'object' && 'error' in response) {
        const errorResponse = response as IPCErrorResponse;
        throw new IPCError(errorResponse.error, errorResponse.message || 'Unknown error');
      }

      // Unwrap success response format: {success: true, data: T}
      if (
        response &&
        typeof response === 'object' &&
        'success' in response &&
        (response as { success: boolean }).success === true &&
        'data' in response
      ) {
        return (response as { success: boolean; data: T }).data;
      }

      return response as T;
    } catch (error) {
      // Re-throw IPCError as-is
      if (error instanceof IPCError) {
        throw error;
      }

      // Wrap other errors
      const message = error instanceof Error ? error.message : String(error);
      throw new IPCError('IPC_ERROR', message);
    }
  }

  /**
   * Get mock data for dev mode
   * Simulates IPC responses using mock-data module
   */
  private getMockData<T>(channel: string, args: unknown[]): Promise<T> {
    // Add small delay to simulate async IPC call
    return new Promise((resolve) => {
      setTimeout(() => {
        const result = this.resolveMockChannel<T>(channel, args);
        resolve(result);
      }, 100);
    });
  }

  /**
   * Resolve mock data based on channel
   */
  private resolveMockChannel<T>(channel: string, args: unknown[]): T {
    const params = args[0] as Record<string, unknown> | undefined;

    switch (channel) {
      // Stores
      case 'stores:getInfo':
        return mockData.getMockStoreInfo() as T;
      case 'stores:getStatus':
        return mockData.getMockStoreStatus() as T;
      case 'stores:isConfigured':
        return mockData.getMockIsConfigured() as T;

      // Settings
      case 'settings:getPOSConnectionType':
        // Mock as MANUAL with MANUAL_ENTRY posType for testing manual shift functionality
        return { connectionType: 'MANUAL', posType: 'MANUAL_ENTRY' } as T;

      // Dashboard
      case 'dashboard:getStats':
        return mockData.mockDashboardStats as T;
      case 'dashboard:getTodaySales':
        return mockData.mockTodaySales as T;
      case 'dashboard:getWeeklySales':
        return mockData.mockWeeklySales as T;

      // Shifts
      case 'shifts:list':
        return mockData.getMockShiftList(
          params as Parameters<typeof mockData.getMockShiftList>[0]
        ) as T;
      case 'shifts:getById': {
        // Mock includes cashier_name for dev mode (matches production handler)
        const mockShift = mockData.getMockShiftById(params as unknown as string);
        return mockShift ? ({ ...mockShift, cashier_name: 'Mock Cashier' } as T) : ({} as T);
      }
      case 'shifts:getSummary':
        return (mockData.getMockShiftSummary(params as unknown as string) || {}) as T;
      case 'shifts:findOpenShifts':
        return mockData.getMockOpenShifts() as T;
      case 'shifts:close': {
        // Simulate close - return the shift with CLOSED status and cashier_name
        const shiftId = params as unknown as string;
        const shift = mockData.getMockShiftById(shiftId);
        return (shift ? { ...shift, status: 'CLOSED', cashier_name: 'Mock Cashier' } : {}) as T;
      }
      case 'shifts:manualStart': {
        // Simulate manual shift start - return a new mock shift
        // In production, cashier_id is determined by PIN lookup
        const manualParams = params as unknown as ManualStartShiftParams;
        return {
          shift_id: `shift-manual-${Date.now()}`,
          store_id: 'store-1',
          shift_number: 1,
          business_date: manualParams?.businessDate || new Date().toISOString().split('T')[0],
          cashier_id: 'mock-cashier-id', // Would be determined by PIN in production
          register_id: manualParams?.externalRegisterId || '1',
          start_time: manualParams?.startTime || new Date().toISOString(),
          end_time: null,
          status: 'OPEN',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as T;
      }

      // Day Summaries
      case 'daySummaries:list':
        return mockData.getMockDaySummaryList(
          params as Parameters<typeof mockData.getMockDaySummaryList>[0]
        ) as T;
      case 'daySummaries:getByDate':
        return (mockData.getMockDaySummaryByDate(params as unknown as string) || {}) as T;
      case 'daySummaries:close': {
        // Simulate close
        const dateForClose = params as unknown as string;
        const summary = mockData.getMockDaySummaryByDate(dateForClose);
        return (summary ? { ...summary.summary, status: 'CLOSED' } : {}) as T;
      }

      // Transactions
      case 'transactions:list':
        return mockData.getMockTransactionList(
          params as Parameters<typeof mockData.getMockTransactionList>[0]
        ) as T;
      case 'transactions:getById':
        return (mockData.getMockTransactionById(params as unknown as string) || {}) as T;

      // Reports
      case 'reports:weekly':
        return mockData.getMockWeeklyReport(params as unknown as string) as T;
      case 'reports:monthly':
        return mockData.getMockMonthlyReport(params as { year: number; month: number }) as T;
      case 'reports:dateRange':
        return mockData.getMockDateRangeReport(
          params as { startDate: string; endDate: string }
        ) as T;

      // Lottery
      case 'lottery:getGames':
        return mockData.getMockLotteryGames() as T;
      case 'lottery:getBins':
        return mockData.getMockLotteryBins() as T;
      case 'lottery:getPacks':
        return mockData.getMockLotteryPacks(params as { status?: string; game_id?: string }) as T;
      case 'lottery:parseBarcode':
        return mockData.getMockParsedBarcode(params as unknown as string) as T;
      case 'lottery:checkPackExists':
        // Mock: return not exists for most packs, exists for specific test case
        return {
          exists: false,
          pack: undefined,
        } as T;
      case 'lottery:receivePack':
        // Return a mock received pack
        return {
          pack_id: `pack-${Date.now()}`,
          game_id: 'game-1',
          pack_number: 'PKG1234567',
          status: 'RECEIVED',
          received_at: new Date().toISOString(),
          game: {
            game_id: 'game-1',
            game_code: '1001',
            name: 'Lucky 7s',
            price: 1,
          },
        } as T;
      case 'lottery:receivePackBatch': {
        // Return a mock batch response
        const batchParams = params as { serialized_numbers: string[]; store_id: string };
        const created = (batchParams?.serialized_numbers || []).map((serial, index) => ({
          pack_id: `pack-${Date.now()}-${index}`,
          game_id: 'game-1',
          pack_number: `PKG${serial.substring(0, 7)}`,
          status: 'RECEIVED' as const,
          received_at: new Date().toISOString(),
          game: {
            game_id: 'game-1',
            game_code: serial.substring(0, 4),
            name: 'Lucky 7s',
            price: 1,
          },
        }));
        return {
          created,
          duplicates: [],
          errors: [],
        } as T;
      }
      case 'lottery:activatePack':
        return {
          pack_id: (params as { pack_id: string }).pack_id,
          game_id: 'game-1',
          pack_number: 'PKG1234567',
          status: 'ACTIVE',
          activated_at: new Date().toISOString(),
          bin_id: (params as { bin_id: string }).bin_id,
          opening_serial: (params as { opening_serial: string }).opening_serial,
          game: { game_id: 'game-1', name: 'Lucky 7s' },
          bin: { bin_id: (params as { bin_id: string }).bin_id, name: 'Bin 1', display_order: 1 },
        } as T;
      case 'lottery:depletePack':
        return {
          pack_id: (params as { pack_id: string }).pack_id,
          pack_number: 'PKG1234567',
          status: 'DEPLETED',
          depleted_at: new Date().toISOString(),
          closing_serial: (params as { closing_serial: string }).closing_serial,
          tickets_sold: 150,
          sales_amount: 150,
        } as T;
      case 'lottery:returnPack':
        return {
          pack_id: (params as { pack_id: string }).pack_id,
          pack_number: 'PKG1234567',
          status: 'RETURNED',
          returned_at: new Date().toISOString(),
          return_reason: (params as { return_reason: string }).return_reason,
        } as T;
      case 'lottery:prepareDayClose':
        return {
          day_id: `day-${Date.now()}`,
          business_date: new Date().toISOString().split('T')[0],
          status: 'PENDING_CLOSE',
          pending_close_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          closings_count: 5,
          estimated_lottery_total: 450.0,
          bins_preview: [],
        } as T;
      case 'lottery:commitDayClose':
        return {
          day_id: `day-${Date.now()}`,
          business_date: new Date().toISOString().split('T')[0],
          closed_at: new Date().toISOString(),
          closings_created: 5,
          lottery_total: 450.0,
          bins_closed: [],
        } as T;
      case 'lottery:cancelDayClose':
        return { cancelled: true, message: 'Day close cancelled' } as T;
      case 'lottery:getPackDetails':
        return {
          pack_id: (params as { pack_id: string }).pack_id,
          game_id: 'game-1',
          pack_number: 'PKG1234567',
          opening_serial: '000',
          closing_serial: null,
          status: 'ACTIVE',
          store_id: 'store-1',
          bin_id: 'bin-1',
          received_at: new Date().toISOString(),
          activated_at: new Date().toISOString(),
          depleted_at: null,
          returned_at: null,
          game: {
            game_id: 'game-1',
            game_code: '1001',
            name: 'Lucky 7s',
            price: 1,
            tickets_per_pack: 300,
          },
          bin: { bin_id: 'bin-1', name: 'Bin 1', display_order: 1 },
          tickets_sold: 150,
          sales_amount: 150,
        } as T;
      case 'lottery:updatePack':
        return {
          pack_id: (params as { pack_id: string }).pack_id,
          game_id: 'game-1',
          pack_number: (params as { pack_number?: string }).pack_number || 'PKG1234567',
          status: (params as { status?: string }).status || 'ACTIVE',
          store_id: 'store-1',
        } as T;
      case 'lottery:deletePack':
        return { deleted: true } as T;
      case 'lottery:activatePackFull':
        return {
          pack_id: (params as { pack_id: string }).pack_id,
          game_id: 'game-1',
          pack_number: 'PKG1234567',
          status: 'ACTIVE',
          activated_at: new Date().toISOString(),
          bin_id: (params as { bin_id: string }).bin_id,
          opening_serial: (params as { opening_serial: string }).opening_serial,
          game: { game_id: 'game-1', name: 'Lucky 7s' },
          bin: { bin_id: (params as { bin_id: string }).bin_id, name: 'Bin 1', display_order: 1 },
        } as T;
      case 'lottery:getVariances':
        return [] as T;
      case 'lottery:approveVariance':
        return {
          variance_id: `var-${Date.now()}`,
          pack_id: 'pack-1',
          shift_id: (params as { shift_id: string }).shift_id,
          status: (params as { approved: boolean }).approved ? 'APPROVED' : 'REJECTED',
        } as T;
      case 'lottery:createGame':
        return {
          game_id: `game-${Date.now()}`,
          game_code: (params as { game_code: string }).game_code,
          name: (params as { name: string }).name,
          price: (params as { price: number }).price,
          tickets_per_pack: Math.floor(
            (params as { pack_value: number }).pack_value / (params as { price: number }).price
          ),
          pack_value: (params as { pack_value: number }).pack_value,
          status: 'ACTIVE',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as T;
      case 'lottery:updateGame':
        return {
          game_id: (params as { game_id: string }).game_id,
          game_code: '1001',
          name: (params as { name?: string }).name || 'Lucky 7s',
          price: (params as { price?: number }).price || 1,
          tickets_per_pack: 300,
          status: (params as { status?: string }).status || 'ACTIVE',
        } as T;
      case 'lottery:getConfigValues':
        return {
          ticket_prices: [
            { config_value_id: 'price-1', amount: 1 },
            { config_value_id: 'price-2', amount: 2 },
            { config_value_id: 'price-3', amount: 3 },
            { config_value_id: 'price-5', amount: 5 },
            { config_value_id: 'price-10', amount: 10 },
            { config_value_id: 'price-20', amount: 20 },
            { config_value_id: 'price-25', amount: 25 },
            { config_value_id: 'price-30', amount: 30 },
            { config_value_id: 'price-50', amount: 50 },
          ],
          pack_values: [
            { config_value_id: 'pack-150', amount: 150 },
            { config_value_id: 'pack-200', amount: 200 },
            { config_value_id: 'pack-250', amount: 250 },
            { config_value_id: 'pack-300', amount: 300 },
            { config_value_id: 'pack-500', amount: 500 },
            { config_value_id: 'pack-600', amount: 600 },
            { config_value_id: 'pack-750', amount: 750 },
            { config_value_id: 'pack-1000', amount: 1000 },
            { config_value_id: 'pack-1500', amount: 1500 },
          ],
        } as T;
      case 'shifts:getActiveShift':
        return {
          shift_id: 'shift-active',
          store_id: (params as { store_id: string }).store_id,
          cashier_id: (params as { cashier_id: string }).cashier_id,
          started_at: new Date().toISOString(),
          status: 'OPEN',
        } as T;
      case 'shifts:getOpenShifts': {
        // Mock open shifts with resolved names for DayClosePage
        const mockOpenShifts = mockData.getMockOpenShifts();
        return {
          open_shifts: mockOpenShifts.map((shift, idx) => ({
            shift_id: shift.shift_id,
            terminal_name: `Register ${idx + 1}`,
            cashier_name: `Cashier ${idx + 1}`,
            shift_number: shift.shift_number,
            status: shift.status,
            external_register_id: shift.register_id,
            business_date: shift.business_date,
            start_time: shift.start_time,
          })),
        } as T;
      }

      // Terminals/Registers
      case 'terminals:list':
        return mockData.getMockRegisters() as T;
      case 'terminals:getById': {
        const regId = params as unknown as string;
        const allRegs = mockData.getMockRegisters();
        const found = allRegs.registers.find((r) => r.id === regId);
        return (found || {}) as T;
      }
      case 'terminals:update': {
        const updateParams = params as { registerId: string; description?: string };
        return {
          id: updateParams.registerId,
          external_register_id: '1',
          terminal_type: 'REGISTER',
          description: updateParams.description || null,
          active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as T;
      }
      case 'terminals:getDayStatus': {
        // Mock day status - returns based on mock registers with active shifts
        const mockRegs = mockData.getMockRegisters();
        const openShiftCount = mockRegs.registers.filter((r) => r.activeShift !== null).length;
        return {
          dayStarted: mockRegs.registers.length > 0,
          hasOpenShifts: openShiftCount > 0,
          openShiftCount,
          totalShiftCount: mockRegs.registers.length,
          businessDate: new Date().toISOString().split('T')[0],
        } as T;
      }

      // Employees
      case 'employees:list':
        return mockData.getMockEmployees() as T;
      case 'employees:listActive':
        // Return only active employees for shift selection
        return mockData.getMockEmployees() as T;
      case 'cashiers:list': {
        // Mock cashiers list for DayClosePage
        const mockEmployees = mockData.getMockEmployees();
        return {
          cashiers: mockEmployees.employees.map((emp) => ({
            cashier_id: emp.user_id,
            name: emp.name,
            role: emp.role,
          })),
          total: mockEmployees.employees.length,
        } as T;
      }

      // Store
      case 'store:getConfigured': {
        // Mock configured store for DayClosePage
        return {
          store_id: 'store-1',
          name: 'Test Gas Station',
        } as T;
      }
      case 'employees:create':
        return {
          employee: {
            user_id: `user-${Date.now()}`,
            store_id: 'store-1',
            role: (params as { role: string }).role,
            name: (params as { name: string }).name,
            active: 1,
            last_login_at: null,
            synced_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        } as T;
      case 'employees:update':
        return {
          employee: {
            user_id: (params as { userId: string }).userId,
            store_id: 'store-1',
            role: (params as { role?: string }).role || 'cashier',
            name: (params as { name?: string }).name || 'Updated Employee',
            active: 1,
            last_login_at: null,
            synced_at: null,
            created_at: '2024-01-01T00:00:00.000Z',
            updated_at: new Date().toISOString(),
          },
        } as T;
      case 'employees:updatePin':
        return { success: true, message: 'PIN updated successfully' } as T;
      case 'employees:deactivate':
        return { success: true, message: 'Employee deactivated successfully' } as T;
      case 'employees:reactivate':
        return { success: true, message: 'Employee reactivated successfully' } as T;

      // Sync Activity (Dev Monitor)
      case 'sync:getActivity':
        return {
          queued: [
            {
              id: 'queue-1',
              entity_type: 'pack',
              entity_id: 'pack-123',
              operation: 'ACTIVATE',
              status: 'queued',
              sync_attempts: 0,
              max_attempts: 5,
              last_sync_error: null,
              last_attempt_at: null,
              created_at: new Date(Date.now() - 60000).toISOString(),
              synced_at: null,
              sync_direction: 'PUSH',
              api_endpoint: '/api/v1/sync/lottery/packs/activate',
              http_status: null,
              response_body: null,
              summary: { pack_number: 'PKG0001234', game_code: '1001', status: 'ACTIVE' },
            },
            {
              id: 'queue-2',
              entity_type: 'pack',
              entity_id: 'pack-456',
              operation: 'UPDATE',
              status: 'failed',
              sync_attempts: 5,
              max_attempts: 5,
              last_sync_error: '404 GAME_NOT_FOUND - Game code 1868 not found in cloud',
              last_attempt_at: new Date(Date.now() - 30000).toISOString(),
              created_at: new Date(Date.now() - 120000).toISOString(),
              synced_at: null,
              sync_direction: 'PUSH',
              api_endpoint: '/api/v1/sync/lottery/packs/deplete',
              http_status: 404,
              response_body: '{"code":"GAME_NOT_FOUND","message":"Game code 1868 not found"}',
              summary: { pack_number: 'PKG0005678', game_code: '2002', status: 'DEPLETED' },
            },
          ],
          recentlySynced: [
            {
              id: 'synced-1',
              entity_type: 'pack',
              entity_id: 'pack-789',
              operation: 'CREATE',
              status: 'synced',
              sync_attempts: 1,
              max_attempts: 5,
              last_sync_error: null,
              last_attempt_at: new Date(Date.now() - 240000).toISOString(),
              created_at: new Date(Date.now() - 300000).toISOString(),
              synced_at: new Date(Date.now() - 240000).toISOString(),
              sync_direction: 'PUSH',
              api_endpoint: '/api/v1/sync/lottery/packs/receive',
              http_status: 200,
              response_body: null,
              summary: { pack_number: 'PKG0009012', game_code: '3003', status: 'RECEIVED' },
            },
          ],
          stats: {
            pendingCount: 2,
            failedCount: 1,
            syncedTodayCount: 15,
          },
        } as T;
      case 'sync:getActivityPaginated':
        return {
          items: [
            {
              id: 'queue-1',
              entity_type: 'pack',
              entity_id: 'pack-123',
              operation: 'ACTIVATE',
              status: 'queued',
              sync_attempts: 0,
              max_attempts: 5,
              last_sync_error: null,
              last_attempt_at: null,
              created_at: new Date(Date.now() - 60000).toISOString(),
              synced_at: null,
              sync_direction: 'PUSH',
              api_endpoint: '/api/v1/sync/lottery/packs/activate',
              http_status: null,
              response_body: null,
              summary: { pack_number: 'PKG0001234', game_code: '1001', status: 'ACTIVE' },
            },
            {
              id: 'queue-2',
              entity_type: 'pack',
              entity_id: 'pack-456',
              operation: 'UPDATE',
              status: 'failed',
              sync_attempts: 5,
              max_attempts: 5,
              last_sync_error: '404 GAME_NOT_FOUND - Game code 1868 not found in cloud',
              last_attempt_at: new Date(Date.now() - 30000).toISOString(),
              created_at: new Date(Date.now() - 120000).toISOString(),
              synced_at: null,
              sync_direction: 'PUSH',
              api_endpoint: '/api/v1/sync/lottery/packs/deplete',
              http_status: 404,
              response_body: '{"code":"GAME_NOT_FOUND","message":"Game code 1868 not found"}',
              summary: { pack_number: 'PKG0005678', game_code: '2002', status: 'DEPLETED' },
            },
            {
              id: 'synced-1',
              entity_type: 'pack',
              entity_id: 'pack-789',
              operation: 'CREATE',
              status: 'synced',
              sync_attempts: 1,
              max_attempts: 5,
              last_sync_error: null,
              last_attempt_at: new Date(Date.now() - 240000).toISOString(),
              created_at: new Date(Date.now() - 300000).toISOString(),
              synced_at: new Date(Date.now() - 240000).toISOString(),
              sync_direction: 'PUSH',
              api_endpoint: '/api/v1/sync/lottery/packs/receive',
              http_status: 200,
              response_body: null,
              summary: { pack_number: 'PKG0009012', game_code: '3003', status: 'RECEIVED' },
            },
          ],
          total: 3,
          limit: 50,
          offset: 0,
          hasMore: false,
          stats: {
            pending: 1,
            failed: 1,
            syncedToday: 15,
            syncedTotal: 150,
            oldestPending: new Date(Date.now() - 120000).toISOString(),
            newestSync: new Date(Date.now() - 240000).toISOString(),
            byEntityType: [{ entity_type: 'pack', pending: 1, failed: 1, synced: 1 }],
            byOperation: [
              { operation: 'CREATE', pending: 0, failed: 0, synced: 1 },
              { operation: 'UPDATE', pending: 0, failed: 1, synced: 0 },
              { operation: 'ACTIVATE', pending: 1, failed: 0, synced: 0 },
            ],
          },
        } as T;
      case 'sync:retryItem':
        return { success: true, retriedId: (params as { id: string }).id } as T;
      case 'sync:deleteItem':
        return { success: true, deletedId: (params as { id: string }).id } as T;

      // Dead Letter Queue mock data (v046)
      case 'sync:getDeadLetterItems':
        return {
          items: [
            {
              id: 'dlq-1',
              entity_type: 'pack',
              entity_id: 'pack-dead-1',
              operation: 'UPDATE',
              sync_direction: 'PUSH',
              sync_attempts: 5,
              max_attempts: 5,
              last_sync_error: '404 GAME_NOT_FOUND - Game code 9999 not found',
              dead_letter_reason: 'PERMANENT_ERROR',
              error_category: 'PERMANENT',
              dead_lettered_at: new Date(Date.now() - 3600000).toISOString(),
              created_at: new Date(Date.now() - 86400000).toISOString(),
              api_endpoint: '/api/v1/sync/lottery/packs/deplete',
              http_status: 404,
              response_body: '{"code":"GAME_NOT_FOUND","message":"Game not found"}',
              summary: { pack_number: 'PKG9999', game_code: '9999', status: 'DEPLETED' },
            },
            {
              id: 'dlq-2',
              entity_type: 'pack',
              entity_id: 'pack-dead-2',
              operation: 'ACTIVATE',
              sync_direction: 'PUSH',
              sync_attempts: 10,
              max_attempts: 5,
              last_sync_error: 'Connection timeout after 30000ms',
              dead_letter_reason: 'MAX_ATTEMPTS_EXCEEDED',
              error_category: 'TRANSIENT',
              dead_lettered_at: new Date(Date.now() - 7200000).toISOString(),
              created_at: new Date(Date.now() - 172800000).toISOString(),
              api_endpoint: '/api/v1/sync/lottery/packs/activate',
              http_status: null,
              response_body: null,
              summary: { pack_number: 'PKG8888', game_code: '1001', status: 'ACTIVE' },
            },
            {
              id: 'dlq-3',
              entity_type: 'pack',
              entity_id: 'pack-dead-3',
              operation: 'CREATE',
              sync_direction: 'PUSH',
              sync_attempts: 1,
              max_attempts: 5,
              last_sync_error: 'Missing required field: bin_id',
              dead_letter_reason: 'STRUCTURAL_FAILURE',
              error_category: 'STRUCTURAL',
              dead_lettered_at: new Date(Date.now() - 1800000).toISOString(),
              created_at: new Date(Date.now() - 43200000).toISOString(),
              api_endpoint: '/api/v1/sync/lottery/packs/receive',
              http_status: 400,
              response_body:
                '{"code":"VALIDATION_ERROR","message":"Missing required field: bin_id"}',
              summary: { pack_number: 'PKG7777', game_code: '2002', status: 'RECEIVED' },
            },
          ],
          total: 3,
          limit: 50,
          offset: 0,
          hasMore: false,
        } as T;
      case 'sync:getDeadLetterStats':
        return {
          total: 3,
          byReason: {
            MAX_ATTEMPTS_EXCEEDED: 1,
            PERMANENT_ERROR: 1,
            STRUCTURAL_FAILURE: 1,
            MANUAL: 0,
          },
          byEntityType: [{ entity_type: 'pack', count: 3 }],
          byErrorCategory: [
            { error_category: 'PERMANENT', count: 1 },
            { error_category: 'TRANSIENT', count: 1 },
            { error_category: 'STRUCTURAL', count: 1 },
          ],
          oldest: new Date(Date.now() - 172800000).toISOString(),
          newest: new Date(Date.now() - 1800000).toISOString(),
        } as T;
      case 'sync:restoreFromDeadLetter':
        return { restored: true, id: (params as { id: string }).id } as T;
      case 'sync:restoreFromDeadLetterMany':
        return {
          requested: (params as { ids: string[] }).ids.length,
          restored: (params as { ids: string[] }).ids.length,
        } as T;
      case 'sync:deleteDeadLetterItem':
        return { deleted: true, id: (params as { id: string }).id } as T;
      case 'sync:cleanupDeadLetter':
        return { deletedCount: 0, cutoffDate: new Date().toISOString() } as T;
      case 'sync:manualDeadLetter':
        return { deadLettered: true, id: (params as { id: string }).id } as T;

      default:
        console.warn(`[MockIPC] Unknown channel: ${channel}`);
        return {} as T;
    }
  }

  /**
   * Subscribe to an IPC event channel
   *
   * @param channel - Event channel name
   * @param callback - Callback function for events
   * @returns Unsubscribe function
   */
  on(channel: string, callback: (...args: unknown[]) => void): () => void {
    if (!window.electronAPI) {
      console.error('Electron API not available for event subscription');
      return () => {};
    }

    return window.electronAPI.on(channel, callback);
  }

  /**
   * One-time event listener
   *
   * @param channel - Event channel name
   * @param callback - Callback function
   */
  once(channel: string, callback: (...args: unknown[]) => void): void {
    if (!window.electronAPI) {
      console.error('Electron API not available for event subscription');
      return;
    }

    window.electronAPI.once(channel, callback);
  }
}

// Export singleton instance
export const ipcClient = new IPCClient();

// ============================================================================
// React Query Integration Helpers
// ============================================================================

/**
 * Create a query function for TanStack Query (React Query)
 * Wraps IPC invoke in a function suitable for useQuery
 *
 * @template T - Expected response type
 * @param channel - IPC channel name
 * @param staticArgs - Optional static arguments to always include
 * @returns Query function
 *
 * @example
 * ```typescript
 * const { data } = useQuery({
 *   queryKey: ['dashboard', 'stats'],
 *   queryFn: createIPCQueryFn<DashboardStats>('dashboard:getStats'),
 * });
 * ```
 */
export function createIPCQueryFn<T>(channel: string, ...staticArgs: unknown[]) {
  return async (): Promise<T> => {
    return ipcClient.invoke<T>(channel, ...staticArgs);
  };
}

/**
 * Create a mutation function for TanStack Query (React Query)
 * Wraps IPC invoke in a function suitable for useMutation
 *
 * @template T - Expected response type
 * @template V - Variables type
 * @param channel - IPC channel name
 * @returns Mutation function
 *
 * @example
 * ```typescript
 * const mutation = useMutation({
 *   mutationFn: createIPCMutationFn<Shift, string>('shifts:close'),
 * });
 *
 * mutation.mutate(shiftId);
 * ```
 */
export function createIPCMutationFn<T, V>(channel: string) {
  return async (variables: V): Promise<T> => {
    return ipcClient.invoke<T>(channel, variables);
  };
}

/**
 * Create a query function with dynamic arguments
 * Useful when query parameters vary
 *
 * @template T - Expected response type
 * @template A - Arguments type
 * @param channel - IPC channel name
 * @returns Function that takes arguments and returns a query function
 *
 * @example
 * ```typescript
 * const queryFn = createIPCQueryFnWithArgs<ShiftListResponse, ShiftListParams>('shifts:list');
 *
 * const { data } = useQuery({
 *   queryKey: ['shifts', 'list', params],
 *   queryFn: () => queryFn(params),
 * });
 * ```
 */
export function createIPCQueryFnWithArgs<T, A>(channel: string) {
  return async (args: A): Promise<T> => {
    return ipcClient.invoke<T>(channel, args);
  };
}

// ============================================================================
// Type-safe API Wrappers
// ============================================================================

// Stores API
export const storesAPI = {
  getInfo: () => ipcClient.invoke<StoreInfo>('stores:getInfo'),
  getStatus: () => ipcClient.invoke<StoreStatus>('stores:getStatus'),
  isConfigured: () => ipcClient.invoke<boolean>('stores:isConfigured'),
};

// Settings API
export const settingsAPI = {
  /** Get the current POS connection type (MANUAL, FILE, API, etc.) */
  getPOSConnectionType: () =>
    ipcClient.invoke<POSConnectionTypeResponse>('settings:getPOSConnectionType'),
};

// Dashboard API
export const dashboardAPI = {
  getStats: () => ipcClient.invoke<DashboardStats>('dashboard:getStats'),
  getTodaySales: () => ipcClient.invoke<TodaySalesResponse>('dashboard:getTodaySales'),
  getWeeklySales: () => ipcClient.invoke<WeeklySalesResponse>('dashboard:getWeeklySales'),
};

// Shifts API
export const shiftsAPI = {
  list: (params?: ShiftListParams) => ipcClient.invoke<ShiftListResponse>('shifts:list', params),
  getById: (shiftId: string) => ipcClient.invoke<Shift>('shifts:getById', shiftId),
  getSummary: (shiftId: string) => ipcClient.invoke<ShiftSummary>('shifts:getSummary', shiftId),
  findOpenShifts: () => ipcClient.invoke<Shift[]>('shifts:findOpenShifts'),
  close: (shiftId: string) => ipcClient.invoke<Shift>('shifts:close', shiftId),
  /** Manually start a shift (MANUAL mode only) */
  manualStart: (params: ManualStartShiftParams) =>
    ipcClient.invoke<Shift>('shifts:manualStart', params),
};

// Day Summaries API
export const daySummariesAPI = {
  list: (params?: DaySummaryListParams) =>
    ipcClient.invoke<DaySummaryListResponse>('daySummaries:list', params),
  getByDate: (date: string) =>
    ipcClient.invoke<DaySummaryWithShifts>('daySummaries:getByDate', date),
  close: (date: string) => ipcClient.invoke<DaySummary>('daySummaries:close', date),
};

// Transactions API
export const transactionsAPI = {
  list: (params?: TransactionListParams) =>
    ipcClient.invoke<TransactionListResponse>('transactions:list', params),
  getById: (transactionId: string) =>
    ipcClient.invoke<TransactionWithDetails>('transactions:getById', transactionId),
};

// Reports API
export const reportsAPI = {
  weekly: (weekStartDate: string) =>
    ipcClient.invoke<WeeklyReportResponse>('reports:weekly', weekStartDate),
  monthly: (params: { year: number; month: number }) =>
    ipcClient.invoke<MonthlyReportResponse>('reports:monthly', params),
  dateRange: (params: { startDate: string; endDate: string }) =>
    ipcClient.invoke<DateRangeReportResponse>('reports:dateRange', params),
};

// Employees API
export const employeesAPI = {
  list: () => ipcClient.invoke<EmployeeListResponse>('employees:list'),
  /** List active employees for shift selection (shift_manager+ access) */
  listActive: () => ipcClient.invoke<EmployeeListResponse>('employees:listActive'),
  create: (data: CreateEmployeeRequest) =>
    ipcClient.invoke<CreateEmployeeResponse>('employees:create', data),
  update: (data: UpdateEmployeeRequest) =>
    ipcClient.invoke<UpdateEmployeeResponse>('employees:update', data),
  updatePin: (data: UpdatePinRequest) =>
    ipcClient.invoke<UpdatePinResponse>('employees:updatePin', data),
  deactivate: (userId: string) =>
    ipcClient.invoke<ToggleStatusResponse>('employees:deactivate', { userId }),
  reactivate: (userId: string) =>
    ipcClient.invoke<ToggleStatusResponse>('employees:reactivate', { userId }),
};

// Terminals/Registers API
export const terminalsAPI = {
  /** List all registers for the configured store with their active shift status */
  list: () => ipcClient.invoke<RegisterListResponse>('terminals:list'),
  /** Get a single register by ID with its active shift status */
  getById: (registerId: string) =>
    ipcClient.invoke<RegisterWithShiftStatus>('terminals:getById', registerId),
  /** Update a register's description */
  update: (params: UpdateRegisterParams) =>
    ipcClient.invoke<RegisterResponse>('terminals:update', params),
  /**
   * Deactivate a terminal mapping in the local database
   *
   * Called after successful cloud API deletion to synchronize local state.
   * Sets the terminal's active flag to 0 (soft delete, not hard delete).
   *
   * @param terminalId - Terminal mapping ID or external register ID (UUID format)
   * @returns Promise<DeactivateTerminalResponse> with success status and message
   *
   * @security SEC-014: terminalId validated as UUID in IPC handler
   * @security DB-006: Operation scoped to configured store via IPC handler
   *
   * @example
   * ```typescript
   * const result = await terminalsAPI.deactivate(terminalId);
   * if (result.success) {
   *   // Handle success - result.message contains confirmation
   * }
   * ```
   */
  deactivate: (terminalId: string) =>
    ipcClient.invoke<DeactivateTerminalResponse>('terminals:deactivate', { terminalId }),
  /**
   * Get business day status for day close availability
   *
   * Returns authoritative day status information for UI rendering.
   * The frontend MUST use this to determine whether to show day close controls.
   *
   * BUSINESS RULE:
   * - Day Close button should ONLY be visible when hasOpenShifts === true
   * - DO NOT compute this locally; ALWAYS use this backend endpoint
   */
  getDayStatus: () => ipcClient.invoke<DayStatusResponse>('terminals:getDayStatus'),
  /**
   * Subscribe to shift closed events
   * Emitted when POS closes a shift (detected via XML file polling)
   *
   * @param callback - Function to call when a shift is closed
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * useEffect(() => {
   *   const unsubscribe = terminalsAPI.onShiftClosed((event) => {
   *     // Handle shift close - event.shiftId, event.closeType available
   *     if (event.closeType === 'DAY_CLOSE') {
   *       navigate('/day-close');
   *     }
   *   });
   *   return unsubscribe;
   * }, []);
   * ```
   */
  onShiftClosed: (callback: (event: ShiftClosedEvent) => void): (() => void) => {
    // In non-Electron environment, return no-op
    if (!isElectron) {
      return () => {};
    }
    // Use the nuvanaAPI's validated event handler (SEC-014 compliant)
    // The preload validates the payload before calling the callback
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nuvanaAPI = (window as any).nuvanaAPI;
    if (nuvanaAPI?.onShiftClosed) {
      return nuvanaAPI.onShiftClosed(callback);
    }
    // Fallback to generic electronAPI if nuvanaAPI not available
    return ipcClient.on('shift:closed', (data) => callback(data as ShiftClosedEvent));
  },
};

// Sync API
export const syncAPI = {
  getStatus: () => ipcClient.invoke<SyncStatusResponse>('sync:getStatus'),
  triggerNow: () => ipcClient.invoke<{ triggered: boolean }>('sync:triggerNow'),
  getProcessedFilesStats: () =>
    ipcClient.invoke<ProcessedFilesStatsResponse>('sync:getProcessedFilesStats'),
  clearProcessedFiles: (params?: ClearProcessedFilesParams) =>
    ipcClient.invoke<{ clearedCount: number }>('sync:clearProcessedFiles', params),
  reprocessXmlFiles: (params?: ReprocessXmlFilesParams) =>
    ipcClient.invoke<ReprocessXmlFilesResponse>('sync:reprocessXmlFiles', params),
  /** Get sync activity for dev monitor panel */
  getActivity: (params?: SyncActivityParams) =>
    ipcClient.invoke<SyncActivityResponse>('sync:getActivity', params),
  /** Get paginated sync activity for full Sync Monitor page */
  getActivityPaginated: (params?: SyncActivityPaginatedParams) =>
    ipcClient.invoke<SyncActivityPaginatedResponse>('sync:getActivityPaginated', params),
  /** Retry a specific failed sync item */
  retryItem: (id: string) => ipcClient.invoke<SyncRetryItemResponse>('sync:retryItem', { id }),
  /** Delete a specific sync item from the queue */
  deleteItem: (id: string) => ipcClient.invoke<SyncDeleteItemResponse>('sync:deleteItem', { id }),
  /** Force sync games from cloud (bypasses rate limit) */
  syncGames: () =>
    ipcClient.invoke<{ pulled: number; conflicts: number; errors: string[] }>('sync:syncGames'),
  /** Resync ACTIVE packs to cloud (when sync queue was cleared) */
  resyncActivePacks: () =>
    ipcClient.invoke<{
      message: string;
      totalActive: number;
      enqueuedCount: number;
      skippedCount: number;
    }>('sync:resyncActivePacks'),
  /** Resync DEPLETED packs to cloud (when sync queue was cleared) */
  resyncDepletedPacks: () =>
    ipcClient.invoke<{
      message: string;
      totalDepleted: number;
      enqueuedCount: number;
      skippedCount: number;
    }>('sync:resyncDepletedPacks'),
  /** Resync RETURNED packs to cloud (when sync queue was cleared) */
  resyncReturnedPacks: () =>
    ipcClient.invoke<{
      message: string;
      totalReturned: number;
      enqueuedCount: number;
      skippedCount: number;
    }>('sync:resyncReturnedPacks'),
  /** Resync ALL packs (ACTIVE, DEPLETED, RETURNED) to cloud */
  resyncAllPacks: () =>
    ipcClient.invoke<{
      message: string;
      results: {
        active: { total: number; enqueued: number; skipped: number };
        depleted: { total: number; enqueued: number; skipped: number };
        returned: { total: number; enqueued: number; skipped: number };
      };
      totalEnqueued: number;
      totalSkipped: number;
    }>('sync:resyncAllPacks'),
  /** Backfill RECEIVED packs to sync queue */
  backfillReceivedPacks: () =>
    ipcClient.invoke<{
      message: string;
      totalReceived?: number;
      enqueuedCount: number;
      alreadyQueuedCount?: number;
      skippedCount?: number;
    }>('sync:backfillReceivedPacks'),

  // ============================================================================
  // Dead Letter Queue API (v046: MQ-002 Compliance)
  // ============================================================================

  /** Get paginated Dead Letter Queue items */
  getDeadLetterItems: (params?: DeadLetterParams) =>
    ipcClient.invoke<DeadLetterListResponse>('sync:getDeadLetterItems', params),

  /** Get Dead Letter Queue statistics */
  getDeadLetterStats: () => ipcClient.invoke<DeadLetterStats>('sync:getDeadLetterStats'),

  /** Restore an item from Dead Letter Queue for retry */
  restoreFromDeadLetter: (id: string) =>
    ipcClient.invoke<DeadLetterRestoreResponse>('sync:restoreFromDeadLetter', { id }),

  /** Restore multiple items from Dead Letter Queue */
  restoreFromDeadLetterMany: (ids: string[]) =>
    ipcClient.invoke<DeadLetterRestoreManyResponse>('sync:restoreFromDeadLetterMany', { ids }),

  /** Delete an item from Dead Letter Queue permanently */
  deleteDeadLetterItem: (id: string) =>
    ipcClient.invoke<DeadLetterDeleteResponse>('sync:deleteDeadLetterItem', { id }),

  /** Cleanup old Dead Letter Queue items (default: 30 days) */
  cleanupDeadLetter: (olderThanDays?: number) =>
    ipcClient.invoke<DeadLetterCleanupResponse>('sync:cleanupDeadLetter', { olderThanDays }),

  /** Manually move an item to Dead Letter Queue */
  manualDeadLetter: (id: string, reason?: string) =>
    ipcClient.invoke<DeadLetterManualResponse>('sync:manualDeadLetter', { id, reason }),

  // ============================================================================
  // Debug & Cleanup API (for fixing stuck queue issues)
  // ============================================================================

  /** Force process auto-dead-letter for all eligible items */
  forceProcessDeadLetter: () =>
    ipcClient.invoke<{ eligible: number; deadLettered: number; message: string }>(
      'sync:forceProcessDeadLetter'
    ),

  /** Debug: Get detailed queue state breakdown */
  debugQueueState: () =>
    ipcClient.invoke<{
      byDirection: Array<{ direction: string; status: string; count: number }>;
      byErrorCategory: Array<{
        category: string;
        sync_attempts: number;
        max_attempts: number;
        count: number;
      }>;
      eligibleForDLQ: number;
      stuckItemsSample: Array<{
        id: string;
        entity_type: string;
        sync_direction: string;
        sync_attempts: number;
        max_attempts: number;
        error_category: string | null;
        last_sync_error: string | null;
        created_at: string;
      }>;
    }>('sync:debugQueueState'),

  /** Force dead-letter ALL stuck PUSH items (nuclear option) */
  forceDeadLetterAllStuck: () =>
    ipcClient.invoke<{ found: number; deadLettered: number; message: string }>(
      'sync:forceDeadLetterAllStuck'
    ),

  /** Cleanup stale PULL tracking items */
  cleanupStalePullItems: () =>
    ipcClient.invoke<{ deleted: number; message: string }>('sync:cleanupStalePullItems'),
};

// ============================================================================
// Response Type Definitions (for API usage)
// ============================================================================

// Store Types
export interface StoreInfo {
  store_id: string;
  company_id: string;
  name: string;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface StoreStatus {
  isConfigured: boolean;
  store: StoreInfo | null;
}

// Dashboard Types
export interface DashboardStats {
  todaySales: number;
  todayTransactions: number;
  openShiftCount: number;
  pendingSyncCount: number;
  storeStatus: string;
}

export interface HourlyData {
  hour: number;
  sales: number;
  transactions: number;
}

export interface TodaySalesResponse {
  hourlyBreakdown: HourlyData[];
  totalSales: number;
  totalTransactions: number;
  businessDate: string;
}

export interface DailyData {
  date: string;
  sales: number;
  transactions: number;
}

export interface WeeklySalesResponse {
  dailyData: DailyData[];
  totalSales: number;
  totalTransactions: number;
}

export interface Shift {
  shift_id: string;
  store_id: string;
  shift_number: number;
  business_date: string;
  cashier_id: string | null;
  register_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: 'OPEN' | 'CLOSED';
  created_at: string;
  updated_at: string;
}

export interface ShiftListParams {
  startDate?: string;
  endDate?: string;
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}

export interface ShiftListResponse {
  shifts: Shift[];
  total: number;
  limit: number;
  offset: number;
}

export interface DepartmentBreakdown {
  departmentCode: string;
  departmentName: string | null;
  netSales: number;
  transactionCount: number;
}

export interface TenderBreakdown {
  tenderCode: string;
  tenderDisplayName: string | null;
  netAmount: number;
  transactionCount: number;
}

export interface ShiftSummary {
  shift: Shift;
  transactionCount: number;
  totalSales: number;
  totalVoided: number;
  // Enhanced summary data from shift_summaries table
  grossSales?: number;
  netSales?: number;
  taxCollected?: number;
  fuelGallons?: number;
  fuelSales?: number;
  lotteryNet?: number;
  departmentBreakdown?: DepartmentBreakdown[];
  tenderBreakdown?: TenderBreakdown[];
}

export interface DaySummary {
  summary_id: string;
  store_id: string;
  business_date: string;
  total_sales: number;
  total_transactions: number;
  status: 'OPEN' | 'CLOSED';
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DaySummaryListParams {
  startDate?: string;
  endDate?: string;
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}

export interface DaySummaryListResponse {
  summaries: DaySummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface DaySummaryWithShifts {
  summary: DaySummary;
  shifts: Shift[];
}

export interface Transaction {
  transaction_id: string;
  store_id: string;
  shift_id: string | null;
  business_date: string;
  transaction_number: number | null;
  transaction_time: string | null;
  total_amount: number;
  voided: number;
}

export interface TransactionLineItem {
  line_item_id: string;
  line_number: number;
  item_code: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface TransactionPayment {
  payment_id: string;
  payment_type: string;
  amount: number;
}

export interface TransactionWithDetails extends Transaction {
  lineItems: TransactionLineItem[];
  payments: TransactionPayment[];
}

export interface TransactionListParams {
  startDate?: string;
  endDate?: string;
  shiftId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
}

export interface TransactionListResponse {
  transactions: Transaction[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface DailyReportData {
  date: string;
  totalSales: number;
  transactionCount: number;
  fuelSales: number;
  merchandiseSales: number;
  status: 'OPEN' | 'CLOSED' | 'NO_DATA';
}

export interface WeeklyReportResponse {
  weekStartDate: string;
  weekEndDate: string;
  dailyData: DailyReportData[];
  totals: {
    sales: number;
    transactions: number;
    fuelSales: number;
    merchandiseSales: number;
  };
}

export interface MonthlyReportResponse {
  year: number;
  month: number;
  summaries: Array<{
    date: string;
    totalSales: number;
    totalTransactions: number;
    status: 'OPEN' | 'CLOSED';
  }>;
  totals: {
    sales: number;
    transactions: number;
    closedDays: number;
    openDays: number;
  };
}

export interface DateRangeReportResponse {
  startDate: string;
  endDate: string;
  summaries: Array<{
    date: string;
    totalSales: number;
    totalTransactions: number;
    status: 'OPEN' | 'CLOSED';
  }>;
  totals: {
    sales: number;
    transactions: number;
    dayCount: number;
  };
}

// Employee Types
export type EmployeeRole = 'store_manager' | 'shift_manager' | 'cashier';

/**
 * Employee interface
 * Note: After cloud_id consolidation (v043), user_id IS the cloud user ID
 */
export interface Employee {
  user_id: string;
  store_id: string;
  role: EmployeeRole;
  name: string;
  active: number;
  last_login_at: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmployeeListResponse {
  employees: Employee[];
  total: number;
}

export interface CreateEmployeeRequest {
  name: string;
  role: 'cashier' | 'shift_manager';
  pin: string;
  confirmPin: string;
}

export interface CreateEmployeeResponse {
  employee: Employee;
}

export interface UpdateEmployeeRequest {
  userId: string;
  name?: string;
  role?: 'cashier' | 'shift_manager';
}

export interface UpdateEmployeeResponse {
  employee: Employee;
}

export interface UpdatePinRequest {
  userId: string;
  currentPin: string;
  newPin: string;
  confirmPin: string;
}

export interface UpdatePinResponse {
  success: boolean;
  message: string;
}

export interface ToggleStatusResponse {
  success: boolean;
  message: string;
}

// Sync Types
export interface SyncStatusResponse {
  isRunning: boolean;
  lastSync: string | null;
  pendingCount: number;
  failedCount: number;
}

export interface ProcessedFilesStatsResponse {
  totalFiles: number;
  successCount: number;
  failedCount: number;
  partialCount: number;
  totalRecords: number;
  totalSizeBytes: number;
  averageDurationMs: number;
  zeroRecordCount: number;
  countsByType: Record<string, number>;
}

export interface ClearProcessedFilesParams {
  zeroRecordsOnly?: boolean;
  documentType?: string;
  startDate?: string;
  endDate?: string;
}

export interface ReprocessXmlFilesParams {
  clearZeroRecordsOnly?: boolean;
  restartWatcher?: boolean;
}

export interface ReprocessXmlFilesResponse {
  clearedCount: number;
  message: string;
}

// Sync Activity Types (Development/Debug Feature)
export type SyncOperation = 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE';
export type SyncDirection = 'PUSH' | 'PULL';

/**
 * Sync activity item for UI display
 * API-008: Only safe, non-sensitive fields exposed
 * v040: Added API context fields for troubleshooting
 */
export interface SyncActivityItem {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  status: 'queued' | 'failed' | 'synced';
  sync_attempts: number;
  max_attempts: number;
  last_sync_error: string | null;
  last_attempt_at: string | null;
  created_at: string;
  synced_at: string | null;
  /** v040: Sync direction - PUSH to cloud or PULL from cloud */
  sync_direction: SyncDirection;
  /** v040: API endpoint that was called */
  api_endpoint: string | null;
  /** v040: HTTP response status code */
  http_status: number | null;
  /** v040: Truncated response body for error diagnosis */
  response_body: string | null;
  /** Parsed summary from payload - only safe display fields */
  summary: {
    pack_number?: string;
    game_code?: string;
    status?: string;
  } | null;
}

export interface SyncActivityParams {
  queuedLimit?: number;
  syncedLimit?: number;
}

export interface SyncActivityResponse {
  queued: SyncActivityItem[];
  recentlySynced: SyncActivityItem[];
  stats: {
    pendingCount: number;
    failedCount: number;
    syncedTodayCount: number;
  };
}

// Paginated Sync Activity Types (Full Sync Monitor Page)
export type SyncStatusFilter = 'all' | 'queued' | 'failed' | 'synced';

export type SyncDirectionFilter = SyncDirection | 'all';

export interface SyncActivityPaginatedParams {
  status?: SyncStatusFilter;
  entityType?: string;
  operation?: SyncOperation;
  direction?: SyncDirectionFilter;
  limit?: number;
  offset?: number;
}

export interface SyncDetailedStats {
  /** Total pending items (queued + failed) - for backward compatibility */
  pending: number;
  /** Items still being retried (sync_attempts < max_attempts) */
  queued: number;
  /** Permanently failed items (sync_attempts >= max_attempts) */
  failed: number;
  syncedToday: number;
  syncedTotal: number;
  oldestPending: string | null;
  newestSync: string | null;
  byEntityType: Array<{
    entity_type: string;
    pending: number;
    queued: number;
    failed: number;
    synced: number;
  }>;
  byOperation: Array<{
    operation: string;
    pending: number;
    queued: number;
    failed: number;
    synced: number;
  }>;
  /** Breakdown by sync direction (PUSH to cloud, PULL from cloud) */
  byDirection: Array<{
    direction: SyncDirection;
    pending: number;
    queued: number;
    failed: number;
    synced: number;
    syncedToday: number;
  }>;
}

export interface SyncActivityPaginatedResponse {
  items: SyncActivityItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  stats: SyncDetailedStats;
}

export interface SyncRetryItemResponse {
  success: boolean;
  retriedId: string;
}

export interface SyncDeleteItemResponse {
  success: boolean;
  deletedId: string;
}

// Terminal/Register Types
export interface RegisterWithShiftStatus {
  /** Internal terminal mapping ID */
  id: string;
  /** External register ID from POS system */
  external_register_id: string;
  /** Terminal type (always REGISTER for this endpoint) */
  terminal_type: string;
  /** User-friendly description/name */
  description: string | null;
  /** Whether the register is active */
  active: boolean;
  /** Currently open shift on this register, if any */
  activeShift: Shift | null;
  /** Count of open shifts for this register */
  openShiftCount: number;
  /** When this register was first identified */
  created_at: string;
  /** When this register was last updated */
  updated_at: string;
}

export interface RegisterListResponse {
  registers: RegisterWithShiftStatus[];
  total: number;
}

export interface UpdateRegisterParams {
  registerId: string;
  description?: string;
}

export interface RegisterResponse {
  id: string;
  external_register_id: string;
  terminal_type: string;
  description: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Response for terminal deactivation operation
 * Returned by terminals:deactivate IPC handler after local database update
 *
 * Used to synchronize local state after cloud terminal deletion.
 * Success indicates the terminal was found and deactivated (or was already inactive).
 * Failure indicates the terminal was not found in the local database.
 */
export interface DeactivateTerminalResponse {
  /** Whether the deactivation was successful */
  success: boolean;
  /** The terminal ID that was processed */
  terminalId: string;
  /** Human-readable result message */
  message: string;
}

/**
 * Day status response for determining day close availability
 *
 * This is the authoritative source for UI rendering decisions
 * related to day close functionality. The frontend MUST use this
 * backend-provided status rather than computing it locally.
 *
 * BUSINESS RULE:
 * - Day Close button should ONLY be visible when hasOpenShifts === true
 */
export interface DayStatusResponse {
  /** Whether any shifts exist for this date (day has started) */
  dayStarted: boolean;
  /** Whether there are open shifts (day close is available) */
  hasOpenShifts: boolean;
  /** Count of currently open shifts */
  openShiftCount: number;
  /** Total shift count for the business date */
  totalShiftCount: number;
  /** Business date checked (YYYY-MM-DD) */
  businessDate: string;
}

// ============================================================================
// Shift Close Event Types (SEC-014 compliant)
// ============================================================================

/**
 * Type of shift close operation
 * - SHIFT_CLOSE: Other registers still have open shifts
 * - DAY_CLOSE: This is the last shift of the business day
 */
export type ShiftCloseType = 'SHIFT_CLOSE' | 'DAY_CLOSE';

/**
 * POS Connection Type
 * Determines how the store connects to POS system
 * - MANUAL: No automated connection, user enters data manually
 */
export type POSConnectionType = 'NETWORK' | 'API' | 'WEBHOOK' | 'FILE' | 'MANUAL';

/**
 * POS System Type
 * SEC-014: Strict allowlist validation
 *
 * Identifies the POS system for protocol-specific handling.
 * Must match POSSystemTypeSchema from src/shared/types/config.types.ts
 */
export type POSSystemType =
  | 'GILBARCO_PASSPORT'
  | 'GILBARCO_NAXML'
  | 'VERIFONE_RUBY2'
  | 'VERIFONE_COMMANDER'
  | 'SQUARE_REST'
  | 'CLOVER_REST'
  | 'NCR_RADIANT'
  | 'INFOR_POS'
  | 'ORACLE_SIMPHONY'
  | 'CUSTOM_API'
  | 'FILE_BASED'
  | 'MANUAL'
  | 'MANUAL_ENTRY'
  | 'LOTTERY'
  | 'UNKNOWN';

/**
 * Response from getPOSConnectionType
 * Returns both connection method and POS system type for UI mode detection
 */
export interface POSConnectionTypeResponse {
  connectionType: POSConnectionType | null;
  posType: POSSystemType | null;
}

/**
 * Parameters for manually starting a shift
 * SEC-001: Employee identified by unique PIN
 */
export interface ManualStartShiftParams {
  /** Cashier PIN for authentication (4-6 digits) - uniquely identifies the employee */
  pin: string;
  /** External register ID (e.g., "1", "2") */
  externalRegisterId: string;
  /** Business date in YYYY-MM-DD format (defaults to today) */
  businessDate?: string;
  /** Start time as ISO timestamp (defaults to now) */
  startTime?: string;
}

/**
 * Payload emitted when a shift is closed via POS XML detection
 * Used for real-time notifications on the Terminals page
 */
export interface ShiftClosedEvent {
  /** Type of close - determines which wizard to route to */
  closeType: ShiftCloseType;
  /** The shift that was just closed */
  shiftId: string;
  /** Business date of the closed shift (YYYY-MM-DD) */
  businessDate: string;
  /** External register ID from POS system */
  externalRegisterId?: string;
  /** External cashier ID from POS system */
  externalCashierId?: string;
  /** Shift number within the day */
  shiftNumber: number;
  /** ISO timestamp when the shift was closed */
  closedAt: string;
  /** True if this was the last open shift for the business day */
  isLastShiftOfDay: boolean;
  /** Count of shifts still open after this close (0 for day close) */
  remainingOpenShifts: number;
}

// ============================================================================
// Dead Letter Queue Types (v046: MQ-002 Compliance)
// ============================================================================

/**
 * Error category for sync queue items
 * Used to determine retry behavior
 */
export type DeadLetterErrorCategory = 'TRANSIENT' | 'PERMANENT' | 'STRUCTURAL' | 'UNKNOWN';

/**
 * Reason for dead-lettering an item
 */
export type DeadLetterReason =
  | 'MAX_ATTEMPTS_EXCEEDED'
  | 'PERMANENT_ERROR'
  | 'STRUCTURAL_FAILURE'
  | 'MANUAL';

/**
 * Dead Letter Queue item for display
 * API-008: Only safe display fields exposed
 */
export interface DeadLetterItem {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperation;
  sync_direction: SyncDirection;
  sync_attempts: number;
  max_attempts: number;
  last_sync_error: string | null;
  dead_letter_reason: DeadLetterReason;
  error_category: DeadLetterErrorCategory | null;
  dead_lettered_at: string;
  created_at: string;
  api_endpoint: string | null;
  http_status: number | null;
  response_body: string | null;
  /** Parsed summary from payload - only safe display fields */
  summary: {
    pack_number?: string;
    game_code?: string;
    status?: string;
  } | null;
}

/**
 * Dead Letter Queue statistics
 */
export interface DeadLetterStats {
  total: number;
  byReason: {
    MAX_ATTEMPTS_EXCEEDED: number;
    PERMANENT_ERROR: number;
    STRUCTURAL_FAILURE: number;
    MANUAL: number;
  };
  byEntityType: Array<{
    entity_type: string;
    count: number;
  }>;
  byErrorCategory: Array<{
    error_category: DeadLetterErrorCategory | null;
    count: number;
  }>;
  oldest: string | null;
  newest: string | null;
}

/**
 * Paginated Dead Letter Queue response
 */
export interface DeadLetterListResponse {
  items: DeadLetterItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * Parameters for Dead Letter Queue queries
 */
export interface DeadLetterParams {
  limit?: number;
  offset?: number;
}

/**
 * Response for restore operations
 */
export interface DeadLetterRestoreResponse {
  restored: boolean;
  id: string;
}

/**
 * Response for batch restore operations
 */
export interface DeadLetterRestoreManyResponse {
  requested: number;
  restored: number;
}

/**
 * Response for delete operations
 */
export interface DeadLetterDeleteResponse {
  deleted: boolean;
  id: string;
}

/**
 * Response for manual dead-letter operation
 */
export interface DeadLetterManualResponse {
  deadLettered: boolean;
  id: string;
}

/**
 * Response for cleanup operation
 */
export interface DeadLetterCleanupResponse {
  deletedCount: number;
  cutoffDate: string;
}
