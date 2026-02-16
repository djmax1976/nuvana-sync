/**
 * Barcode Parser Unit Tests
 *
 * Enterprise-grade tests for the centralized lottery barcode parser.
 * Validates SEC-014: INPUT_VALIDATION - Strict format validation
 *
 * Serial Format (24 digits):
 * - Positions 1-4: Game code (4 digits)
 * - Positions 5-11: Pack number (7 digits)
 * - Positions 12-14: Serial start / ticket position (3 digits)
 * - Positions 15-24: Identifier / check data (10 digits)
 *
 * @module tests/unit/shared/barcode-parser
 * @security SEC-014: Input validation at system boundary
 */

import { describe, it, expect } from 'vitest';
import {
  parseBarcode,
  tryParseBarcode,
  isValidBarcode,
  validateBarcode,
  extractGameCode,
  extractPackNumber,
  extractSerialStart,
  extractIdentifier,
  parseBarcodes,
  deduplicateBarcodes,
  isValidSerialStart,
  parseSerialStart,
  formatSerialStart,
  InvalidBarcodeError,
  BARCODE_LENGTH,
  BARCODE_REGEX,
  type ParsedBarcode,
} from '../../../src/shared/lottery/barcode-parser';

// ============================================================================
// Test Data Constants
// ============================================================================

/** Valid 24-digit barcodes for testing */
const VALID_BARCODES = {
  standard: '000112345670253456789012',
  allZeros: '000000000000000000000000',
  allNines: '999999999999999999999999',
  mixedValues: '123456789012345678901234',
  newPack: '000112345670003456789012', // serial_start = 000
  midPack: '000112345671503456789012', // serial_start = 150
  nearEnd: '000112345672993456789012', // serial_start = 299
} as const;

/** Expected parsed results for valid barcodes */
const EXPECTED_PARSED = {
  standard: {
    game_code: '0001',
    pack_number: '1234567',
    serial_start: '025',
    identifier: '3456789012',
  },
  allZeros: {
    game_code: '0000',
    pack_number: '0000000',
    serial_start: '000',
    identifier: '0000000000',
  },
  allNines: {
    game_code: '9999',
    pack_number: '9999999',
    serial_start: '999',
    identifier: '9999999999',
  },
} as const;

/** Invalid barcodes for edge case testing */
const INVALID_BARCODES = {
  tooShort: '00011234567012345678901', // 23 digits
  tooLong: '0001123456701234567890123', // 25 digits
  containsLetters: '000112345670123456789abc',
  containsSpaces: '0001 1234567 012 3456789012',
  containsHyphens: '0001-1234567-012-3456789012',
  containsSpecialChars: '0001!1234567@012#3456789012',
  empty: '',
  whitespaceOnly: '                        ',
  leadingSpace: ' 000112345670253456789012',
  trailingSpace: '000112345670253456789012 ',
  newlines: '000112345670\n123456789012',
} as const;

/** SQL injection payloads for security testing */
const SQL_INJECTION_PAYLOADS = [
  "000112345670'; DROP TABLE--",
  "000112345670' OR '1'='1",
  '000112345670; DELETE FROM--',
  '000112345670 UNION SELECT',
  "000112345670' AND 1=1--",
  "000112345670'; EXEC xp_cmd",
  '000112345670 OR 1=1;--',
  "000112345670'/**/OR/**/1=1",
  '000112345670%27%20OR%201',
  "00011234567'; waitfor--",
] as const;

/** XSS injection payloads for security testing */
const XSS_INJECTION_PAYLOADS = [
  '0001<script>alert(1)</scrip',
  '000112345670123456<img/onerror=',
  '000112345670"onload="alert',
  '000112345670javascript:alert',
  "0001'><script>alert('XSS')",
  '000112345670<svg/onload=alert>',
] as const;

/** Command injection payloads */
const COMMAND_INJECTION_PAYLOADS = [
  '000112345670; rm -rf /   ',
  '000112345670 && cat /etc/p',
  '000112345670 | ls -la     ',
  '000112345670`whoami`     ',
  '000112345670$(cat /etc/pas)',
] as const;

// ============================================================================
// parseBarcode Tests
// ============================================================================

