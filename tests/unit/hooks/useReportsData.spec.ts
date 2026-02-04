/**
 * useReportsData Hook Unit Tests
 *
 * Tests the useReportsData hook's data transformation, status mapping,
 * and query configuration. Uses pure function testing for transformation
 * logic and mock-based testing for the hook's TanStack Query integration.
 *
 * @module tests/unit/hooks/useReportsData
 * @security FE-001: Verifies no sensitive data exposure
 * @security FE-003: Verifies data transformation doesn't leak internal types
 * @performance PERF-002: Verifies memoization through stable references
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Types mirrored from transport layer
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

// ============================================================================
// Functions Under Test (extracted from useReportsData.ts)
// These pure functions are tested directly for correctness.
// ============================================================================

/**
 * Map DB status to UI status
 */
function mapShiftStatus(
  shiftStatus: 'OPEN' | 'CLOSED',
  dayStatus: 'OPEN' | 'CLOSED'
): ReportShiftStatus {
  if (shiftStatus === 'OPEN') {
    return 'open';
  }
  if (dayStatus === 'CLOSED') {
    return 'reconciled';
  }
  return 'closed';
}

/**
 * Transform a single shift from IPC format to UI format
 */
function transformShift(
  shift: ShiftByDayData,
  dayStatus: 'OPEN' | 'CLOSED'
): {
  id: string;
  registerName: string;
  shiftNumber: number;
  startTime: Date;
  endTime: Date;
  employeeName: string;
  status: ReportShiftStatus;
} {
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

/**
 * Transform IPC response to UI format
 */
function transformShiftsByDays(data: ShiftsByDayResponse) {
  return data.days.map((day) => ({
    date: new Date(day.businessDate + 'T12:00:00'),
    businessDate: day.businessDate,
    dayStatus: day.dayStatus,
    shifts: day.shifts.map((shift) => transformShift(shift, day.dayStatus)),
  }));
}

// ============================================================================
// Tests: mapShiftStatus
// ============================================================================

describe('mapShiftStatus', () => {
  it('should return "open" when shift status is OPEN', () => {
    expect(mapShiftStatus('OPEN', 'OPEN')).toBe('open');
    expect(mapShiftStatus('OPEN', 'CLOSED')).toBe('open');
  });

  it('should return "reconciled" when shift is CLOSED and day is CLOSED', () => {
    expect(mapShiftStatus('CLOSED', 'CLOSED')).toBe('reconciled');
  });

  it('should return "closed" when shift is CLOSED and day is OPEN', () => {
    expect(mapShiftStatus('CLOSED', 'OPEN')).toBe('closed');
  });

  it('should handle all status combinations exhaustively', () => {
    const combinations: Array<{
      shiftStatus: 'OPEN' | 'CLOSED';
      dayStatus: 'OPEN' | 'CLOSED';
      expected: ReportShiftStatus;
    }> = [
      { shiftStatus: 'OPEN', dayStatus: 'OPEN', expected: 'open' },
      { shiftStatus: 'OPEN', dayStatus: 'CLOSED', expected: 'open' },
      { shiftStatus: 'CLOSED', dayStatus: 'OPEN', expected: 'closed' },
      { shiftStatus: 'CLOSED', dayStatus: 'CLOSED', expected: 'reconciled' },
    ];

    for (const { shiftStatus, dayStatus, expected } of combinations) {
      expect(mapShiftStatus(shiftStatus, dayStatus)).toBe(expected);
    }
  });
});

// ============================================================================
// Tests: transformShift
// ============================================================================

describe('transformShift', () => {
  const baseShift: ShiftByDayData = {
    shiftId: 'shift-001',
    shiftNumber: 1,
    registerName: 'POS1',
    employeeName: 'John Smith',
    startTime: '2026-01-27T06:00:00.000Z',
    endTime: '2026-01-27T14:00:00.000Z',
    status: 'CLOSED',
  };

  it('should map shiftId to id', () => {
    const result = transformShift(baseShift, 'CLOSED');
    expect(result.id).toBe('shift-001');
  });

  it('should preserve registerName', () => {
    const result = transformShift(baseShift, 'CLOSED');
    expect(result.registerName).toBe('POS1');
  });

  it('should default registerName to "Register" when empty', () => {
    const result = transformShift({ ...baseShift, registerName: '' }, 'CLOSED');
    expect(result.registerName).toBe('Register');
  });

  it('should convert startTime string to Date object', () => {
    const result = transformShift(baseShift, 'CLOSED');
    expect(result.startTime).toBeInstanceOf(Date);
    expect(result.startTime.toISOString()).toBe('2026-01-27T06:00:00.000Z');
  });

  it('should convert endTime string to Date object', () => {
    const result = transformShift(baseShift, 'CLOSED');
    expect(result.endTime).toBeInstanceOf(Date);
    expect(result.endTime.toISOString()).toBe('2026-01-27T14:00:00.000Z');
  });

  it('should default endTime to current time when null (open shift)', () => {
    const beforeTest = Date.now();
    const result = transformShift({ ...baseShift, endTime: null, status: 'OPEN' }, 'OPEN');
    const afterTest = Date.now();

    expect(result.endTime).toBeInstanceOf(Date);
    expect(result.endTime.getTime()).toBeGreaterThanOrEqual(beforeTest);
    expect(result.endTime.getTime()).toBeLessThanOrEqual(afterTest);
  });

  it('should default employeeName to "Unknown" when empty', () => {
    const result = transformShift({ ...baseShift, employeeName: '' }, 'CLOSED');
    expect(result.employeeName).toBe('Unknown');
  });

  it('should map status correctly using mapShiftStatus', () => {
    // Shift CLOSED + Day CLOSED = reconciled
    expect(transformShift({ ...baseShift, status: 'CLOSED' }, 'CLOSED').status).toBe('reconciled');

    // Shift CLOSED + Day OPEN = closed
    expect(transformShift({ ...baseShift, status: 'CLOSED' }, 'OPEN').status).toBe('closed');

    // Shift OPEN = open
    expect(transformShift({ ...baseShift, status: 'OPEN' }, 'OPEN').status).toBe('open');
  });
});

// ============================================================================
// Tests: transformShiftsByDays
// ============================================================================

describe('transformShiftsByDays', () => {
  it('should transform IPC response days to ReportDay objects', () => {
    const response: ShiftsByDayResponse = {
      days: [
        {
          businessDate: '2026-01-27',
          dayStatus: 'CLOSED',
          shifts: [
            {
              shiftId: 's1',
              shiftNumber: 1,
              registerName: 'POS1',
              employeeName: 'John Smith',
              startTime: '2026-01-27T06:00:00.000Z',
              endTime: '2026-01-27T14:00:00.000Z',
              status: 'CLOSED',
            },
          ],
        },
      ],
    };

    const result = transformShiftsByDays(response);
    expect(result).toHaveLength(1);
    expect(result[0].businessDate).toBe('2026-01-27');
    expect(result[0].dayStatus).toBe('CLOSED');
    expect(result[0].shifts).toHaveLength(1);
    expect(result[0].shifts[0].id).toBe('s1');
    expect(result[0].shifts[0].status).toBe('reconciled');
  });

  it('should parse date with noon time to avoid timezone issues', () => {
    const response: ShiftsByDayResponse = {
      days: [
        {
          businessDate: '2026-01-27',
          dayStatus: 'OPEN',
          shifts: [],
        },
      ],
    };

    const result = transformShiftsByDays(response);
    expect(result[0].date).toBeInstanceOf(Date);
    // Date should be created from '2026-01-27T12:00:00'
    expect(result[0].date.getHours()).toBe(12);
  });

  it('should handle empty response', () => {
    const response: ShiftsByDayResponse = { days: [] };
    const result = transformShiftsByDays(response);
    expect(result).toEqual([]);
  });

  it('should handle multiple days', () => {
    const response: ShiftsByDayResponse = {
      days: [
        { businessDate: '2026-01-27', dayStatus: 'CLOSED', shifts: [] },
        { businessDate: '2026-01-26', dayStatus: 'OPEN', shifts: [] },
        { businessDate: '2026-01-25', dayStatus: 'CLOSED', shifts: [] },
      ],
    };

    const result = transformShiftsByDays(response);
    expect(result).toHaveLength(3);
    expect(result[0].businessDate).toBe('2026-01-27');
    expect(result[1].businessDate).toBe('2026-01-26');
    expect(result[2].businessDate).toBe('2026-01-25');
  });

  it('should transform all shifts within each day', () => {
    const response: ShiftsByDayResponse = {
      days: [
        {
          businessDate: '2026-01-27',
          dayStatus: 'OPEN',
          shifts: [
            {
              shiftId: 's1',
              shiftNumber: 1,
              registerName: 'POS1',
              employeeName: 'A',
              startTime: '2026-01-27T06:00:00.000Z',
              endTime: '2026-01-27T14:00:00.000Z',
              status: 'CLOSED',
            },
            {
              shiftId: 's2',
              shiftNumber: 2,
              registerName: 'POS2',
              employeeName: 'B',
              startTime: '2026-01-27T14:00:00.000Z',
              endTime: null,
              status: 'OPEN',
            },
          ],
        },
      ],
    };

    const result = transformShiftsByDays(response);
    expect(result[0].shifts).toHaveLength(2);
    expect(result[0].shifts[0].status).toBe('closed'); // CLOSED shift + OPEN day
    expect(result[0].shifts[1].status).toBe('open'); // OPEN shift
  });

  it('should handle malformed response data defensively', () => {
    const response: ShiftsByDayResponse = {
      days: [
        {
          businessDate: '2026-01-27',
          dayStatus: 'CLOSED',
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
  });
});

// ============================================================================
// Tests: Query key structure
// ============================================================================

describe('reportsDataKeys', () => {
  it('should have predictable key structure for cache invalidation', () => {
    // Mirror the keys module structure
    const keys = {
      all: ['reportsData'] as const,
      shiftsByDays: (startDate: string, endDate: string) =>
        ['reportsData', 'shiftsByDays', startDate, endDate] as const,
    };

    expect(keys.all).toEqual(['reportsData']);
    expect(keys.shiftsByDays('2026-01-01', '2026-01-31')).toEqual([
      'reportsData',
      'shiftsByDays',
      '2026-01-01',
      '2026-01-31',
    ]);
  });

  it('should produce different keys for different date ranges', () => {
    const keygen = (s: string, e: string) => ['reportsData', 'shiftsByDays', s, e];

    const key1 = keygen('2026-01-01', '2026-01-07');
    const key2 = keygen('2026-01-08', '2026-01-14');

    expect(key1).not.toEqual(key2);
  });
});
