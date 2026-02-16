/**
 * Scanner Service
 *
 * Backend wrapper around the centralized barcode parser for lottery pack scanning.
 * Provides service-level logging and batch processing capabilities.
 *
 * @module main/services/scanner
 * @security SEC-014: Input validation for barcode formats
 *
 * @deprecated Direct parsing functions are deprecated. Use the centralized
 * parser from '@shared/lottery/barcode-parser' instead. This module now
 * re-exports the shared parser with service-layer enhancements (logging).
 */

import { createLogger } from '../utils/logger';

// Import from centralized parser
import {
  tryParseBarcode as sharedTryParseBarcode,
  isValidBarcode as sharedIsValidBarcode,
  validateBarcode as sharedValidateBarcode,
  extractGameCode as sharedExtractGameCode,
  extractPackNumber as sharedExtractPackNumber,
  extractSerialStart,
  parseBarcodes as sharedParseBarcodes,
  deduplicateBarcodes as sharedDeduplicateBarcodes,
  BARCODE_LENGTH,
  type ParsedBarcode as SharedParsedBarcode,
  type BatchParseResult,
  type ParseBarcodeOptions,
} from '@shared/lottery/barcode-parser';

// Re-export from shared for consumers who import from this module
export { BARCODE_LENGTH, extractSerialStart, type ParseBarcodeOptions, type BatchParseResult };

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('scanner-service');

// ============================================================================
// Types (Backward Compatible)
// ============================================================================

/**
 * Parsed barcode data from a lottery ticket/pack
 *
 * @property raw - Original raw barcode string
 * @property game_code - 4-digit game code
 * @property pack_number - 7-digit pack number
 * @property serial_start - 3-digit serial start (current ticket position)
 * @property serial_number - @deprecated Use serial_start instead
 * @property check_digit - @deprecated Use identifier instead
 * @property identifier - 10-digit check/validation data
 * @property checksum_valid - Whether the checksum validation passed (always true for valid format)
 * @property full_serial - Full serial for pack reception (game_code + pack_number)
 * @property is_valid - Whether the barcode passed validation
 */
export interface ParsedBarcode {
  /** Original raw barcode string */
  raw: string;
  /** 4-digit game code */
  game_code: string;
  /** 7-digit pack number */
  pack_number: string;
  /**
   * 3-digit serial start (current ticket position)
   * This is the canonical field name - use this in new code
   */
  serial_start: string;
  /**
   * @deprecated Use serial_start instead.
   * This field is kept for backward compatibility.
   */
  serial_number: string;
  /**
   * 10-digit identifier / check data
   * This is the canonical field name - use this in new code
   */
  identifier: string;
  /**
   * @deprecated Use identifier instead.
   * This field is kept for backward compatibility.
   */
  check_digit: string;
  /** Whether the checksum validation passed (always true for valid format) */
  checksum_valid: boolean;
  /** Full serial for pack reception (game_code + pack_number) */
  full_serial: string;
  /** Whether the barcode passed validation */
  is_valid: boolean;
}

/**
 * Validation result for barcode
 */
export interface BarcodeValidationResult {
  valid: boolean;
  error?: string;
  parsed?: ParsedBarcode;
}

// ============================================================================
// Conversion Helpers
// ============================================================================

/**
 * Convert shared ParsedBarcode to service ParsedBarcode (with legacy fields)
 */
function toServiceBarcode(shared: SharedParsedBarcode): ParsedBarcode {
  return {
    raw: shared.raw,
    game_code: shared.game_code,
    pack_number: shared.pack_number,
    serial_start: shared.serial_start,
    // Legacy field aliases for backward compatibility
    serial_number: shared.serial_start,
    identifier: shared.identifier,
    check_digit: shared.identifier,
    // Format validation implies checksum is valid
    checksum_valid: shared.is_valid,
    full_serial: shared.full_serial,
    is_valid: shared.is_valid,
  };
}

// ============================================================================
// Scanner Service Functions
// ============================================================================

/**
 * Parse a lottery barcode into its component parts
 * SEC-014: Validates barcode format before parsing
 *
 * @param raw - Raw barcode string from scanner
 * @returns Parsed barcode data or null if invalid
 *
 * @example
 * const parsed = parseBarcode('100112345670001234567890');
 * if (parsed) {
 *   parsed.game_code;    // '1001'
 *   parsed.pack_number;  // '1234567'
 *   parsed.serial_start; // '000'
 * }
 */
