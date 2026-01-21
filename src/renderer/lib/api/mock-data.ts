/**
 * Mock Data for Development
 *
 * Provides sample data for running the dashboard in browser dev mode
 * without Electron. This allows UI development and testing.
 *
 * @module renderer/lib/api/mock-data
 */

import type {
  DashboardStats,
  TodaySalesResponse,
  WeeklySalesResponse,
  ShiftListResponse,
  Shift,
  ShiftSummary,
  DaySummaryListResponse,
  DaySummary,
  DaySummaryWithShifts,
  TransactionListResponse,
  Transaction,
  TransactionWithDetails,
  WeeklyReportResponse,
  MonthlyReportResponse,
  DateRangeReportResponse,
} from './ipc-client';

// ============================================================================
// Helper Functions
// ============================================================================

function getDateString(daysAgo: number = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

function randomAmount(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

// ============================================================================
// Store Mock Data
// ============================================================================

export interface MockStoreInfo {
  store_id: string;
  company_id: string;
  name: string;
  timezone: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface MockStoreStatus {
  isConfigured: boolean;
  store: MockStoreInfo | null;
}

export const mockStoreInfo: MockStoreInfo = {
  store_id: 'store-1',
  company_id: 'company-1',
  name: 'Development Store',
  timezone: 'America/Denver',
  status: 'ACTIVE',
};

export const mockStoreStatus: MockStoreStatus = {
  isConfigured: true,
  store: mockStoreInfo,
};

export function getMockStoreInfo(): MockStoreInfo {
  return mockStoreInfo;
}

export function getMockStoreStatus(): MockStoreStatus {
  return mockStoreStatus;
}

export function getMockIsConfigured(): boolean {
  return true;
}

// ============================================================================
// Dashboard Mock Data
// ============================================================================

export const mockDashboardStats: DashboardStats = {
  todaySales: 2456.78,
  todayTransactions: 47,
  openShiftCount: 1,
  pendingSyncCount: 3,
  storeStatus: 'ACTIVE',
};

export const mockTodaySales: TodaySalesResponse = {
  businessDate: getDateString(),
  totalSales: 2456.78,
  totalTransactions: 47,
  hourlyBreakdown: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    sales: hour >= 6 && hour <= 22 ? randomAmount(50, 300) : 0,
    transactions: hour >= 6 && hour <= 22 ? Math.floor(Math.random() * 10) + 1 : 0,
  })),
};

export const mockWeeklySales: WeeklySalesResponse = {
  totalSales: 15234.56,
  totalTransactions: 312,
  dailyData: Array.from({ length: 7 }, (_, i) => ({
    date: getDateString(6 - i),
    sales: randomAmount(1500, 3000),
    transactions: Math.floor(Math.random() * 50) + 30,
  })),
};

// ============================================================================
// Shifts Mock Data
// ============================================================================

const mockShifts: Shift[] = Array.from({ length: 20 }, (_, i) => ({
  shift_id: `shift-${i + 1}`,
  store_id: 'store-1',
  shift_number: i + 1,
  business_date: getDateString(Math.floor(i / 3)),
  cashier_id: `cashier-${(i % 3) + 1}`,
  register_id: `reg-${(i % 2) + 1}`,
  start_time: new Date(Date.now() - (i * 8 + 6) * 3600000).toISOString(),
  end_time: i > 2 ? new Date(Date.now() - i * 8 * 3600000).toISOString() : null,
  status: i > 2 ? 'CLOSED' : 'OPEN',
  created_at: new Date(Date.now() - (i * 8 + 6) * 3600000).toISOString(),
  updated_at: new Date(Date.now() - i * 8 * 3600000).toISOString(),
}));

export function getMockShiftList(params?: {
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}): ShiftListResponse {
  let filtered = [...mockShifts];

  if (params?.status) {
    filtered = filtered.filter((s) => s.status === params.status);
  }

  const offset = params?.offset || 0;
  const limit = params?.limit || 20;
  const shifts = filtered.slice(offset, offset + limit);

  return {
    shifts,
    total: filtered.length,
    limit,
    offset,
  };
}

export function getMockShiftById(shiftId: string): Shift | undefined {
  return mockShifts.find((s) => s.shift_id === shiftId);
}

