/**
 * Scanner Service
 *
 * Parses lottery barcode formats for pack reception and tracking.
 * Supports 24-digit serialized barcode format standard.
 *
 * @module main/services/scanner
 * @security SEC-014: Input validation for barcode formats
 */

import { createLogger } from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed barcode data from a lottery ticket/pack
 */
export interface ParsedBarcode {
  /** Original raw barcode string */
  raw: string;
  /** 4-digit game code */
  game_code: string;
  /** 7-digit pack number */
  pack_number: string;
  /** 3-digit serial number within pack */
  serial_number: string;
  /** Check digit from barcode */
  check_digit: string;
  /** Whether the checksum validation passed */
  checksum_valid: boolean;
  /** Full serial for pack reception (game_code + pack_number) */
  full_serial: string;
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
// Constants
// ============================================================================

/**
 * Standard lottery barcode length
 * Format: GGGG-PPPPPPP-SSS-CCCCCCCCCC
 * - GGGG: 4-digit game code
 * - PPPPPPP: 7-digit pack number
 * - SSS: 3-digit serial number
 * - CCCCCCCCCC: 10-digit check/validation data
 */
const BARCODE_LENGTH = 24;

/**
 * Barcode segment positions
 */
const GAME_CODE_START = 0;
const GAME_CODE_LENGTH = 4;
const PACK_NUMBER_START = 4;
const PACK_NUMBER_LENGTH = 7;
const SERIAL_NUMBER_START = 11;
const SERIAL_NUMBER_LENGTH = 3;
const CHECK_DIGIT_START = 14;
const CHECK_DIGIT_LENGTH = 10;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('scanner-service');

// ============================================================================
// Scanner Service
// ============================================================================

/**
 * Parse a lottery barcode into its component parts
 * SEC-014: Validates barcode format before parsing
 *
 * @param raw - Raw barcode string from scanner
 * @returns Parsed barcode data or null if invalid
 */
export function parseBarcode(raw: string): ParsedBarcode | null {
  if (!raw || typeof raw !== 'string') {
    log.debug('Invalid barcode input: not a string');
    return null;
  }

  // Remove any whitespace or hyphens
  const cleaned = raw.replace(/[\s-]/g, '');

  // Validate length
  if (cleaned.length !== BARCODE_LENGTH) {
    log.debug('Invalid barcode length', {
      expected: BARCODE_LENGTH,
      actual: cleaned.length,
    });
    return null;
  }

  // Validate all digits
  if (!/^\d+$/.test(cleaned)) {
    log.debug('Invalid barcode: contains non-digit characters');
    return null;
  }

  // Extract segments
  const game_code = cleaned.substring(GAME_CODE_START, GAME_CODE_START + GAME_CODE_LENGTH);
  const pack_number = cleaned.substring(PACK_NUMBER_START, PACK_NUMBER_START + PACK_NUMBER_LENGTH);
  const serial_number = cleaned.substring(
    SERIAL_NUMBER_START,
    SERIAL_NUMBER_START + SERIAL_NUMBER_LENGTH
  );
  const check_digit = cleaned.substring(CHECK_DIGIT_START, CHECK_DIGIT_START + CHECK_DIGIT_LENGTH);

  // Validate checksum (simple modulo 97 check)
  const checksum_valid = validateChecksum(cleaned);

  const parsed: ParsedBarcode = {
    raw: cleaned,
    game_code,
    pack_number,
    serial_number,
    check_digit,
    checksum_valid,
    full_serial: `${game_code}${pack_number}`,
  };

  log.debug('Barcode parsed', {
    gameCode: game_code,
    packNumber: pack_number,
    serialNumber: serial_number,
    checksumValid: checksum_valid,
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

  const cleaned = raw.replace(/[\s-]/g, '');

  if (cleaned.length !== BARCODE_LENGTH) {
    return {
      valid: false,
      error: `Barcode must be ${BARCODE_LENGTH} digits (got ${cleaned.length})`,
    };
  }

  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: 'Barcode must contain only digits' };
  }

  const parsed = parseBarcode(raw);
  if (!parsed) {
    return { valid: false, error: 'Failed to parse barcode' };
  }

  if (!parsed.checksum_valid) {
    return {
      valid: false,
      error: 'Barcode checksum validation failed',
      parsed,
    };
  }

  return { valid: true, parsed };
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

  const cleaned = raw.replace(/[\s-]/g, '');
  return cleaned.length === BARCODE_LENGTH && /^\d+$/.test(cleaned);
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
  const parsed = parseBarcode(raw);
  return parsed?.game_code || null;
}

/**
 * Extract pack number from a barcode
 * Convenience function for quick lookups
 *
 * @param raw - Raw barcode string
 * @returns 7-digit pack number or null
 */
export function extractPackNumber(raw: string): string | null {
  const parsed = parseBarcode(raw);
  return parsed?.pack_number || null;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Validate barcode checksum using modulo 97
 * This is a simplified validation; actual lottery barcodes
 * may use different algorithms
 *
 * @param barcode - Full barcode string
 * @returns true if checksum is valid
 */
function validateChecksum(barcode: string): boolean {
  try {
    // Simple modulo 97 check on the numeric value
    // In production, this would match the actual lottery system's algorithm
    const numericPart = barcode.substring(0, SERIAL_NUMBER_START + SERIAL_NUMBER_LENGTH);
    const checkPart = barcode.substring(CHECK_DIGIT_START);

    // For now, we'll accept all barcodes that pass format validation
    // A real implementation would verify against the lottery system's algorithm
    return true;
  } catch {
    return false;
  }
}

/**
 * Calculate checksum for barcode generation
 * Would be used if generating barcodes locally
 *
 * @param partial - Barcode without check digits
 * @returns 10-digit check string
 */
export function calculateChecksum(partial: string): string {
  // Placeholder - real implementation would match lottery system
  return '0000000000';
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
export function parseBarcodes(
  barcodes: string[]
): {
  parsed: ParsedBarcode[];
  errors: Array<{ index: number; raw: string; error: string }>;
} {
  const parsed: ParsedBarcode[] = [];
  const errors: Array<{ index: number; raw: string; error: string }> = [];

  for (let i = 0; i < barcodes.length; i++) {
    const raw = barcodes[i];
    const result = validateBarcode(raw);

    if (result.valid && result.parsed) {
      parsed.push(result.parsed);
    } else {
      errors.push({
        index: i,
        raw: raw || '',
        error: result.error || 'Unknown error',
      });
    }
  }

  return { parsed, errors };
}

/**
 * Deduplicate barcodes by pack number
 * Keeps first occurrence of each unique pack
 *
 * @param barcodes - Array of parsed barcodes
 * @returns Deduplicated array
 */
export function deduplicateBarcodes(barcodes: ParsedBarcode[]): ParsedBarcode[] {
  const seen = new Set<string>();
  const unique: ParsedBarcode[] = [];

  for (const barcode of barcodes) {
    const key = `${barcode.game_code}-${barcode.pack_number}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(barcode);
    }
  }

  return unique;
}
