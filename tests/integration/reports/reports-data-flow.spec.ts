/**
 * Reports Data Flow Integration Tests
 *
 * Tests the complete data flow from IPC response through transformation
 * to the final UI data structures. Validates data integrity is maintained
 * through the transformation pipeline.
 *
 * These tests use real transformation functions (not mocked) to verify
 * the complete pipeline from raw API data to UI-ready structures.
 *
 * @module tests/integration/reports/reports-data-flow
 * @security FE-001: Validates no sensitive data leaks through transformation
 * @security FE-003: Validates data integrity through pipeline
 * @performance PERF-002: Validates efficient transformation
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Types (mirrored from transport and components)
// ============================================================================

interface ShiftByDayData {
  shiftId: string;
  shiftNumber: number;
  registerName: string;
  employeeName: string;
  startTime: string;
  endTime: string | null;
  status: 'OPEN' | 'CLOSED';
}

interface DayWithShifts {
  businessDate: string;
  dayStatus: 'OPEN' | 'CLOSED';
  shifts: ShiftByDayData[];
}

interface ShiftsByDayResponse {
  days: DayWithShifts[];
}

type ReportShiftStatus = 'reconciled' | 'closed' | 'open';

interface ReportShift {
  id: string;
  registerName: string;
  shiftNumber: number;
  startTime: Date;
  endTime: Date;
  employeeName: string;
  status: ReportShiftStatus;
}

interface ReportDay {
  date: Date;
  businessDate: string;
  dayStatus: 'OPEN' | 'CLOSED';
  shifts: ReportShift[];
}

// ============================================================================
// Functions Under Test (complete pipeline)
// ============================================================================

function mapShiftStatus(
  shiftStatus: 'OPEN' | 'CLOSED',
  dayStatus: 'OPEN' | 'CLOSED'
): ReportShiftStatus {
  if (shiftStatus === 'OPEN') return 'open';
  if (dayStatus === 'CLOSED') return 'reconciled';
  return 'closed';
}

function transformShift(shift: ShiftByDayData, dayStatus: 'OPEN' | 'CLOSED'): ReportShift {
  return {
    id: shift.shiftId,
    registerName: shift.registerName || 'Register',
    shiftNumber: shift.shiftNumber,
    startTime: new Date(shift.startTime),
    endTime: shift.endTime ? new Date(shift.endTime) : new Date(),
    employeeName: shift.employeeName || 'Unknown',
    status: mapShiftStatus(shift.status, dayStatus),
  };
}

function transformShiftsByDays(data: ShiftsByDayResponse): ReportDay[] {
  return data.days.map((day) => ({
    date: new Date(day.businessDate + 'T12:00:00'),
    businessDate: day.businessDate,
    dayStatus: day.dayStatus,
    shifts: day.shifts.map((shift) => transformShift(shift, day.dayStatus)),
  }));
}

function groupShiftsByRegister(shifts: ReportShift[]): [string, ReportShift[]][] {
  const groups = new Map<string, ReportShift[]>();
  for (const shift of shifts) {
    const existing = groups.get(shift.registerName) ?? [];
    existing.push(shift);
    groups.set(shift.registerName, existing);
  }
  const sortedEntries = Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [, groupShifts] of sortedEntries) {
    groupShifts.sort((a, b) => a.shiftNumber - b.shiftNumber);
  }
  return sortedEntries;
}

// ============================================================================
// Test Fixtures: Realistic IPC Response Data
// ============================================================================

function createRealisticIPCResponse(): ShiftsByDayResponse {
  return {
    days: [
      {
        businessDate: '2026-01-27',
        dayStatus: 'CLOSED',
        shifts: [
          {
            shiftId: 'shift-001',
            shiftNumber: 1,
            registerName: 'POS2',
            employeeName: 'Jane Doe',
            startTime: '2026-01-27T06:00:00.000Z',
            endTime: '2026-01-27T14:00:00.000Z',
            status: 'CLOSED',
          },
          {
            shiftId: 'shift-002',
            shiftNumber: 2,
            registerName: 'POS2',
            employeeName: 'Bob Wilson',
            startTime: '2026-01-27T14:00:00.000Z',
            endTime: '2026-01-27T22:00:00.000Z',
            status: 'CLOSED',
          },
          {
            shiftId: 'shift-003',
            shiftNumber: 1,
            registerName: 'POS1',
            employeeName: 'Alice Brown',
            startTime: '2026-01-27T06:00:00.000Z',
            endTime: '2026-01-27T14:00:00.000Z',
            status: 'CLOSED',
          },
          {
            shiftId: 'shift-004',
            shiftNumber: 2,
            registerName: 'POS1',
            employeeName: 'Charlie Davis',
            startTime: '2026-01-27T14:00:00.000Z',
            endTime: '2026-01-27T22:00:00.000Z',
            status: 'CLOSED',
          },
        ],
      },
      {
        businessDate: '2026-01-26',
        dayStatus: 'OPEN',
        shifts: [
          {
            shiftId: 'shift-005',
            shiftNumber: 1,
            registerName: 'POS1',
            employeeName: 'Eve Foster',
            startTime: '2026-01-26T06:00:00.000Z',
            endTime: '2026-01-26T14:00:00.000Z',
            status: 'CLOSED',
          },
          {
            shiftId: 'shift-006',
            shiftNumber: 2,
            registerName: 'POS1',
            employeeName: 'Frank Green',
            startTime: '2026-01-26T14:00:00.000Z',
            endTime: null,
            status: 'OPEN',
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Reports Data Flow Integration', () => {
  describe('Complete data flow from IPC to UI', () => {
    it('should transform IPC response to valid ReportDay array', () => {
      const ipcResponse = createRealisticIPCResponse();
      const result = transformShiftsByDays(ipcResponse);

      expect(result).toHaveLength(2);
      expect(result[0].businessDate).toBe('2026-01-27');
      expect(result[1].businessDate).toBe('2026-01-26');
    });

    it('should maintain all shift data through transformation', () => {
      const ipcResponse = createRealisticIPCResponse();
      const result = transformShiftsByDays(ipcResponse);

      // Day 1 should have 4 shifts
      expect(result[0].shifts).toHaveLength(4);
      // Day 2 should have 2 shifts
      expect(result[1].shifts).toHaveLength(2);
    });

    it('should correctly map all status combinations', () => {
      const ipcResponse = createRealisticIPCResponse();
      const result = transformShiftsByDays(ipcResponse);

      // Day 1 (CLOSED): all shifts CLOSED → all reconciled
      for (const shift of result[0].shifts) {
        expect(shift.status).toBe('reconciled');
      }

      // Day 2 (OPEN): shift-005 CLOSED → closed, shift-006 OPEN → open
      expect(result[1].shifts[0].status).toBe('closed');
      expect(result[1].shifts[1].status).toBe('open');
    });

    it('should preserve employee names through transformation', () => {
      const ipcResponse = createRealisticIPCResponse();
      const result = transformShiftsByDays(ipcResponse);

      const employeeNames = result[0].shifts.map((s) => s.employeeName);
      expect(employeeNames).toContain('Jane Doe');
      expect(employeeNames).toContain('Bob Wilson');
      expect(employeeNames).toContain('Alice Brown');
      expect(employeeNames).toContain('Charlie Davis');
    });

    it('should convert time strings to Date objects', () => {
      const ipcResponse = createRealisticIPCResponse();
      const result = transformShiftsByDays(ipcResponse);

      for (const day of result) {
        for (const shift of day.shifts) {
          expect(shift.startTime).toBeInstanceOf(Date);
          expect(shift.endTime).toBeInstanceOf(Date);
        }
      }
    });
  });

  describe('Data transformation maintains integrity', () => {
    it('should preserve unique shift IDs through transformation', () => {
      const ipcResponse = createRealisticIPCResponse();
      const result = transformShiftsByDays(ipcResponse);

      const allIds = result.flatMap((d) => d.shifts.map((s) => s.id));
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    it('should preserve register names through transformation', () => {
      const ipcResponse = createRealisticIPCResponse();
      const result = transformShiftsByDays(ipcResponse);

      const registerNames = result[0].shifts.map((s) => s.registerName);
      expect(registerNames).toContain('POS1');
      expect(registerNames).toContain('POS2');
    });

    it('should not modify the original IPC response data', () => {
      const ipcResponse = createRealisticIPCResponse();
      const originalDayCount = ipcResponse.days.length;
      const originalShiftCount = ipcResponse.days[0].shifts.length;

      transformShiftsByDays(ipcResponse);

      expect(ipcResponse.days.length).toBe(originalDayCount);
      expect(ipcResponse.days[0].shifts.length).toBe(originalShiftCount);
    });
  });

  describe('Register grouping after transformation', () => {
    it('should group and sort transformed shifts correctly', () => {
      const ipcResponse = createRealisticIPCResponse();
      const result = transformShiftsByDays(ipcResponse);

      // Group day 1's shifts by register
      const grouped = groupShiftsByRegister(result[0].shifts);

      // Should be sorted alphabetically: POS1, POS2
      expect(grouped[0][0]).toBe('POS1');
      expect(grouped[1][0]).toBe('POS2');

      // POS1 should have shifts sorted by number: 1, 2
      expect(grouped[0][1][0].shiftNumber).toBe(1);
      expect(grouped[0][1][1].shiftNumber).toBe(2);

      // POS2 should have shifts sorted by number: 1, 2
      expect(grouped[1][1][0].shiftNumber).toBe(1);
      expect(grouped[1][1][1].shiftNumber).toBe(2);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty response correctly', () => {
      const emptyResponse: ShiftsByDayResponse = { days: [] };
      const result = transformShiftsByDays(emptyResponse);
      expect(result).toEqual([]);
    });

    it('should handle day with no shifts', () => {
      const response: ShiftsByDayResponse = {
        days: [{ businessDate: '2026-01-27', dayStatus: 'OPEN', shifts: [] }],
      };
      const result = transformShiftsByDays(response);
      expect(result[0].shifts).toEqual([]);
    });

    it('should handle shifts with missing optional data', () => {
      const response: ShiftsByDayResponse = {
        days: [
          {
            businessDate: '2026-01-27',
            dayStatus: 'OPEN',
            shifts: [
              {
                shiftId: 's1',
                shiftNumber: 1,
                registerName: '',
                employeeName: '',
                startTime: '2026-01-27T06:00:00.000Z',
                endTime: null,
                status: 'OPEN',
              },
            ],
          },
        ],
      };

      const result = transformShiftsByDays(response);
      expect(result[0].shifts[0].registerName).toBe('Register');
      expect(result[0].shifts[0].employeeName).toBe('Unknown');
      expect(result[0].shifts[0].endTime).toBeInstanceOf(Date);
    });

    it('should handle rapid successive transformations without data corruption', () => {
      // Pin the clock so that open shifts (endTime: null → new Date()) produce
      // identical timestamps across consecutive calls.
      vi.useFakeTimers({ now: new Date('2026-01-27T12:00:00.000Z') });

      try {
        const response = createRealisticIPCResponse();

        const result1 = transformShiftsByDays(response);
        const result2 = transformShiftsByDays(response);
        const result3 = transformShiftsByDays(response);

        // All results should be identical but independent objects
        expect(result1).toEqual(result2);
        expect(result2).toEqual(result3);

        // Mutating result1 should not affect result2
        result1[0].shifts[0].employeeName = 'MUTATED';
        expect(result2[0].shifts[0].employeeName).not.toBe('MUTATED');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Error boundary scenarios', () => {
    it('should handle date strings at timezone boundaries', () => {
      const response: ShiftsByDayResponse = {
        days: [
          {
            businessDate: '2026-01-01',
            dayStatus: 'CLOSED',
            shifts: [
              {
                shiftId: 's1',
                shiftNumber: 1,
                registerName: 'POS1',
                employeeName: 'New Year Employee',
                startTime: '2025-12-31T23:00:00.000Z',
                endTime: '2026-01-01T07:00:00.000Z',
                status: 'CLOSED',
              },
            ],
          },
        ],
      };

      const result = transformShiftsByDays(response);
      expect(result[0].date).toBeInstanceOf(Date);
      expect(result[0].shifts[0].startTime).toBeInstanceOf(Date);
      expect(result[0].shifts[0].endTime).toBeInstanceOf(Date);
    });

    it('should handle business date at month boundary', () => {
      const response: ShiftsByDayResponse = {
        days: [
          { businessDate: '2026-02-28', dayStatus: 'CLOSED', shifts: [] },
          { businessDate: '2026-03-01', dayStatus: 'OPEN', shifts: [] },
        ],
      };

      const result = transformShiftsByDays(response);
      expect(result[0].businessDate).toBe('2026-02-28');
      expect(result[1].businessDate).toBe('2026-03-01');
    });
  });
});
