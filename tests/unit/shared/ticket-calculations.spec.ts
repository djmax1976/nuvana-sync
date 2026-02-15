/**
 * Unit Tests for Lottery Ticket Calculations
 *
 * Tests the centralized ticket calculation utility to ensure:
 * - Correct formulas for POSITION and INDEX modes
 * - Proper handling of 0-based serial numbers (serial 0 is a real ticket)
 * - Edge cases and error conditions
 * - Security validation of inputs
 *
 * @module tests/unit/shared/ticket-calculations.spec
 */

import { describe, it, expect } from 'vitest';
import {
  parseSerial,
  formatSerial,
  calculateTotalTicketsInPack,
  calculateTicketsSold,
  calculateTicketsRemaining,
  calculateTicketsRemainingFromSerials,
  calculateSalesAmount,
  getTicketsSold,
  getTotalTicketsInPack,
  getTicketsRemaining,
  calculateTicketsSoldPosition,
  calculateTicketsSoldIndex,
  CalculationModes,
  MAX_SERIAL_NUMBER,
  MIN_SERIAL_NUMBER,
} from '../../../src/shared/lottery/ticket-calculations';

describe('ticket-calculations', () => {
  // ============================================================================
  // parseSerial Tests
  // ============================================================================

  describe('parseSerial', () => {
    it('should parse valid string serial numbers', () => {
      expect(parseSerial('000')).toBe(0);
      expect(parseSerial('007')).toBe(7);
      expect(parseSerial('015')).toBe(15);
      expect(parseSerial('059')).toBe(59);
      expect(parseSerial('150')).toBe(150);
      expect(parseSerial('299')).toBe(299);
      expect(parseSerial('999')).toBe(999);
    });

    it('should parse valid numeric serial numbers', () => {
      expect(parseSerial(0)).toBe(0);
      expect(parseSerial(7)).toBe(7);
      expect(parseSerial(59)).toBe(59);
      expect(parseSerial(299)).toBe(299);
      expect(parseSerial(999)).toBe(999);
    });

    it('should handle strings without leading zeros', () => {
      expect(parseSerial('0')).toBe(0);
      expect(parseSerial('7')).toBe(7);
      expect(parseSerial('59')).toBe(59);
    });

    it('should return null for invalid inputs', () => {
      expect(parseSerial(null)).toBeNull();
      expect(parseSerial(undefined)).toBeNull();
      expect(parseSerial('abc')).toBeNull();
      expect(parseSerial('')).toBeNull();
      expect(parseSerial('12.5')).toBeNull();
      expect(parseSerial(12.5)).toBeNull();
    });

    it('should return null for out-of-bounds values', () => {
      expect(parseSerial(-1)).toBeNull();
      expect(parseSerial(1000)).toBeNull();
      expect(parseSerial('-1')).toBeNull();
      expect(parseSerial('1000')).toBeNull();
    });

    it('should handle edge cases at boundaries', () => {
      expect(parseSerial(MIN_SERIAL_NUMBER)).toBe(0);
      expect(parseSerial(MAX_SERIAL_NUMBER)).toBe(999);
    });
  });

  // ============================================================================
  // formatSerial Tests
  // ============================================================================

  describe('formatSerial', () => {
    it('should format numbers with leading zeros', () => {
      expect(formatSerial(0)).toBe('000');
      expect(formatSerial(7)).toBe('007');
      expect(formatSerial(59)).toBe('059');
      expect(formatSerial(150)).toBe('150');
      expect(formatSerial(999)).toBe('999');
    });

    it('should return null for invalid inputs', () => {
      expect(formatSerial(null)).toBeNull();
      expect(formatSerial(undefined)).toBeNull();
      expect(formatSerial(-1)).toBeNull();
      expect(formatSerial(1000)).toBeNull();
      expect(formatSerial(12.5)).toBeNull();
    });
  });

  // ============================================================================
  // calculateTotalTicketsInPack Tests
  // ============================================================================

  describe('calculateTotalTicketsInPack', () => {
    it('should calculate total tickets correctly (inclusive range)', () => {
      // Pack 000-059 has 60 tickets
      const result1 = calculateTotalTicketsInPack(0, 59);
      expect(result1.success).toBe(true);
      expect(result1.value).toBe(60);

      // Pack 000-299 has 300 tickets
      const result2 = calculateTotalTicketsInPack(0, 299);
      expect(result2.success).toBe(true);
      expect(result2.value).toBe(300);

      // Pack 000-017 has 18 tickets
      const result3 = calculateTotalTicketsInPack(0, 17);
      expect(result3.success).toBe(true);
      expect(result3.value).toBe(18);
    });

    it('should work with string inputs', () => {
      const result = calculateTotalTicketsInPack('000', '059');
      expect(result.success).toBe(true);
      expect(result.value).toBe(60);
    });

    it('should handle single ticket pack', () => {
      const result = calculateTotalTicketsInPack(0, 0);
      expect(result.success).toBe(true);
      expect(result.value).toBe(1);
    });

    it('should fail for invalid inputs', () => {
      expect(calculateTotalTicketsInPack(null, 59).success).toBe(false);
      expect(calculateTotalTicketsInPack(0, null).success).toBe(false);
      expect(calculateTotalTicketsInPack('abc', 59).success).toBe(false);
    });

    it('should fail when end < start', () => {
      const result = calculateTotalTicketsInPack(59, 0);
      expect(result.success).toBe(false);
      expect(result.error).toContain('less than');
    });
  });

  // ============================================================================
  // calculateTicketsSold Tests - POSITION Mode
  // ============================================================================

  describe('calculateTicketsSold - POSITION mode', () => {
    const MODE = CalculationModes.POSITION;

    it('should calculate tickets sold correctly (ending is next position)', () => {
      // Starting at 0, ending at 15 means tickets 0-14 were sold (15 tickets)
      const result = calculateTicketsSold(0, 15, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(15);
    });

    it('should handle no sales scenario', () => {
      // Starting at 0, ending at 0 means no tickets sold
      const result = calculateTicketsSold(0, 0, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(0);
    });

    it('should handle mid-pack starting position', () => {
      // Starting at 5, ending at 10 means tickets 5-9 were sold (5 tickets)
      const result = calculateTicketsSold(5, 10, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(5);
    });

    it('should handle full 50-ticket pack sold', () => {
      // Starting at 0, ending at 50 means all 50 tickets sold
      const result = calculateTicketsSold(0, 50, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(50);
    });

    it('should work with string inputs', () => {
      const result = calculateTicketsSold('000', '015', MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(15);
    });

    it('should handle day close scenario from previous session', () => {
      // Pack continued from yesterday ending at 150, today ending at 200
      const result = calculateTicketsSold(150, 200, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(50);
    });
  });

  // ============================================================================
  // calculateTicketsSold Tests - INDEX Mode
  // ============================================================================

  describe('calculateTicketsSold - INDEX mode', () => {
    const MODE = CalculationModes.INDEX;

    it('should calculate tickets sold correctly (closing is last ticket index)', () => {
      // Starting at 0, closing at 14 means tickets 0-14 were sold (15 tickets)
      const result = calculateTicketsSold(0, 14, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(15);
    });

    it('should handle full 30-ticket pack sold out (serials 000-029)', () => {
      // Starting at 0, closing at 29 = (29+1)-0 = 30 tickets
      const result = calculateTicketsSold(0, 29, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(30);
    });

    it('should handle 18-ticket pack sold out (serials 000-017)', () => {
      // Starting at 0, closing at 17 = (17+1)-0 = 18 tickets
      const result = calculateTicketsSold(0, 17, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(18);
    });

    it('should handle partial pack depletion from mid-position', () => {
      // Started selling at position 10, last ticket sold was 19
      // Tickets 10-19 sold = (19+1)-10 = 10 tickets
      const result = calculateTicketsSold(10, 19, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(10);
    });

    it('should handle single ticket sold (depletion at starting position)', () => {
      // Only ticket 0 sold (pack depleted immediately)
      // (0+1)-0 = 1 ticket
      const result = calculateTicketsSold(0, 0, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(1);
    });

    it('should work with string inputs', () => {
      const result = calculateTicketsSold('000', '029', MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(30);
    });

    it('should handle full 60-ticket pack sold out (serials 000-059)', () => {
      // User scenario: pack 000-059, last ticket is 59
      const result = calculateTicketsSold(0, 59, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(60);
    });

    it('should handle return pack scenario (partial sales before return)', () => {
      // Pack was at position 25, returned with closing serial 24
      // All tickets up to and including 24 were sold = (24+1)-0 = 25 tickets
      const result = calculateTicketsSold(0, 24, MODE);
      expect(result.success).toBe(true);
      expect(result.value).toBe(25);
    });
  });

  // ============================================================================
  // Mode Comparison Tests (CRITICAL - demonstrates the difference)
  // ============================================================================

  describe('POSITION vs INDEX mode comparison', () => {
    it('should produce different results for same inputs', () => {
      const positionResult = calculateTicketsSold(0, 15, CalculationModes.POSITION);
      const indexResult = calculateTicketsSold(0, 15, CalculationModes.INDEX);

      // POSITION: 15 - 0 = 15 tickets
      expect(positionResult.value).toBe(15);
      // INDEX: (15 + 1) - 0 = 16 tickets
      expect(indexResult.value).toBe(16);
    });

    it('should show INDEX = POSITION + 1 for same ending serial', () => {
      for (let end = 0; end <= 50; end++) {
        const positionResult = calculateTicketsSold(0, end, CalculationModes.POSITION);
        const indexResult = calculateTicketsSold(0, end, CalculationModes.INDEX);

        expect(indexResult.value).toBe(positionResult.value + 1);
      }
    });
  });

  // ============================================================================
  // calculateTicketsRemaining Tests
  // ============================================================================

  describe('calculateTicketsRemaining', () => {
    it('should calculate remaining correctly', () => {
      const result = calculateTicketsRemaining(60, 59);
      expect(result.success).toBe(true);
      expect(result.value).toBe(1);
    });

    it('should handle no sales', () => {
      const result = calculateTicketsRemaining(300, 0);
      expect(result.success).toBe(true);
      expect(result.value).toBe(300);
    });

    it('should handle all sold', () => {
      const result = calculateTicketsRemaining(60, 60);
      expect(result.success).toBe(true);
      expect(result.value).toBe(0);
    });

    it('should fail when sold exceeds total', () => {
      const result = calculateTicketsRemaining(60, 61);
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds');
    });
  });

  // ============================================================================
  // calculateTicketsRemainingFromSerials Tests
  // ============================================================================

  describe('calculateTicketsRemainingFromSerials', () => {
    it('should calculate 1 ticket remaining correctly', () => {
      // Pack 000-059 (60 tickets), current position is 59 (last ticket)
      const result = calculateTicketsRemainingFromSerials(0, 59, 59);
      expect(result.success).toBe(true);
      expect(result.value).toBe(1);
    });

    it('should calculate half pack remaining', () => {
      // Pack 000-059 (60 tickets), current position is 30
      const result = calculateTicketsRemainingFromSerials(0, 59, 30);
      expect(result.success).toBe(true);
      expect(result.value).toBe(30);
    });

    it('should calculate full pack remaining', () => {
      // Pack 000-059 (60 tickets), current position is 0 (just started)
      const result = calculateTicketsRemainingFromSerials(0, 59, 0);
      expect(result.success).toBe(true);
      expect(result.value).toBe(60);
    });

    it('should handle position at pack end + 1 (sold out)', () => {
      // Pack 000-059 (60 tickets), current position is 60 (past end)
      const result = calculateTicketsRemainingFromSerials(0, 59, 60);
      expect(result.success).toBe(true);
      expect(result.value).toBe(0);
    });

    it('should fail when position exceeds pack range', () => {
      const result = calculateTicketsRemainingFromSerials(0, 59, 61);
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds');
    });

    it('should work with string inputs', () => {
      const result = calculateTicketsRemainingFromSerials('000', '059', '059');
      expect(result.success).toBe(true);
      expect(result.value).toBe(1);
    });
  });

  // ============================================================================
  // calculateSalesAmount Tests
  // ============================================================================

  describe('calculateSalesAmount', () => {
    it('should calculate sales amount correctly', () => {
      const result = calculateSalesAmount(15, 5.0);
      expect(result.success).toBe(true);
      expect(result.value).toBe(75.0);
    });

    it('should handle decimal prices', () => {
      const result = calculateSalesAmount(30, 2.5);
      expect(result.success).toBe(true);
      expect(result.value).toBe(75.0);
    });

    it('should round to 2 decimal places', () => {
      const result = calculateSalesAmount(3, 3.33);
      expect(result.success).toBe(true);
      expect(result.value).toBe(9.99);
    });

    it('should handle zero tickets', () => {
      const result = calculateSalesAmount(0, 5.0);
      expect(result.success).toBe(true);
      expect(result.value).toBe(0);
    });
  });

  // ============================================================================
  // Throwing Convenience Functions Tests
  // ============================================================================

  describe('getTicketsSold (throwing version)', () => {
    it('should return value for valid inputs', () => {
      expect(getTicketsSold(0, 15, CalculationModes.POSITION)).toBe(15);
      expect(getTicketsSold(0, 29, CalculationModes.INDEX)).toBe(30);
    });

    it('should throw for invalid inputs', () => {
      expect(() => getTicketsSold('abc', 15, CalculationModes.POSITION)).toThrow();
    });
  });

  describe('getTotalTicketsInPack (throwing version)', () => {
    it('should return value for valid inputs', () => {
      expect(getTotalTicketsInPack(0, 59)).toBe(60);
    });

    it('should throw for invalid inputs', () => {
      expect(() => getTotalTicketsInPack(59, 0)).toThrow();
    });
  });

  describe('getTicketsRemaining (throwing version)', () => {
    it('should return value for valid inputs', () => {
      expect(getTicketsRemaining(0, 59, 59)).toBe(1);
    });

    it('should throw for invalid inputs', () => {
      expect(() => getTicketsRemaining(0, 59, 100)).toThrow();
    });
  });

  // ============================================================================
  // Legacy Compatibility Functions Tests
  // ============================================================================

  describe('calculateTicketsSoldPosition (legacy)', () => {
    it('should use POSITION mode formula', () => {
      expect(calculateTicketsSoldPosition(0, 15)).toBe(15);
      expect(calculateTicketsSoldPosition(0, 0)).toBe(0);
    });

    it('should return 0 for invalid inputs', () => {
      expect(calculateTicketsSoldPosition(null, 15)).toBe(0);
      expect(calculateTicketsSoldPosition('abc', 15)).toBe(0);
    });
  });

  describe('calculateTicketsSoldIndex (legacy)', () => {
    it('should use INDEX mode formula', () => {
      expect(calculateTicketsSoldIndex(0, 29)).toBe(30);
      expect(calculateTicketsSoldIndex(0, 0)).toBe(1);
    });

    it('should return 0 for invalid inputs', () => {
      expect(calculateTicketsSoldIndex(null, 29)).toBe(0);
      expect(calculateTicketsSoldIndex('abc', 29)).toBe(0);
    });
  });

  // ============================================================================
  // Real-World Scenario Tests
  // ============================================================================

  describe('real-world scenarios', () => {
    it('should handle user bug report: Pack 000-059, last ticket 59, should show 1 remaining', () => {
      // User reported: pack shows 0 tickets remaining when there should be 1
      // Pack has serials 000-059 (60 tickets total)
      // Current position (ending_serial/current pointer) is 59
      // This means ticket 59 has NOT been sold yet (1 ticket remaining)

      const result = calculateTicketsRemainingFromSerials('000', '059', '059');
      expect(result.success).toBe(true);
      expect(result.value).toBe(1);
    });

    it('should handle day close: pack continues to next day', () => {
      // Day 1: Pack starts at 000, ends day at position 050
      // Day 2: Pack starts at 050 (carryforward), ends at 075
      // Total tickets sold on Day 2 = 75 - 50 = 25 tickets

      const day2Sold = calculateTicketsSold(50, 75, CalculationModes.POSITION);
      expect(day2Sold.success).toBe(true);
      expect(day2Sold.value).toBe(25);
    });

    it('should handle depletion: pack sold out mid-shift', () => {
      // Pack 000-029 (30 tickets), sold out at closing serial 029
      // This is INDEX mode - 029 is the LAST ticket sold

      const result = calculateTicketsSold(0, 29, CalculationModes.INDEX);
      expect(result.success).toBe(true);
      expect(result.value).toBe(30);
    });

    it('should handle return: pack returned after partial sales', () => {
      // Pack started at 000, returned when position was at 025
      // Tickets 000-024 were sold before return
      // This is INDEX mode for the return - closing serial is last ticket index

      const result = calculateTicketsSold(0, 24, CalculationModes.INDEX);
      expect(result.success).toBe(true);
      expect(result.value).toBe(25);
    });

    it('should handle auto-replacement: old pack depleted when new pack activated', () => {
      // Old pack at position 015, new pack activated in same bin
      // Old pack auto-depleted with closing_serial = 014 (last ticket sold)
      // INDEX mode: (14+1) - 0 = 15 tickets sold

      const result = calculateTicketsSold(0, 14, CalculationModes.INDEX);
      expect(result.success).toBe(true);
      expect(result.value).toBe(15);
    });
  });

  // ============================================================================
  // Security Tests (SEC-014: Input Validation)
  // ============================================================================

  describe('SEC-014: input validation security', () => {
    it('should reject negative serial numbers', () => {
      expect(parseSerial(-1)).toBeNull();
      expect(calculateTicketsSold(-1, 15, CalculationModes.POSITION).success).toBe(false);
    });

    it('should reject serial numbers exceeding maximum', () => {
      expect(parseSerial(1000)).toBeNull();
      expect(calculateTicketsSold(0, 1000, CalculationModes.POSITION).success).toBe(false);
    });

    it('should reject non-numeric strings', () => {
      expect(parseSerial('abc')).toBeNull();
      expect(parseSerial('<script>alert(1)</script>')).toBeNull();
      expect(parseSerial("'; DROP TABLE packs; --")).toBeNull();
    });

    it('should reject invalid calculation modes', () => {
      const result = calculateTicketsSold(0, 15, 'INVALID' as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid calculation mode');
    });

    it('should handle null/undefined gracefully', () => {
      expect(parseSerial(null)).toBeNull();
      expect(parseSerial(undefined)).toBeNull();
      expect(calculateTicketsSold(null, 15, CalculationModes.POSITION).success).toBe(false);
      expect(calculateTicketsSold(0, undefined, CalculationModes.POSITION).success).toBe(false);
    });
  });
});