export function getMockShiftSummary(shiftId: string): ShiftSummary | undefined {
  const shift = getMockShiftById(shiftId);
  if (!shift) {
    return undefined;
  }

  const netSales = randomAmount(500, 2000);
  const grossSales = netSales * 1.08; // Add ~8% for tax
  const taxCollected = grossSales - netSales;
  const fuelGallons = randomAmount(200, 800);
  const fuelSales = fuelGallons * 3.25; // ~$3.25/gallon

  const result: ShiftSummary = {
    shift,
    transactionCount: Math.floor(Math.random() * 30) + 10,
    totalSales: netSales,
    totalVoided: randomAmount(0, 50),
    // Enhanced summary data
    grossSales,
    netSales,
    taxCollected,
    fuelGallons,
    fuelSales,
    lotteryNet: randomAmount(-50, 150),
    departmentBreakdown: [
      {
        departmentCode: '001',
        departmentName: 'Tobacco',
        netSales: randomAmount(100, 400),
        transactionCount: Math.floor(Math.random() * 15) + 5,
      },
      {
        departmentCode: '002',
        departmentName: 'Beverages',
        netSales: randomAmount(80, 300),
        transactionCount: Math.floor(Math.random() * 20) + 10,
      },
      {
        departmentCode: '003',
        departmentName: 'Snacks',
        netSales: randomAmount(50, 200),
        transactionCount: Math.floor(Math.random() * 25) + 8,
      },
      {
        departmentCode: '004',
        departmentName: 'Grocery',
        netSales: randomAmount(30, 150),
        transactionCount: Math.floor(Math.random() * 10) + 3,
      },
    ],
    tenderBreakdown: [
      {
        tenderCode: 'CASH',
        tenderDisplayName: 'Cash',
        netAmount: randomAmount(200, 600),
        transactionCount: Math.floor(Math.random() * 15) + 5,
      },
      {
        tenderCode: 'CREDIT',
        tenderDisplayName: 'Credit Card',
        netAmount: randomAmount(300, 900),
        transactionCount: Math.floor(Math.random() * 20) + 10,
      },
      {
        tenderCode: 'DEBIT',
        tenderDisplayName: 'Debit Card',
        netAmount: randomAmount(100, 400),
        transactionCount: Math.floor(Math.random() * 12) + 4,
      },
    ],
  };

  return result;
}

export function getMockOpenShifts(): Shift[] {
  return mockShifts.filter((s) => s.status === 'OPEN');
}

// ============================================================================
// Day Summaries Mock Data
// ============================================================================

const mockDaySummaries: DaySummary[] = Array.from({ length: 30 }, (_, i) => ({
  summary_id: `summary-${i + 1}`,
  store_id: 'store-1',
  business_date: getDateString(i),
  total_sales: randomAmount(1500, 3000),
  total_transactions: Math.floor(Math.random() * 50) + 30,
  status: i > 0 ? 'CLOSED' : 'OPEN',
  closed_at: i > 0 ? new Date(Date.now() - i * 86400000).toISOString() : null,
  created_at: new Date(Date.now() - i * 86400000).toISOString(),
  updated_at: new Date(Date.now() - i * 86400000).toISOString(),
}));

export function getMockDaySummaryList(params?: {
  status?: 'OPEN' | 'CLOSED';
  limit?: number;
  offset?: number;
}): DaySummaryListResponse {
  let filtered = [...mockDaySummaries];

  if (params?.status) {
    filtered = filtered.filter((s) => s.status === params.status);
  }

  const offset = params?.offset || 0;
  const limit = params?.limit || 30;
  const summaries = filtered.slice(offset, offset + limit);

  return {
    summaries,
    total: filtered.length,
    limit,
    offset,
  };
}

export function getMockDaySummaryByDate(date: string): DaySummaryWithShifts | undefined {
  const summary = mockDaySummaries.find((s) => s.business_date === date);
  if (!summary) return undefined;

  const shifts = mockShifts.filter((s) => s.business_date === date);

  return { summary, shifts };
}

// ============================================================================
// Transactions Mock Data
// ============================================================================

const mockTransactions: Transaction[] = Array.from({ length: 100 }, (_, i) => ({
  transaction_id: `txn-${i + 1}`,
  store_id: 'store-1',
  shift_id: `shift-${Math.floor(i / 5) + 1}`,
  business_date: getDateString(Math.floor(i / 20)),
  transaction_number: i + 1001,
  transaction_time: new Date(Date.now() - i * 1800000).toISOString(),
  total_amount: randomAmount(5, 150),
  voided: i % 15 === 0 ? 1 : 0,
}));

