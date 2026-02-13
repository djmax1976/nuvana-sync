/**
 * Barcode Parser Unit Tests
 *
 * Enterprise-grade tests for lottery serial number parsing.
 * Validates SEC-014: INPUT_VALIDATION - Strict format validation
 *
 * Serial Format (24 digits):
 * - Positions 1-4: Game code (4 digits)
 * - Positions 5-11: Pack number (7 digits)
 * - Positions 12-14: Starting ticket number (3 digits)
 * - Positions 15-24: Identifier (10 digits, not used)
 *
 * @module tests/unit/utils/barcode-parser
 * @security SEC-014: Input validation at system boundary
 */

import { describe, it, expect } from 'vitest';
import {
  parseSerializedNumber,
  isValidSerialNumber,
  extractGameCode,
  InvalidSerialNumberError,
  type ParsedSerialNumber,
} from '@/lib/utils/lottery-serial-parser';

// ============================================================================
// Test Data Constants
// ============================================================================

/** Valid 24-digit serial numbers for testing */
const VALID_SERIALS = {
  standard: '000112345670123456789012',
  allZeros: '000000000000000000000000',
  maxValues: '999999999999999999999999',
  mixedValues: '123456789012345678901234',
} as const;

/** Invalid serial numbers for edge case testing */
const INVALID_SERIALS = {
  tooShort: '00011234567012345678901', // 23 digits
  tooLong: '0001123456701234567890123', // 25 digits
  containsLetters: '000112345670123456789abc',
  containsSpaces: '0001 1234567 012 3456789012',
  containsSpecialChars: '0001-1234567-012-3456789012',
  empty: '',
  whitespace: '                        ',
  leadingZero: '000112345670123456789012 ',
  trailingSpace: ' 000112345670123456789012',
} as const;

// ============================================================================
// parseSerializedNumber Tests
// ============================================================================