describe('parseBarcode', () => {
  describe('SEC-014: Input Validation - Valid Inputs', () => {
    it('should parse standard 24-digit barcode correctly', () => {
      const result = parseBarcode(VALID_BARCODES.standard);

      expect(result.raw).toBe(VALID_BARCODES.standard);
      expect(result.game_code).toBe(EXPECTED_PARSED.standard.game_code);
      expect(result.pack_number).toBe(EXPECTED_PARSED.standard.pack_number);
      expect(result.serial_start).toBe(EXPECTED_PARSED.standard.serial_start);
      expect(result.identifier).toBe(EXPECTED_PARSED.standard.identifier);
      expect(result.is_valid).toBe(true);
      expect(result.full_serial).toBe('00011234567');
    });

    it('should parse barcode with all zeros correctly', () => {
      const result = parseBarcode(VALID_BARCODES.allZeros);

      expect(result.game_code).toBe(EXPECTED_PARSED.allZeros.game_code);
      expect(result.pack_number).toBe(EXPECTED_PARSED.allZeros.pack_number);
      expect(result.serial_start).toBe(EXPECTED_PARSED.allZeros.serial_start);
      expect(result.identifier).toBe(EXPECTED_PARSED.allZeros.identifier);
      expect(result.is_valid).toBe(true);
    });

    it('should parse barcode with all nines correctly', () => {
      const result = parseBarcode(VALID_BARCODES.allNines);

      expect(result.game_code).toBe(EXPECTED_PARSED.allNines.game_code);
      expect(result.pack_number).toBe(EXPECTED_PARSED.allNines.pack_number);
      expect(result.serial_start).toBe(EXPECTED_PARSED.allNines.serial_start);
      expect(result.identifier).toBe(EXPECTED_PARSED.allNines.identifier);
      expect(result.is_valid).toBe(true);
    });

    it('should parse mixed value barcode correctly', () => {
      const result = parseBarcode(VALID_BARCODES.mixedValues);

      expect(result.game_code).toBe('1234');
      expect(result.pack_number).toBe('5678901');
      expect(result.serial_start).toBe('234');
      expect(result.identifier).toBe('5678901234');
    });

    it('should preserve leading zeros in all fields', () => {
      const result = parseBarcode('000100000010010000000000');

      expect(result.game_code).toBe('0001');
      expect(result.pack_number).toBe('0000001');
      expect(result.serial_start).toBe('001');
      expect(result.identifier).toBe('0000000000');
    });

    it('should extract correct game code (positions 1-4)', () => {
      const result = parseBarcode('999900000000000000000000');
      expect(result.game_code).toBe('9999');
    });

    it('should extract correct pack number (positions 5-11)', () => {
      const result = parseBarcode('000099999990000000000000');
      expect(result.pack_number).toBe('9999999');
    });

    it('should extract correct serial start (positions 12-14)', () => {
      const result = parseBarcode('000000000009990000000000');
      expect(result.serial_start).toBe('999');
    });

    it('should extract correct identifier (positions 15-24)', () => {
      const result = parseBarcode('000000000000009999999999');
      expect(result.identifier).toBe('9999999999');
    });

    it('should generate correct full_serial (game_code + pack_number)', () => {
      const result = parseBarcode('123456789010000000000000');
      expect(result.full_serial).toBe('12345678901');
    });
  });

  describe('SEC-014: Input Validation - Invalid Inputs', () => {
    it('should throw InvalidBarcodeError for barcode too short (23 digits)', () => {
      expect(() => parseBarcode(INVALID_BARCODES.tooShort)).toThrow(InvalidBarcodeError);
      expect(() => parseBarcode(INVALID_BARCODES.tooShort)).toThrow(/Expected 24 digits, got 23/);
    });

    it('should throw InvalidBarcodeError for barcode too long (25 digits)', () => {
      expect(() => parseBarcode(INVALID_BARCODES.tooLong)).toThrow(InvalidBarcodeError);
      expect(() => parseBarcode(INVALID_BARCODES.tooLong)).toThrow(/Expected 24 digits, got 25/);
    });

    it('should throw InvalidBarcodeError for barcode containing letters', () => {
      expect(() => parseBarcode(INVALID_BARCODES.containsLetters)).toThrow(InvalidBarcodeError);
    });

    it('should throw InvalidBarcodeError for barcode containing spaces (strict mode)', () => {
      expect(() => parseBarcode(INVALID_BARCODES.containsSpaces)).toThrow(InvalidBarcodeError);
    });

    it('should throw InvalidBarcodeError for barcode containing hyphens (strict mode)', () => {
      expect(() => parseBarcode(INVALID_BARCODES.containsHyphens)).toThrow(InvalidBarcodeError);
    });

    it('should throw InvalidBarcodeError for empty string', () => {
      expect(() => parseBarcode(INVALID_BARCODES.empty)).toThrow(InvalidBarcodeError);
    });

    it('should throw InvalidBarcodeError for whitespace-only string', () => {
      expect(() => parseBarcode(INVALID_BARCODES.whitespaceOnly)).toThrow(InvalidBarcodeError);
    });

    it('should throw InvalidBarcodeError for barcode with leading space', () => {
      expect(() => parseBarcode(INVALID_BARCODES.leadingSpace)).toThrow(InvalidBarcodeError);
    });

    it('should throw InvalidBarcodeError for barcode with trailing space', () => {
      expect(() => parseBarcode(INVALID_BARCODES.trailingSpace)).toThrow(InvalidBarcodeError);
    });

    it('should throw for non-string input (null)', () => {
      expect(() => parseBarcode(null as unknown as string)).toThrow(InvalidBarcodeError);
      expect(() => parseBarcode(null as unknown as string)).toThrow(/must be a string/);
    });

    it('should throw for non-string input (undefined)', () => {
      expect(() => parseBarcode(undefined as unknown as string)).toThrow(InvalidBarcodeError);
    });

    it('should throw for non-string input (number)', () => {
      // Use a safe integer to avoid precision loss while still testing non-string behavior
      expect(() => parseBarcode(12345678901234 as unknown as string)).toThrow(InvalidBarcodeError);
    });
  });

  describe('Lenient Mode (allowCleaning: true)', () => {
    it('should parse barcode with spaces when allowCleaning is true', () => {
      const result = parseBarcode('0001 1234567 025 3456789012', { allowCleaning: true });

      expect(result.game_code).toBe('0001');
      expect(result.pack_number).toBe('1234567');
      expect(result.serial_start).toBe('025');
      expect(result.identifier).toBe('3456789012');
    });

    it('should parse barcode with hyphens when allowCleaning is true', () => {
      const result = parseBarcode('0001-1234567-025-3456789012', { allowCleaning: true });

      expect(result.game_code).toBe('0001');
      expect(result.pack_number).toBe('1234567');
      expect(result.serial_start).toBe('025');
    });

    it('should parse barcode with mixed separators when allowCleaning is true', () => {
      const result = parseBarcode('0001 1234567-025-3456789012', { allowCleaning: true });

      expect(result.game_code).toBe('0001');
      expect(result.is_valid).toBe(true);
    });

    it('should still reject letters even in lenient mode', () => {
      expect(() => parseBarcode('0001-ABC4567-025-3456789012', { allowCleaning: true })).toThrow(
        InvalidBarcodeError
      );
    });

    it('should still reject wrong length after cleaning', () => {
      expect(() => parseBarcode('0001-1234567-025-34567890', { allowCleaning: true })).toThrow(
        InvalidBarcodeError
      );
    });
  });

  describe('Error Class Validation', () => {
    it('should throw error with correct name property', () => {
      try {
        parseBarcode('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidBarcodeError);
        expect((error as InvalidBarcodeError).name).toBe('InvalidBarcodeError');
      }
    });

    it('should throw error that extends Error', () => {
      try {
        parseBarcode('invalid');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should include invalid input in error', () => {
      try {
        parseBarcode('bad_barcode');
      } catch (error) {
        expect((error as InvalidBarcodeError).invalidInput).toBe('bad_barcode');
      }
    });
  });
});

// ============================================================================
// tryParseBarcode Tests
// ============================================================================

describe('tryParseBarcode', () => {
  it('should return ParsedBarcode for valid input', () => {
    const result = tryParseBarcode(VALID_BARCODES.standard);

    expect(result).not.toBeNull();
    expect(result!.game_code).toBe('0001');
    expect(result!.is_valid).toBe(true);
  });

  it('should return null for invalid input (no throw)', () => {
    const result = tryParseBarcode('invalid');
    expect(result).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(tryParseBarcode('')).toBeNull();
  });

  it('should return null for null input', () => {
    expect(tryParseBarcode(null as unknown as string)).toBeNull();
  });

  it('should respect allowCleaning option', () => {
    const strict = tryParseBarcode('0001-1234567-025-3456789012');
    const lenient = tryParseBarcode('0001-1234567-025-3456789012', { allowCleaning: true });

    expect(strict).toBeNull();
    expect(lenient).not.toBeNull();
    expect(lenient!.game_code).toBe('0001');
  });
});

// ============================================================================
// isValidBarcode Tests
// ============================================================================

describe('isValidBarcode', () => {
  describe('Valid Barcodes', () => {
    it('should return true for valid 24-digit barcode', () => {
      expect(isValidBarcode(VALID_BARCODES.standard)).toBe(true);
    });

    it('should return true for barcode with all zeros', () => {
      expect(isValidBarcode(VALID_BARCODES.allZeros)).toBe(true);
    });

    it('should return true for barcode with all nines', () => {
      expect(isValidBarcode(VALID_BARCODES.allNines)).toBe(true);
    });
  });

  describe('Invalid Barcodes', () => {
    it('should return false for barcode too short', () => {
      expect(isValidBarcode(INVALID_BARCODES.tooShort)).toBe(false);
    });

    it('should return false for barcode too long', () => {
      expect(isValidBarcode(INVALID_BARCODES.tooLong)).toBe(false);
    });

    it('should return false for barcode containing letters', () => {
      expect(isValidBarcode(INVALID_BARCODES.containsLetters)).toBe(false);
    });

    it('should return false for barcode containing spaces (strict mode)', () => {
      expect(isValidBarcode(INVALID_BARCODES.containsSpaces)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isValidBarcode(INVALID_BARCODES.empty)).toBe(false);
    });

    it('should return false for whitespace-only string', () => {
      expect(isValidBarcode(INVALID_BARCODES.whitespaceOnly)).toBe(false);
    });

    it('should return false for null input', () => {
      expect(isValidBarcode(null as unknown as string)).toBe(false);
    });

    it('should return false for undefined input', () => {
      expect(isValidBarcode(undefined as unknown as string)).toBe(false);
    });
  });

  describe('Lenient Mode', () => {
    it('should return true for barcode with spaces when allowCleaning is true', () => {
      expect(isValidBarcode('0001 1234567 025 3456789012', { allowCleaning: true })).toBe(true);
    });

    it('should return true for barcode with hyphens when allowCleaning is true', () => {
      expect(isValidBarcode('0001-1234567-025-3456789012', { allowCleaning: true })).toBe(true);
    });
  });

  describe('Boundary Testing', () => {
    it('should return false for 23 digits', () => {
      expect(isValidBarcode('0'.repeat(23))).toBe(false);
    });

    it('should return true for exactly 24 digits', () => {
      expect(isValidBarcode('0'.repeat(24))).toBe(true);
    });

    it('should return false for 25 digits', () => {
      expect(isValidBarcode('0'.repeat(25))).toBe(false);
    });
  });
});

// ============================================================================
// validateBarcode Tests
// ============================================================================

describe('validateBarcode', () => {
  it('should return valid result for correct barcode', () => {
    const result = validateBarcode(VALID_BARCODES.standard);

    expect(result.valid).toBe(true);
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.game_code).toBe('0001');
    expect(result.error).toBeUndefined();
  });

  it('should return error for empty barcode', () => {
    const result = validateBarcode('');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Barcode is required');
    expect(result.parsed).toBeUndefined();
  });

  it('should return error for null input', () => {
    const result = validateBarcode(null as unknown as string);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Barcode is required');
  });

  it('should return error for wrong length', () => {
    const result = validateBarcode('12345678901234567890');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('24 digits');
    expect(result.error).toContain('got 20');
  });

  it('should return error for non-digit characters', () => {
    const result = validateBarcode('0001ABCD567000123456789O');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Barcode must contain only digits');
  });

  it('should respect allowCleaning option', () => {
    const result = validateBarcode('0001-1234567-025-3456789012', { allowCleaning: true });

    expect(result.valid).toBe(true);
    expect(result.parsed!.game_code).toBe('0001');
  });
});

// ============================================================================
// Extraction Functions Tests
// ============================================================================

describe('extractGameCode', () => {
  it('should extract game code from valid barcode', () => {
    expect(extractGameCode(VALID_BARCODES.standard)).toBe('0001');
  });

  it('should extract game code with all zeros', () => {
    expect(extractGameCode(VALID_BARCODES.allZeros)).toBe('0000');
  });

  it('should extract game code with all nines', () => {
    expect(extractGameCode(VALID_BARCODES.allNines)).toBe('9999');
  });

  it('should return null for invalid barcode', () => {
    expect(extractGameCode(INVALID_BARCODES.tooShort)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractGameCode(INVALID_BARCODES.empty)).toBeNull();
  });

  it('should respect allowCleaning option', () => {
    expect(extractGameCode('0001-1234567-025-3456789012', { allowCleaning: true })).toBe('0001');
  });
});

describe('extractPackNumber', () => {
  it('should extract pack number from valid barcode', () => {
    expect(extractPackNumber(VALID_BARCODES.standard)).toBe('1234567');
  });

  it('should extract pack number with all zeros', () => {
    expect(extractPackNumber(VALID_BARCODES.allZeros)).toBe('0000000');
  });

  it('should extract pack number with all nines', () => {
    expect(extractPackNumber(VALID_BARCODES.allNines)).toBe('9999999');
  });

  it('should return null for invalid barcode', () => {
    expect(extractPackNumber(INVALID_BARCODES.tooShort)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractPackNumber(INVALID_BARCODES.empty)).toBeNull();
  });
});

describe('extractSerialStart', () => {
  it('should extract serial start from valid barcode', () => {
    expect(extractSerialStart(VALID_BARCODES.standard)).toBe('025');
  });

  it('should extract serial start with zeros (new pack)', () => {
    expect(extractSerialStart(VALID_BARCODES.newPack)).toBe('000');
  });

  it('should extract serial start mid-range', () => {
    expect(extractSerialStart(VALID_BARCODES.midPack)).toBe('150');
  });

  it('should extract serial start near end', () => {
    expect(extractSerialStart(VALID_BARCODES.nearEnd)).toBe('299');
  });

  it('should return null for invalid barcode', () => {
    expect(extractSerialStart(INVALID_BARCODES.tooShort)).toBeNull();
  });

  it('should preserve leading zeros (000 not 0)', () => {
    const result = extractSerialStart(VALID_BARCODES.newPack);
    expect(result).toBe('000');
    expect(result!.length).toBe(3);
  });
});

describe('extractIdentifier', () => {
  it('should extract identifier from valid barcode', () => {
    expect(extractIdentifier(VALID_BARCODES.standard)).toBe('3456789012');
  });

  it('should extract identifier with all zeros', () => {
    expect(extractIdentifier(VALID_BARCODES.allZeros)).toBe('0000000000');
  });

  it('should return null for invalid barcode', () => {
    expect(extractIdentifier(INVALID_BARCODES.tooShort)).toBeNull();
  });
});

// ============================================================================
// Batch Processing Tests
// ============================================================================

describe('parseBarcodes', () => {
  it('should parse multiple valid barcodes', () => {
    const barcodes = [VALID_BARCODES.standard, VALID_BARCODES.allZeros];
    const result = parseBarcodes(barcodes);

    expect(result.parsed.length).toBe(2);
    expect(result.errors.length).toBe(0);
  });

  it('should separate valid and invalid barcodes', () => {
    const barcodes = [
      VALID_BARCODES.standard, // valid
      'invalid', // invalid
      VALID_BARCODES.allNines, // valid
    ];
    const result = parseBarcodes(barcodes);

    expect(result.parsed.length).toBe(2);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[0].raw).toBe('invalid');
  });

  it('should handle empty array', () => {
    const result = parseBarcodes([]);
    expect(result.parsed.length).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  it('should handle all invalid barcodes', () => {
    const result = parseBarcodes(['invalid1', 'invalid2']);

    expect(result.parsed.length).toBe(0);
    expect(result.errors.length).toBe(2);
  });

  it('should respect allowCleaning option', () => {
    const barcodes = ['0001-1234567-025-3456789012'];

    const strictResult = parseBarcodes(barcodes);
    expect(strictResult.parsed.length).toBe(0);
    expect(strictResult.errors.length).toBe(1);

    const lenientResult = parseBarcodes(barcodes, { allowCleaning: true });
    expect(lenientResult.parsed.length).toBe(1);
    expect(lenientResult.errors.length).toBe(0);
  });

  it('should include correct error messages', () => {
    const result = parseBarcodes(['123']); // too short

    expect(result.errors[0].error).toContain('24 digits');
  });
});

describe('deduplicateBarcodes', () => {
  it('should remove duplicate pack numbers', () => {
    const barcodes: ParsedBarcode[] = [
      parseBarcode(VALID_BARCODES.standard), // Pack 1234567
      parseBarcode('000112345670153456789012'), // Same pack, different serial
      parseBarcode('000298765430003456789012'), // Different pack
    ];

    const result = deduplicateBarcodes(barcodes);

    expect(result.length).toBe(2);
    expect(result[0].pack_number).toBe('1234567');
    expect(result[1].pack_number).toBe('9876543');
  });

  it('should keep first occurrence of duplicate', () => {
    const barcodes: ParsedBarcode[] = [
      parseBarcode('000112345670003456789012'), // serial_start: 000
      parseBarcode('000112345670153456789012'), // serial_start: 015
    ];

    const result = deduplicateBarcodes(barcodes);

    expect(result.length).toBe(1);
    expect(result[0].serial_start).toBe('000'); // First one kept
  });

  it('should handle empty array', () => {
    const result = deduplicateBarcodes([]);
    expect(result.length).toBe(0);
  });

  it('should handle array with no duplicates', () => {
    const barcodes: ParsedBarcode[] = [
      parseBarcode('000112345670003456789012'),
      parseBarcode('000298765430003456789012'),
      parseBarcode('000311111110003456789012'),
    ];

    const result = deduplicateBarcodes(barcodes);
    expect(result.length).toBe(3);
  });
});

// ============================================================================
// Serial Start Utility Tests
// ============================================================================

describe('isValidSerialStart', () => {
  it('should return true for valid 3-digit serials', () => {
    expect(isValidSerialStart('000')).toBe(true);
    expect(isValidSerialStart('025')).toBe(true);
    expect(isValidSerialStart('150')).toBe(true);
    expect(isValidSerialStart('999')).toBe(true);
  });

  it('should return false for invalid serials', () => {
    expect(isValidSerialStart('')).toBe(false);
    expect(isValidSerialStart('25')).toBe(false); // Too short
    expect(isValidSerialStart('1234')).toBe(false); // Too long
    expect(isValidSerialStart('abc')).toBe(false);
    expect(isValidSerialStart('12a')).toBe(false);
  });
});

describe('parseSerialStart', () => {
  it('should parse valid 3-digit serials to numbers', () => {
    expect(parseSerialStart('000')).toBe(0);
    expect(parseSerialStart('025')).toBe(25);
    expect(parseSerialStart('150')).toBe(150);
    expect(parseSerialStart('999')).toBe(999);
  });

  it('should return null for invalid serials', () => {
    expect(parseSerialStart('')).toBeNull();
    expect(parseSerialStart('25')).toBeNull();
    expect(parseSerialStart('abc')).toBeNull();
  });
});

describe('formatSerialStart', () => {
  it('should format numbers with leading zeros', () => {
    expect(formatSerialStart(0)).toBe('000');
    expect(formatSerialStart(7)).toBe('007');
    expect(formatSerialStart(25)).toBe('025');
    expect(formatSerialStart(150)).toBe('150');
    expect(formatSerialStart(999)).toBe('999');
  });

  it('should return null for invalid values', () => {
    expect(formatSerialStart(-1)).toBeNull();
    expect(formatSerialStart(1000)).toBeNull();
    expect(formatSerialStart(12.5)).toBeNull();
    expect(formatSerialStart(NaN)).toBeNull();
  });
});

// ============================================================================
// Constants and Regex Tests
// ============================================================================

describe('Constants', () => {
  it('should export BARCODE_LENGTH as 24', () => {
    expect(BARCODE_LENGTH).toBe(24);
  });

  it('should export BARCODE_REGEX that matches exactly 24 digits', () => {
    expect(BARCODE_REGEX.test('0'.repeat(24))).toBe(true);
    expect(BARCODE_REGEX.test('0'.repeat(23))).toBe(false);
    expect(BARCODE_REGEX.test('0'.repeat(25))).toBe(false);
  });
});

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('Integration Scenarios', () => {
  describe('Day Close Scanner Flow', () => {
    it('should parse scanner output format correctly', () => {
      const scannerOutput = '000112345670150000000000';
      const result = parseBarcode(scannerOutput);

      expect(result.game_code).toBe('0001');
      expect(result.pack_number).toBe('1234567');
      expect(result.serial_start).toBe('015');
    });

    it('should validate before parsing in a pipeline', () => {
      const input = '000112345670150000000000';

      const isValid = isValidBarcode(input);
      expect(isValid).toBe(true);

      if (isValid) {
        const result = parseBarcode(input);
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

      const results = serials.map((serial) => parseBarcode(serial));

      expect(results).toHaveLength(5);
      expect(results[0].game_code).toBe('0001');
      expect(results[1].game_code).toBe('0002');
      expect(results[2].game_code).toBe('0003');
      expect(results[3].game_code).toBe('0004');
      expect(results[4].game_code).toBe('0005');
    });
  });

  describe('BIZ-010: Onboarding Flow', () => {
    it('should extract serial_start for partially sold packs', () => {
      // Barcode from pack with 25 tickets already sold
      const barcode = '000112345670253456789012';
      const result = parseBarcode(barcode);

      expect(result.serial_start).toBe('025');
      expect(parseSerialStart(result.serial_start)).toBe(25);
    });

    it('should handle new pack (serial_start = 000)', () => {
      const barcode = '000112345670003456789012';
      const result = parseBarcode(barcode);

      expect(result.serial_start).toBe('000');
      expect(parseSerialStart(result.serial_start)).toBe(0);
    });

    it('should handle near-end pack (serial_start = 299)', () => {
      const barcode = '000112345672993456789012';
      const result = parseBarcode(barcode);

      expect(result.serial_start).toBe('299');
      expect(parseSerialStart(result.serial_start)).toBe(299);
    });
  });

  describe('Pack Reception Flow', () => {
    it('should parse pack reception barcode correctly', () => {
      const barcode = '125656789010000000000000';
      const result = parseBarcode(barcode);

      expect(result.game_code).toBe('1256');
      expect(result.pack_number).toBe('5678901');
      expect(result.serial_start).toBe('000');
    });
  });
});

// ============================================================================
// Security Validation Tests
// ============================================================================

describe('SEC-014: Security Validation', () => {
  describe('SQL Injection Prevention', () => {
    it.each(SQL_INJECTION_PAYLOADS)('should reject SQL injection payload: %s', (payload) => {
      expect(() => parseBarcode(payload)).toThrow(InvalidBarcodeError);
      expect(isValidBarcode(payload)).toBe(false);
    });

    it('should not execute SQL injection in extracted fields', () => {
      // Even if someone tries injection, the strict validation prevents it
      const malicious = "'; DROP TABLE--000000000";

      expect(() => parseBarcode(malicious)).toThrow(InvalidBarcodeError);
    });
  });

  describe('XSS Injection Prevention', () => {
    it.each(XSS_INJECTION_PAYLOADS)('should reject XSS injection payload: %s', (payload) => {
      expect(() => parseBarcode(payload)).toThrow(InvalidBarcodeError);
      expect(isValidBarcode(payload)).toBe(false);
    });
  });

  describe('Command Injection Prevention', () => {
    it.each(COMMAND_INJECTION_PAYLOADS)(
      'should reject command injection payload: %s',
      (payload) => {
        expect(() => parseBarcode(payload)).toThrow(InvalidBarcodeError);
      }
    );
  });

  describe('Path Traversal Prevention', () => {
    it('should reject path traversal attempts', () => {
      const pathTraversal = '../../etc/passwd00000000';
      expect(() => parseBarcode(pathTraversal)).toThrow(InvalidBarcodeError);
    });
  });

  describe('Null Byte Injection Prevention', () => {
    it('should reject null byte injection', () => {
      const nullByte = '000112345670123456789\x00012';
      expect(() => parseBarcode(nullByte)).toThrow(InvalidBarcodeError);
    });
  });

  describe('Template Literal Injection Prevention', () => {
    it('should not perform any string interpolation on input', () => {
      const templateLiteral = '${process.env.SECRET}000';
      expect(() => parseBarcode(templateLiteral)).toThrow(InvalidBarcodeError);
    });
  });

  describe('Unicode Injection Prevention', () => {
    it('should reject Unicode digit lookalikes', () => {
      // Arabic-Indic digits (looks like 0-9 but different Unicode)
      const arabicDigits = '٠٠٠١١٢٣٤٥٦٧٠٢٥٣٤٥٦٧٨٩٠١٢';
      expect(() => parseBarcode(arabicDigits)).toThrow(InvalidBarcodeError);
    });

    it('should reject fullwidth digits', () => {
      const fullwidth = '０００１１２３４５６７０２５３４５６７８９０１２';
      expect(() => parseBarcode(fullwidth)).toThrow(InvalidBarcodeError);
    });
  });

  describe('DoS Prevention', () => {
    it('should handle very long strings efficiently', () => {
      const longString = '0'.repeat(10000);
      const start = performance.now();

      expect(() => parseBarcode(longString)).toThrow(InvalidBarcodeError);

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(100); // Should complete in < 100ms
    });

    it('should reject without catastrophic backtracking', () => {
      // Pattern designed to cause regex backtracking
      const malicious = 'a'.repeat(50);
      const start = performance.now();

      expect(() => parseBarcode(malicious)).toThrow(InvalidBarcodeError);

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50); // Should complete quickly
    });
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  it('should handle exactly 24 zeros', () => {
    const result = parseBarcode('0'.repeat(24));
    expect(result.is_valid).toBe(true);
    expect(result.game_code).toBe('0000');
  });

  it('should handle exactly 24 nines', () => {
    const result = parseBarcode('9'.repeat(24));
    expect(result.is_valid).toBe(true);
    expect(result.serial_start).toBe('999');
  });

  it('should handle leading zeros in all positions', () => {
    const barcode = '000100000010010000000001';
    const result = parseBarcode(barcode);

    expect(result.game_code).toBe('0001');
    expect(result.pack_number).toBe('0000001');
    expect(result.serial_start).toBe('001');
    expect(result.identifier).toBe('0000000001');
  });

  it('should not trim whitespace automatically in strict mode', () => {
    // Strict mode should reject any whitespace
    expect(() => parseBarcode(' 000112345670253456789012')).toThrow(InvalidBarcodeError);
    expect(() => parseBarcode('000112345670253456789012 ')).toThrow(InvalidBarcodeError);
  });
});

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('Type Safety', () => {
  it('should return correct types for ParsedBarcode', () => {
    const result = parseBarcode(VALID_BARCODES.standard);

    // TypeScript compile-time checks (runtime verification)
    expect(typeof result.raw).toBe('string');
    expect(typeof result.game_code).toBe('string');
    expect(typeof result.pack_number).toBe('string');
    expect(typeof result.serial_start).toBe('string');
    expect(typeof result.identifier).toBe('string');
    expect(typeof result.is_valid).toBe('boolean');
    expect(typeof result.full_serial).toBe('string');
  });

  it('should return correct types for BarcodeValidationResult', () => {
    const validResult = validateBarcode(VALID_BARCODES.standard);
    expect(typeof validResult.valid).toBe('boolean');
    expect(validResult.parsed).toBeDefined();
    expect(validResult.error).toBeUndefined();

    const invalidResult = validateBarcode('invalid');
    expect(typeof invalidResult.valid).toBe('boolean');
    expect(invalidResult.parsed).toBeUndefined();
    expect(typeof invalidResult.error).toBe('string');
  });
});