export function getMockTransactionList(params?: {
  limit?: number;
  offset?: number;
}): TransactionListResponse {
  const offset = params?.offset || 0;
  const limit = params?.limit || 50;
  const transactions = mockTransactions.slice(offset, offset + limit);

  return {
    transactions,
    total: mockTransactions.length,
    limit,
    offset,
    hasMore: offset + limit < mockTransactions.length,
  };
}

export function getMockTransactionById(transactionId: string): TransactionWithDetails | undefined {
  const transaction = mockTransactions.find((t) => t.transaction_id === transactionId);
  if (!transaction) return undefined;

  return {
    ...transaction,
    lineItems: Array.from({ length: Math.floor(Math.random() * 5) + 1 }, (_, i) => ({
      line_item_id: `item-${i + 1}`,
      line_number: i + 1,
      item_code: `SKU-${Math.floor(Math.random() * 1000)}`,
      description: ['Coffee', 'Chips', 'Candy', 'Soda', 'Lottery Ticket'][i % 5],
      quantity: Math.floor(Math.random() * 3) + 1,
      unit_price: randomAmount(1, 10),
      total_price: randomAmount(1, 30),
    })),
    payments: [
      {
        payment_id: 'pay-1',
        payment_type: ['CASH', 'CREDIT', 'DEBIT'][Math.floor(Math.random() * 3)],
        amount: transaction.total_amount,
      },
    ],
  };
}

// ============================================================================
// Reports Mock Data
// ============================================================================

export function getMockWeeklyReport(weekStartDate: string): WeeklyReportResponse {
  const startDate = new Date(weekStartDate);

  return {
    weekStartDate,
    weekEndDate: new Date(startDate.getTime() + 6 * 86400000).toISOString().split('T')[0],
    dailyData: Array.from({ length: 7 }, (_, i) => {
      const date = new Date(startDate.getTime() + i * 86400000);
      return {
        date: date.toISOString().split('T')[0],
        totalSales: randomAmount(1500, 3000),
        transactionCount: Math.floor(Math.random() * 50) + 30,
        fuelSales: randomAmount(800, 1500),
        merchandiseSales: randomAmount(500, 1200),
        status: 'CLOSED' as const,
      };
    }),
    totals: {
      sales: randomAmount(12000, 20000),
      transactions: Math.floor(Math.random() * 300) + 200,
      fuelSales: randomAmount(6000, 10000),
      merchandiseSales: randomAmount(4000, 8000),
    },
  };
}

export function getMockMonthlyReport(params: {
  year: number;
  month: number;
}): MonthlyReportResponse {
  const daysInMonth = new Date(params.year, params.month, 0).getDate();

  return {
    year: params.year,
    month: params.month,
    summaries: Array.from({ length: daysInMonth }, (_, i) => ({
      date: `${params.year}-${String(params.month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`,
      totalSales: randomAmount(1500, 3000),
      totalTransactions: Math.floor(Math.random() * 50) + 30,
      status: 'CLOSED' as const,
    })),
    totals: {
      sales: randomAmount(50000, 80000),
      transactions: Math.floor(Math.random() * 1500) + 1000,
      closedDays: daysInMonth - 1,
      openDays: 1,
    },
  };
}

export function getMockDateRangeReport(params: {
  startDate: string;
  endDate: string;
}): DateRangeReportResponse {
  const start = new Date(params.startDate);
  const end = new Date(params.endDate);
  const dayCount = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;

  return {
    startDate: params.startDate,
    endDate: params.endDate,
    summaries: Array.from({ length: dayCount }, (_, i) => {
      const date = new Date(start.getTime() + i * 86400000);
      return {
        date: date.toISOString().split('T')[0],
        totalSales: randomAmount(1500, 3000),
        totalTransactions: Math.floor(Math.random() * 50) + 30,
        status: 'CLOSED' as const,
      };
    }),
    totals: {
      sales: randomAmount(dayCount * 1500, dayCount * 3000),
      transactions: Math.floor(Math.random() * dayCount * 50) + dayCount * 30,
      dayCount,
    },
  };
}

// ============================================================================
// Lottery Mock Data
// ============================================================================