describe('parseSerializedNumber', () => {
  describe('SEC-014: Input Validation - Valid Inputs', () => {
    it('should parse standard 24-digit serial number correctly', () => {
      const result = parseSerializedNumber(VALID_SERIALS.standard);

      expect(result).toEqual<ParsedSerialNumber>({
        game_code: '0001',
        pack_number: '1234567',
        serial_start: '012',
      });
    });

    it('should parse serial with all zeros correctly', () => {
      const result = parseSerializedNumber(VALID_SERIALS.allZeros);

      expect(result).toEqual<ParsedSerialNumber>({
        game_code: '0000',
        pack_number: '0000000',
        serial_start: '000',
      });
    });

    it('should parse serial with max values correctly', () => {
      const result = parseSerializedNumber(VALID_SERIALS.maxValues);

      expect(result).toEqual<ParsedSerialNumber>({
        game_code: '9999',
        pack_number: '9999999',
        serial_start: '999',
      });
    });

    it('should parse mixed value serial correctly', () => {
      const result = parseSerializedNumber(VALID_SERIALS.mixedValues);

      expect(result).toEqual<ParsedSerialNumber>({
        game_code: '1234',
        pack_number: '5678901',
        serial_start: '234',
      });
    });

    it('should extract correct game code (positions 1-4)', () => {
      const result = parseSerializedNumber('999900000000000000000000');
      expect(result.game_code).toBe('9999');
    });

    it('should extract correct pack number (positions 5-11)', () => {
      const result = parseSerializedNumber('000099999990000000000000');
      expect(result.pack_number).toBe('9999999');
    });

    it('should extract correct serial start (positions 12-14)', () => {
      const result = parseSerializedNumber('000000000009990000000000');
      expect(result.serial_start).toBe('999');
    });
  });

  describe('SEC-014: Input Validation - Invalid Inputs', () => {
    it('should throw InvalidSerialNumberError for serial too short (23 digits)', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.tooShort)).toThrow(
        InvalidSerialNumberError
      );
      expect(() => parseSerializedNumber(INVALID_SERIALS.tooShort)).toThrow(
        'Invalid serial number format. Must be 24 digits.'
      );
    });

    it('should throw InvalidSerialNumberError for serial too long (25 digits)', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.tooLong)).toThrow(
        InvalidSerialNumberError
      );
    });

    it('should throw InvalidSerialNumberError for serial containing letters', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.containsLetters)).toThrow(
        InvalidSerialNumberError
      );
    });

    it('should throw InvalidSerialNumberError for serial containing spaces', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.containsSpaces)).toThrow(
        InvalidSerialNumberError
      );
    });

    it('should throw InvalidSerialNumberError for serial containing special characters', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.containsSpecialChars)).toThrow(
        InvalidSerialNumberError
      );
    });

    it('should throw InvalidSerialNumberError for empty string', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.empty)).toThrow(
        InvalidSerialNumberError
      );
    });

    it('should throw InvalidSerialNumberError for whitespace-only string', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.whitespace)).toThrow(
        InvalidSerialNumberError
      );
    });

    it('should throw InvalidSerialNumberError for serial with leading space', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.trailingSpace)).toThrow(
        InvalidSerialNumberError
      );
    });

    it('should throw InvalidSerialNumberError for serial with trailing space', () => {
      expect(() => parseSerializedNumber(INVALID_SERIALS.leadingZero)).toThrow(
        InvalidSerialNumberError
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle leading zeros in game code', () => {
      const result = parseSerializedNumber('000100000000000000000000');
      expect(result.game_code).toBe('0001');
    });

    it('should handle leading zeros in pack number', () => {
      const result = parseSerializedNumber('000000000010000000000000');
      expect(result.pack_number).toBe('0000001');
    });

    it('should handle leading zeros in serial start', () => {
      const result = parseSerializedNumber('000000000000010000000000');
      expect(result.serial_start).toBe('001');
    });

    it('should not modify leading zeros (preserve string format)', () => {
      const result = parseSerializedNumber('000100000010010000000000');
      expect(result.game_code).toBe('0001');
      expect(result.pack_number).toBe('0000001');
      expect(result.serial_start).toBe('001');
    });

    it('should correctly parse barcode with realistic values', () => {
      // Real-world example: Game 1234, Pack 5678901, Serial 042
      const result = parseSerializedNumber('123456789010420000000000');
      expect(result).toEqual<ParsedSerialNumber>({
        game_code: '1234',
        pack_number: '5678901',
        serial_start: '042',
      });
    });
  });

  describe('Error Class Validation', () => {
    it('should throw error with correct name property', () => {
      try {
        parseSerializedNumber('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidSerialNumberError);
        expect((error as InvalidSerialNumberError).name).toBe('InvalidSerialNumberError');
      }
    });

    it('should throw error that extends Error', () => {
      try {
        parseSerializedNumber('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});

// ============================================================================
// isValidSerialNumber Tests
// ============================================================================

describe('isValidSerialNumber', () => {
  describe('Valid Serial Numbers', () => {
    it('should return true for valid 24-digit serial', () => {
      expect(isValidSerialNumber(VALID_SERIALS.standard)).toBe(true);
    });

    it('should return true for serial with all zeros', () => {
      expect(isValidSerialNumber(VALID_SERIALS.allZeros)).toBe(true);
    });

    it('should return true for serial with max values', () => {
      expect(isValidSerialNumber(VALID_SERIALS.maxValues)).toBe(true);
    });
  });

  describe('Invalid Serial Numbers', () => {
    it('should return false for serial too short', () => {
      expect(isValidSerialNumber(INVALID_SERIALS.tooShort)).toBe(false);
    });

    it('should return false for serial too long', () => {
      expect(isValidSerialNumber(INVALID_SERIALS.tooLong)).toBe(false);
    });

    it('should return false for serial containing letters', () => {
      expect(isValidSerialNumber(INVALID_SERIALS.containsLetters)).toBe(false);
    });

    it('should return false for serial containing spaces', () => {
      expect(isValidSerialNumber(INVALID_SERIALS.containsSpaces)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidSerialNumber(INVALID_SERIALS.empty)).toBe(false);
    });

    it('should return false for whitespace-only string', () => {
      expect(isValidSerialNumber(INVALID_SERIALS.whitespace)).toBe(false);
    });
  });

  describe('Boundary Testing', () => {
    it('should return false for 23 digits', () => {
      expect(isValidSerialNumber('0'.repeat(23))).toBe(false);
    });

    it('should return true for exactly 24 digits', () => {
      expect(isValidSerialNumber('0'.repeat(24))).toBe(true);
    });

    it('should return false for 25 digits', () => {
      expect(isValidSerialNumber('0'.repeat(25))).toBe(false);
    });
  });
});

// ============================================================================
// extractGameCode Tests
// ============================================================================

describe('extractGameCode', () => {
  describe('Valid Serial Numbers', () => {
    it('should extract game code from valid serial', () => {
      expect(extractGameCode(VALID_SERIALS.standard)).toBe('0001');
    });

    it('should extract game code with all zeros', () => {
      expect(extractGameCode(VALID_SERIALS.allZeros)).toBe('0000');
    });

    it('should extract game code with max values', () => {
      expect(extractGameCode(VALID_SERIALS.maxValues)).toBe('9999');
    });

    it('should extract correct 4-digit game code', () => {
      expect(extractGameCode('123400000000000000000000')).toBe('1234');
    });
  });

  describe('Invalid Serial Numbers', () => {
    it('should return null for serial too short', () => {
      expect(extractGameCode(INVALID_SERIALS.tooShort)).toBeNull();
    });

    it('should return null for serial too long', () => {
      expect(extractGameCode(INVALID_SERIALS.tooLong)).toBeNull();
    });

    it('should return null for serial containing letters', () => {
      expect(extractGameCode(INVALID_SERIALS.containsLetters)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(extractGameCode(INVALID_SERIALS.empty)).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(extractGameCode(INVALID_SERIALS.whitespace)).toBeNull();
    });
  });
});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('Barcode Parser Integration Scenarios', () => {
  describe('Day Close Scanner Flow', () => {
    it('should parse scanner output format correctly', () => {
      // Simulates what a barcode scanner would output
      const scannerOutput = '000112345670150000000000';
      const result = parseSerializedNumber(scannerOutput);

      expect(result.game_code).toBe('0001');
      expect(result.pack_number).toBe('1234567');
      expect(result.serial_start).toBe('015'); // Closing serial at position 015
    });

    it('should validate before parsing in a pipeline', () => {
      const input = '000112345670150000000000';

      // Validation step
      const isValid = isValidSerialNumber(input);
      expect(isValid).toBe(true);

      // Parsing step (only if valid)
      if (isValid) {
        const result = parseSerializedNumber(input);
        expect(result).toBeDefined();
        expect(result.pack_number).toBe('1234567');
      }
    });

    it('should handle rapid sequential parses (simulating fast scanning)', () => {
      const serials = [
        '000112345670000000000000',
        '000212345680010000000000',
        '000312345690020000000000',
        '000412345700030000000000',
        '000512345710040000000000',
      ];

      const results = serials.map((serial) => parseSerializedNumber(serial));

      expect(results).toHaveLength(5);
      expect(results[0].game_code).toBe('0001');
      expect(results[1].game_code).toBe('0002');
      expect(results[2].game_code).toBe('0003');
      expect(results[3].game_code).toBe('0004');
      expect(results[4].game_code).toBe('0005');
    });
  });

  describe('Pack Reception Flow', () => {
    it('should parse pack reception barcode correctly', () => {
      // Pack reception barcode format
      const barcode = '125656789010000000000000';
      const result = parseSerializedNumber(barcode);

      expect(result).toEqual<ParsedSerialNumber>({
        game_code: '1256',
        pack_number: '5678901',
        serial_start: '000', // New pack starts at 000
      });
    });
  });
});

// ============================================================================
// Security Validation
// ============================================================================

describe('Security Validation', () => {
  describe('SEC-014: Injection Prevention', () => {
    it('should reject SQL injection attempts', () => {
      const sqlInjection = "000112345670'; DROP TABLE--";
      expect(() => parseSerializedNumber(sqlInjection)).toThrow(InvalidSerialNumberError);
    });

    it('should reject XSS injection attempts', () => {
      const xssInjection = '0001<script>alert(1)</scrip';
      expect(() => parseSerializedNumber(xssInjection)).toThrow(InvalidSerialNumberError);
    });

    it('should reject command injection attempts', () => {
      const cmdInjection = '000112345670; rm -rf /   ';
      expect(() => parseSerializedNumber(cmdInjection)).toThrow(InvalidSerialNumberError);
    });

    it('should reject path traversal attempts', () => {
      const pathTraversal = '../../etc/passwd00000000';
      expect(() => parseSerializedNumber(pathTraversal)).toThrow(InvalidSerialNumberError);
    });

    it('should reject null byte injection', () => {
      const nullByte = '000112345670123456789\x00012';
      expect(() => parseSerializedNumber(nullByte)).toThrow(InvalidSerialNumberError);
    });
  });

  describe('Input Sanitization', () => {
    it('should not perform any string interpolation on input', () => {
      // This test ensures the function uses the input as-is for validation
      // and does not evaluate or interpolate it
      const templateLiteral = '${process.env.SECRET}000';
      expect(() => parseSerializedNumber(templateLiteral)).toThrow(InvalidSerialNumberError);
    });
  });
});