export function parseBarcode(raw: string): ParsedBarcode | null {
  if (!raw || typeof raw !== 'string') {
    log.debug('Invalid barcode input: not a string');
    return null;
  }

  // Use lenient mode to allow whitespace/hyphens (backward compatible behavior)
  const shared = sharedTryParseBarcode(raw, { allowCleaning: true });

  if (!shared) {
    log.debug('Invalid barcode format', { raw: raw.substring(0, 30) });
    return null;
  }

  const parsed = toServiceBarcode(shared);

  log.debug('Barcode parsed', {
    gameCode: parsed.game_code,
    packNumber: parsed.pack_number,
    serialStart: parsed.serial_start,
    checksumValid: parsed.checksum_valid,
  });

  return parsed;
}

/**
 * Validate a barcode string
 * SEC-014: Format validation
 *
 * @param raw - Raw barcode string
 * @returns Validation result with error message if invalid
 */
export function validateBarcode(raw: string): BarcodeValidationResult {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, error: 'Barcode is required' };
  }

  const result = sharedValidateBarcode(raw, { allowCleaning: true });

  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  return {
    valid: true,
    parsed: result.parsed ? toServiceBarcode(result.parsed) : undefined,
  };
}

/**
 * Check if a string is a valid barcode format
 * Quick validation without full parsing
 *
 * @param raw - Raw barcode string
 * @returns true if valid format
 */
export function isValidBarcode(raw: string): boolean {
  if (!raw || typeof raw !== 'string') {
    return false;
  }
  // Use lenient mode for backward compatibility
  return sharedIsValidBarcode(raw, { allowCleaning: true });
}

/**
 * Parse a serial number (3 digits)
 * Used for closing serials entered manually
 *
 * @param serial - 3-digit serial string
 * @returns Numeric value or null if invalid
 */
export function parseSerialNumber(serial: string): number | null {
  if (!serial || typeof serial !== 'string') {
    return null;
  }

  const cleaned = serial.trim();

  if (!/^\d{1,3}$/.test(cleaned)) {
    return null;
  }

  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num < 0 || num > 999) {
    return null;
  }

  return num;
}

/**
 * Format a serial number as 3-digit string
 *
 * @param serial - Numeric serial value
 * @returns Zero-padded 3-digit string
 */
export function formatSerialNumber(serial: number): string {
  if (typeof serial !== 'number' || isNaN(serial) || serial < 0 || serial > 999) {
    return '000';
  }
  return serial.toString().padStart(3, '0');
}

/**
 * Extract game code from a barcode
 * Convenience function for quick lookups
 *
 * @param raw - Raw barcode string
 * @returns 4-digit game code or null
 */
export function extractGameCode(raw: string): string | null {
  return sharedExtractGameCode(raw, { allowCleaning: true });
}

/**
 * Extract pack number from a barcode
 * Convenience function for quick lookups
 *
 * @param raw - Raw barcode string
 * @returns 7-digit pack number or null
 */
export function extractPackNumber(raw: string): string | null {
  return sharedExtractPackNumber(raw, { allowCleaning: true });
}

// ============================================================================
// Batch Processing
// ============================================================================

/**
 * Parse multiple barcodes at once
 * Returns successful parses and errors separately
 *
 * @param barcodes - Array of raw barcode strings
 * @returns Object with parsed results and errors
 */
export function parseBarcodes(barcodes: string[]): {
  parsed: ParsedBarcode[];
  errors: Array<{ index: number; raw: string; error: string }>;
} {
  const result = sharedParseBarcodes(barcodes, { allowCleaning: true });

  return {
    parsed: result.parsed.map(toServiceBarcode),
    errors: result.errors,
  };
}

/**
 * Deduplicate barcodes by pack number
 * Keeps first occurrence of each unique pack
 *
 * @param barcodes - Array of parsed barcodes
 * @returns Deduplicated array
 */
export function deduplicateBarcodes(barcodes: ParsedBarcode[]): ParsedBarcode[] {
  // Convert to shared format, deduplicate, convert back
  const sharedBarcodes: SharedParsedBarcode[] = barcodes.map((b) => ({
    raw: b.raw,
    game_code: b.game_code,
    pack_number: b.pack_number,
    serial_start: b.serial_start,
    identifier: b.identifier,
    is_valid: b.is_valid,
    full_serial: b.full_serial,
  }));

  const deduplicated = sharedDeduplicateBarcodes(sharedBarcodes);

  return deduplicated.map(toServiceBarcode);
}