export interface MockLotteryGame {
  game_id: string;
  game_code: string;
  name: string;
  price: number | null;
  tickets_per_pack: number;
  pack_value: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Mock lottery bin (cloud-aligned schema v039)
 */
export interface MockLotteryBin {
  bin_id: string;
  store_id: string;
  name: string;
  location: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  pack_id?: string | null;
  pack_number?: string | null;
  game_name?: string | null;
  game_price?: number | null;
}

export interface MockLotteryPack {
  pack_id: string;
  game_id: string;
  pack_number: string;
  opening_serial: string | null;
  closing_serial: string | null;
  status: 'RECEIVED' | 'ACTIVE' | 'DEPLETED' | 'RETURNED';
  store_id: string;
  bin_id: string | null;
  received_at: string;
  activated_at: string | null;
  depleted_at: string | null;
  returned_at: string | null;
  game?: {
    game_id: string;
    game_code: string;
    name: string;
    price: number | null;
    tickets_per_pack: number;
  };
  bin?: {
    bin_id: string;
    name: string;
    display_order: number;
  } | null;
}

const mockLotteryGames: MockLotteryGame[] = [
  {
    game_id: 'game-1',
    game_code: '1001',
    name: 'Lucky 7s',
    price: 1,
    tickets_per_pack: 300,
    pack_value: 300,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    game_id: 'game-2',
    game_code: '1002',
    name: 'Cash Explosion',
    price: 2,
    tickets_per_pack: 150,
    pack_value: 300,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    game_id: 'game-3',
    game_code: '1003',
    name: 'Diamond Deluxe',
    price: 5,
    tickets_per_pack: 60,
    pack_value: 300,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    game_id: 'game-4',
    game_code: '1004',
    name: 'Mega Millions',
    price: 10,
    tickets_per_pack: 30,
    pack_value: 300,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    game_id: 'game-5',
    game_code: '1005',
    name: 'Golden Jackpot',
    price: 20,
    tickets_per_pack: 15,
    pack_value: 300,
    status: 'ACTIVE',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockLotteryBins: MockLotteryBin[] = Array.from({ length: 10 }, (_, i) => ({
  bin_id: `bin-${i + 1}`,
  store_id: 'store-1',
  name: `Bin ${i + 1}`,
  location: null,
  display_order: i + 1,
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  pack_id: i < 5 ? `pack-${i + 1}` : null,
  pack_number: i < 5 ? `PKG${(1234567 + i).toString()}` : null,
  game_name: i < 5 ? mockLotteryGames[i % mockLotteryGames.length].name : null,
  game_price: i < 5 ? mockLotteryGames[i % mockLotteryGames.length].price : null,
}));

const mockLotteryPacks: MockLotteryPack[] = Array.from({ length: 15 }, (_, i) => {
  const gameIndex = i % mockLotteryGames.length;
  const game = mockLotteryGames[gameIndex];
  const status = i < 5 ? 'ACTIVE' : i < 10 ? 'RECEIVED' : 'DEPLETED';
  const binId = i < 5 ? `bin-${i + 1}` : null;

  return {
    pack_id: `pack-${i + 1}`,
    game_id: game.game_id,
    pack_number: `PKG${(1234567 + i).toString()}`,
    opening_serial: status !== 'RECEIVED' ? '000' : null,
    closing_serial: status === 'DEPLETED' ? '299' : null,
    status: status as 'RECEIVED' | 'ACTIVE' | 'DEPLETED' | 'RETURNED',
    store_id: 'store-1',
    bin_id: binId,
    received_at: new Date(Date.now() - (15 - i) * 86400000).toISOString(),
    activated_at:
      status !== 'RECEIVED' ? new Date(Date.now() - (10 - i) * 86400000).toISOString() : null,
    depleted_at:
      status === 'DEPLETED' ? new Date(Date.now() - (5 - i) * 86400000).toISOString() : null,
    returned_at: null,
    game: {
      game_id: game.game_id,
      game_code: game.game_code,
      name: game.name,
      price: game.price,
      tickets_per_pack: game.tickets_per_pack,
    },
    bin: binId
      ? {
          bin_id: binId,
          name: `Bin ${i + 1}`,
          display_order: i + 1,
        }
      : null,
  };
});

export function getMockLotteryGames(): MockLotteryGame[] {
  return mockLotteryGames;
}

export function getMockLotteryBins(): MockLotteryBin[] {
  return mockLotteryBins;
}

export function getMockLotteryPacks(filters?: {
  status?: string;
  game_id?: string;
}): MockLotteryPack[] {
  let filtered = [...mockLotteryPacks];

  if (filters?.status) {
    filtered = filtered.filter((p) => p.status === filters.status);
  }
  if (filters?.game_id) {
    filtered = filtered.filter((p) => p.game_id === filters.game_id);
  }

  return filtered;
}

export function getMockParsedBarcode(raw: string): {
  raw: string;
  game_code: string;
  pack_number: string;
  serial_number: string;
  check_digit: string;
  checksum_valid: boolean;
  full_serial: string;
} | null {
  // Validate format: 24 digits
  const cleaned = raw.replace(/[\s-]/g, '');
  if (cleaned.length !== 24 || !/^\d+$/.test(cleaned)) {
    return null;
  }

  return {
    raw: cleaned,
    game_code: cleaned.substring(0, 4),
    pack_number: cleaned.substring(4, 11),
    serial_number: cleaned.substring(11, 14),
    check_digit: cleaned.substring(14, 24),
    checksum_valid: true,
    full_serial: cleaned.substring(0, 11),
  };
}

// ============================================================================
// Employee Mock Data
// ============================================================================

export interface MockEmployee {
  user_id: string;
  store_id: string;
  role: 'store_manager' | 'shift_manager' | 'cashier';
  name: string;
  active: number;
  last_login_at: string | null;
  cloud_user_id: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export const mockEmployees: MockEmployee[] = [
  {
    user_id: 'user-1',
    store_id: 'store-1',
    role: 'store_manager',
    name: 'John Manager',
    active: 1,
    last_login_at: new Date().toISOString(),
    cloud_user_id: null,
    synced_at: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
  {
    user_id: 'user-2',
    store_id: 'store-1',
    role: 'shift_manager',
    name: 'Sarah Shift',
    active: 1,
    last_login_at: '2024-06-15T08:30:00.000Z',
    cloud_user_id: null,
    synced_at: null,
    created_at: '2024-02-01T00:00:00.000Z',
    updated_at: '2024-02-01T00:00:00.000Z',
  },
  {
    user_id: 'user-3',
    store_id: 'store-1',
    role: 'cashier',
    name: 'Mike Cashier',
    active: 1,
    last_login_at: '2024-06-14T14:20:00.000Z',
    cloud_user_id: null,
    synced_at: null,
    created_at: '2024-03-01T00:00:00.000Z',
    updated_at: '2024-03-01T00:00:00.000Z',
  },
  {
    user_id: 'user-4',
    store_id: 'store-1',
    role: 'cashier',
    name: 'Emily Register',
    active: 1,
    last_login_at: null,
    cloud_user_id: null,
    synced_at: null,
    created_at: '2024-04-01T00:00:00.000Z',
    updated_at: '2024-04-01T00:00:00.000Z',
  },
  {
    user_id: 'user-5',
    store_id: 'store-1',
    role: 'cashier',
    name: 'Tom Inactive',
    active: 0,
    last_login_at: '2024-05-01T10:00:00.000Z',
    cloud_user_id: null,
    synced_at: null,
    created_at: '2024-01-15T00:00:00.000Z',
    updated_at: '2024-05-15T00:00:00.000Z',
  },
];

export function getMockEmployees(): { employees: MockEmployee[]; total: number } {
  return {
    employees: mockEmployees,
    total: mockEmployees.length,
  };
}

// ============================================================================
// Mock Register/Terminal Data
// ============================================================================

interface MockRegister {
  id: string;
  external_register_id: string;
  terminal_type: string;
  description: string | null;
  active: boolean;
  activeShift: Shift | null;
  openShiftCount: number;
  created_at: string;
  updated_at: string;
}

/**
 * Mock registers representing terminals identified during onboarding.
 * Each register shows its active shift status.
 */
const mockRegisters: MockRegister[] = [
  {
    id: 'reg-uuid-1',
    external_register_id: '1',
    terminal_type: 'REGISTER',
    description: 'Main Register',
    active: true,
    // This register has an active shift
    activeShift: {
      shift_id: 'shift-1',
      store_id: 'store-1',
      shift_number: 1,
      business_date: new Date().toISOString().split('T')[0],
      cashier_id: 'user-1',
      register_id: '1',
      start_time: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      end_time: null,
      status: 'OPEN' as const,
      created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    },
    openShiftCount: 1,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'reg-uuid-2',
    external_register_id: '2',
    terminal_type: 'REGISTER',
    description: 'Secondary Register',
    active: true,
    // This register has no active shift
    activeShift: null,
    openShiftCount: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'reg-uuid-3',
    external_register_id: '3',
    terminal_type: 'REGISTER',
    description: 'Back Office Register',
    active: true,
    // This register also has no active shift
    activeShift: null,
    openShiftCount: 0,
    created_at: '2024-01-15T00:00:00.000Z',
    updated_at: '2024-01-15T00:00:00.000Z',
  },
];

export function getMockRegisters(): { registers: MockRegister[]; total: number } {
  return {
    registers: mockRegisters,
    total: mockRegisters.length,
  };
}
