/**
 * Scanner Service Unit Tests
 *
 * Tests for lottery barcode parsing functionality.
 * Validates 24-digit serialized barcode format parsing.
 *
 * @module tests/unit/services/scanner
 */

import { describe, it, expect } from 'vitest';
import {
  parseBarcode,
  validateBarcode,
  isValidBarcode,
  parseSerialNumber,
  formatSerialNumber,
  extractGameCode,
  extractPackNumber,
  parseBarcodes,
  deduplicateBarcodes,
  type ParsedBarcode,
} from '../../../src/main/services/scanner.service';

describe('Scanner Service', () => {
  describe('parseBarcode', () => {
    it('should parse a valid 24-digit barcode', () => {
      const barcode = '100112345670001234567890';
      const result = parseBarcode(barcode);

      expect(result).not.toBeNull();
      expect(result?.game_code).toBe('1001');
      expect(result?.pack_number).toBe('1234567');
      expect(result?.serial_number).toBe('000');
      expect(result?.check_digit).toBe('1234567890');
      expect(result?.full_serial).toBe('10011234567');
      expect(result?.raw).toBe(barcode);
    });

    it('should handle barcode with whitespace', () => {
      const barcode = '1001 1234567 000 1234567890';
      const result = parseBarcode(barcode);

      expect(result).not.toBeNull();
      expect(result?.game_code).toBe('1001');
    });

    it('should handle barcode with hyphens', () => {
      const barcode = '1001-1234567-000-1234567890';
      const result = parseBarcode(barcode);

      expect(result).not.toBeNull();
      expect(result?.game_code).toBe('1001');
    });

    it('should return null for barcode with wrong length', () => {
      const shortBarcode = '123456789012345678901'; // 21 digits
      expect(parseBarcode(shortBarcode)).toBeNull();

      const longBarcode = '12345678901234567890123456'; // 26 digits
      expect(parseBarcode(longBarcode)).toBeNull();
    });

    it('should return null for barcode with non-digit characters', () => {
      const alphaBarcode = '1001ABC4567000123456789O';
      expect(parseBarcode(alphaBarcode)).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseBarcode('')).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      expect(parseBarcode(null as unknown as string)).toBeNull();
      expect(parseBarcode(undefined as unknown as string)).toBeNull();
    });
  });

  describe('validateBarcode', () => {
    it('should return valid result for correct barcode', () => {
      const barcode = '100112345670001234567890';
      const result = validateBarcode(barcode);

      expect(result.valid).toBe(true);
      expect(result.parsed).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it('should return error for empty barcode', () => {
      const result = validateBarcode('');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Barcode is required');
    });

    it('should return error for wrong length', () => {
      const result = validateBarcode('12345678901234567890');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('24 digits');
    });

    it('should return error for non-digit characters', () => {
      const result = validateBarcode('1001ABCD567000123456789O');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Barcode must contain only digits');
    });
  });

  describe('isValidBarcode', () => {
    it('should return true for valid barcode format', () => {
      expect(isValidBarcode('100112345670001234567890')).toBe(true);
    });

    it('should return true for barcode with whitespace/hyphens', () => {
      expect(isValidBarcode('1001-1234567-000-1234567890')).toBe(true);
      expect(isValidBarcode('1001 1234567 000 1234567890')).toBe(true);
    });

    it('should return false for invalid barcodes', () => {
      expect(isValidBarcode('')).toBe(false);
      expect(isValidBarcode('123')).toBe(false);
      expect(isValidBarcode('abcd12345670001234567890')).toBe(false);
    });
  });

  describe('parseSerialNumber', () => {
    it('should parse valid 3-digit serial', () => {
      expect(parseSerialNumber('000')).toBe(0);
      expect(parseSerialNumber('001')).toBe(1);
      expect(parseSerialNumber('150')).toBe(150);
      expect(parseSerialNumber('999')).toBe(999);
    });

    it('should parse 1-2 digit serials', () => {
      expect(parseSerialNumber('0')).toBe(0);
      expect(parseSerialNumber('5')).toBe(5);
      expect(parseSerialNumber('50')).toBe(50);
    });

    it('should handle leading whitespace', () => {
      expect(parseSerialNumber('  025')).toBe(25);
      expect(parseSerialNumber('100  ')).toBe(100);
    });

    it('should return null for invalid serials', () => {
      expect(parseSerialNumber('')).toBeNull();
      expect(parseSerialNumber('abc')).toBeNull();
      expect(parseSerialNumber('1000')).toBeNull(); // > 999
      expect(parseSerialNumber('-1')).toBeNull();
    });

    it('should return null for null/undefined input', () => {
      expect(parseSerialNumber(null as unknown as string)).toBeNull();
      expect(parseSerialNumber(undefined as unknown as string)).toBeNull();
    });
  });

  describe('formatSerialNumber', () => {
    it('should format serial with leading zeros', () => {
      expect(formatSerialNumber(0)).toBe('000');
      expect(formatSerialNumber(1)).toBe('001');
      expect(formatSerialNumber(25)).toBe('025');
      expect(formatSerialNumber(150)).toBe('150');
      expect(formatSerialNumber(999)).toBe('999');
    });

    it('should return 000 for invalid input', () => {
      expect(formatSerialNumber(-1)).toBe('000');
      expect(formatSerialNumber(1000)).toBe('000');
      expect(formatSerialNumber(NaN)).toBe('000');
    });
  });

  describe('extractGameCode', () => {
    it('should extract game code from valid barcode', () => {
      expect(extractGameCode('100112345670001234567890')).toBe('1001');
      expect(extractGameCode('200298765430001234567890')).toBe('2002');
    });

    it('should return null for invalid barcode', () => {
      expect(extractGameCode('')).toBeNull();
      expect(extractGameCode('invalid')).toBeNull();
    });
  });

  describe('extractPackNumber', () => {
    it('should extract pack number from valid barcode', () => {
      expect(extractPackNumber('100112345670001234567890')).toBe('1234567');
      expect(extractPackNumber('200298765430001234567890')).toBe('9876543');
    });

    it('should return null for invalid barcode', () => {
      expect(extractPackNumber('')).toBeNull();
      expect(extractPackNumber('invalid')).toBeNull();
    });
  });

  describe('parseBarcodes', () => {
    it('should parse multiple valid barcodes', () => {
      const barcodes = ['100112345670001234567890', '200298765430001234567890'];
      const result = parseBarcodes(barcodes);

      expect(result.parsed.length).toBe(2);
      expect(result.errors.length).toBe(0);
    });

    it('should separate valid and invalid barcodes', () => {
      const barcodes = [
        '100112345670001234567890', // valid
        'invalid', // invalid
        '200298765430001234567890', // valid
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
  });

  describe('deduplicateBarcodes', () => {
    it('should remove duplicate pack numbers', () => {
      const barcodes: ParsedBarcode[] = [
        {
          raw: '100112345670001234567890',
          game_code: '1001',
          pack_number: '1234567',
          serial_start: '000',
          serial_number: '000',
          identifier: '1234567890',
          check_digit: '1234567890',
          checksum_valid: true,
          full_serial: '10011234567',
          is_valid: true,
        },
        {
          raw: '100112345670151234567890', // Same pack, different serial
          game_code: '1001',
          pack_number: '1234567',
          serial_start: '015',
          serial_number: '015',
          identifier: '1234567890',
          check_digit: '1234567890',
          checksum_valid: true,
          full_serial: '10011234567',
          is_valid: true,
        },
        {
          raw: '200298765430001234567890', // Different pack
          game_code: '2002',
          pack_number: '9876543',
          serial_start: '000',
          serial_number: '000',
          identifier: '1234567890',
          check_digit: '1234567890',
          checksum_valid: true,
          full_serial: '20029876543',
          is_valid: true,
        },
      ];

      const result = deduplicateBarcodes(barcodes);

      expect(result.length).toBe(2);
      expect(result[0].pack_number).toBe('1234567');
      expect(result[1].pack_number).toBe('9876543');
    });

    it('should keep first occurrence of duplicate', () => {
      const barcodes: ParsedBarcode[] = [
        {
          raw: '100112345670001234567890',
          game_code: '1001',
          pack_number: '1234567',
          serial_start: '000',
          serial_number: '000',
          identifier: '1234567890',
          check_digit: '1234567890',
          checksum_valid: true,
          full_serial: '10011234567',
          is_valid: true,
        },
        {
          raw: '100112345670151234567890',
          game_code: '1001',
          pack_number: '1234567',
          serial_start: '015',
          serial_number: '015',
          identifier: '1234567890',
          check_digit: '1234567890',
          checksum_valid: true,
          full_serial: '10011234567',
          is_valid: true,
        },
      ];

      const result = deduplicateBarcodes(barcodes);

      expect(result.length).toBe(1);
      expect(result[0].serial_number).toBe('000'); // First one kept
      expect(result[0].serial_start).toBe('000'); // Canonical field
    });

    it('should handle empty array', () => {
      const result = deduplicateBarcodes([]);
      expect(result.length).toBe(0);
    });
  });
});
