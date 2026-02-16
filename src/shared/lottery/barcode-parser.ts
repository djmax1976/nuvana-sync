/**
 * Lottery Barcode Parser - Single Source of Truth
 *
 * Centralized, enterprise-grade barcode parsing for lottery pack operations.
 * This module is the ONLY place where 24-digit barcode parsing should be implemented.
 *
 * @module shared/lottery/barcode-parser
 *
 * ## Barcode Format Specification
 *
 * ```
 * 24-digit format: GGGGPPPPPPPSSSIIIIIIIIII
 *
 * Position  | Length | Field           | Description
 * ----------|--------|-----------------|---------------------------
 * 1-4       | 4      | game_code       | Lottery game identifier
 * 5-11      | 7      | pack_number     | Unique pack identifier
 * 12-14     | 3      | serial_start    | Current ticket position (0-999)
 * 15-24     | 10     | identifier      | Check/validation data
 * ```
 *
 * @example
 * ```typescript
 * // Parse a standard barcode
 * const result = parseBarcode('000112345670253456789012');
 * // result.game_code = '0001'
 * // result.pack_number = '1234567'
 * // result.serial_start = '025'
 * // result.identifier = '3456789012'
 * ```
 *
 * @security SEC-014: INPUT_VALIDATION - All inputs validated with strict regex
 * @see BIZ-010: Onboarding feature uses serial_start from barcode
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * Standard lottery barcode length (24 digits)
 */
export const BARCODE_LENGTH = 24;

/**
 * Barcode segment positions (0-indexed)
 */
export const BARCODE_SEGMENTS = {
  GAME_CODE_START: 0,
  GAME_CODE_LENGTH: 4,
  PACK_NUMBER_START: 4,
  PACK_NUMBER_LENGTH: 7,
  SERIAL_START_START: 11,
  SERIAL_START_LENGTH: 3,
  IDENTIFIER_START: 14,
  IDENTIFIER_LENGTH: 10,
} as const;

/**
 * Strict validation regex: exactly 24 digits, no whitespace or special chars
 * SEC-014: Allowlist pattern for barcode format
 */
export const BARCODE_REGEX = /^\d{24}$/;

/**
 * Regex for cleaning barcodes (removes whitespace and hyphens)
 */
const BARCODE_CLEAN_REGEX = /[\s-]/g;

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed barcode components from a 24-digit lottery barcode
 *
 * @property raw - Original cleaned barcode string (always 24 digits)
 * @property game_code - 4-digit game identifier (positions 1-4)
 * @property pack_number - 7-digit pack identifier (positions 5-11)
 * @property serial_start - 3-digit current ticket position (positions 12-14)
 * @property identifier - 10-digit check/validation data (positions 15-24)
 * @property is_valid - Whether the barcode passed format validation
 */
export interface ParsedBarcode {
  /** Original cleaned barcode string (always 24 digits after cleaning) */
  raw: string;
  /** 4-digit game code (positions 1-4) */
  game_code: string;
  /** 7-digit pack number (positions 5-11) */
  pack_number: string;
  /** 3-digit serial start / current ticket position (positions 12-14) */
  serial_start: string;
  /** 10-digit identifier / check data (positions 15-24) */
  identifier: string;
  /** Whether the barcode passed all validation checks */
  is_valid: boolean;
  /**
   * Full serial for pack matching (game_code + pack_number)
   * Useful for looking up packs in database
   */
  full_serial: string;
}

/**
 * Options for barcode parsing behavior
 */
export interface ParseBarcodeOptions {
  /**
   * If true, cleans whitespace and hyphens before parsing (lenient mode).
   * If false (default), requires exact 24-digit format (strict mode).
   *
   * Strict mode is recommended for user input validation.
   * Lenient mode is useful for scanner output that may include separators.
   */
  allowCleaning?: boolean;
}

/**
 * Result of barcode validation
 */
export interface BarcodeValidationResult {
  /** Whether the barcode is valid */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Parsed barcode data if valid */
  parsed?: ParsedBarcode;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when a barcode fails validation
 *
 * @example
 * ```typescript
 * try {
 *   parseBarcode('invalid');
 * } catch (error) {
 *   if (error instanceof InvalidBarcodeError) {
 *     console.log(error.message); // "Invalid barcode format..."
 *   }
 * }
 * ```
 */
export class InvalidBarcodeError extends Error {
  /** The invalid input that caused the error */
  readonly invalidInput: string;

  constructor(message: string, invalidInput: string = '') {
    super(message);
    this.name = 'InvalidBarcodeError';
    this.invalidInput = invalidInput;
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, InvalidBarcodeError.prototype);
  }
}

// ============================================================================
// Core Parsing Functions
// ============================================================================

/**
 * Parse a 24-digit lottery barcode into its component parts
 *
 * SEC-014: Validates barcode format before parsing using strict regex.
 * Rejects any input that doesn't match exactly 24 numeric digits.
 *
 * @param barcode - Raw barcode string from scanner or user input
 * @param options - Parsing options (default: strict mode)
 * @returns ParsedBarcode with extracted components
 * @throws {InvalidBarcodeError} If barcode format is invalid
 *
 * @example
 * ```typescript
 * // Standard parsing (strict mode)
 * const parsed = parseBarcode('000112345670253456789012');
 * console.log(parsed.game_code);    // '0001'
 * console.log(parsed.pack_number);  // '1234567'
 * console.log(parsed.serial_start); // '025'
 * console.log(parsed.identifier);   // '3456789012'
 *
 * // Lenient mode (allows whitespace/hyphens)
 * const parsed2 = parseBarcode('0001-1234567-025-3456789012', { allowCleaning: true });
 * ```
 *
 * @security SEC-014: INPUT_VALIDATION
 * - Validates exact 24-digit numeric format
 * - Rejects SQL injection, XSS, and other injection payloads
 * - No string interpolation of user input
 */
export function parseBarcode(barcode: string, options: ParseBarcodeOptions = {}): ParsedBarcode {
  const { allowCleaning = false } = options;

  // SEC-014: Validate input is a string
  if (typeof barcode !== 'string') {
    throw new InvalidBarcodeError('Barcode must be a string', String(barcode));
  }

  // Clean if lenient mode is enabled
  const cleaned = allowCleaning ? barcode.replace(BARCODE_CLEAN_REGEX, '') : barcode;

  // SEC-014: Strict format validation - exactly 24 digits
  if (!BARCODE_REGEX.test(cleaned)) {
    if (cleaned.length !== BARCODE_LENGTH) {
      throw new InvalidBarcodeError(
        `Invalid barcode length. Expected ${BARCODE_LENGTH} digits, got ${cleaned.length}.`,
        barcode
      );
    }
    throw new InvalidBarcodeError(
      'Invalid barcode format. Must be exactly 24 numeric digits.',
      barcode
    );
  }

  // Extract components using defined segment positions
  const game_code = cleaned.substring(
    BARCODE_SEGMENTS.GAME_CODE_START,
    BARCODE_SEGMENTS.GAME_CODE_START + BARCODE_SEGMENTS.GAME_CODE_LENGTH
  );

  const pack_number = cleaned.substring(
    BARCODE_SEGMENTS.PACK_NUMBER_START,
    BARCODE_SEGMENTS.PACK_NUMBER_START + BARCODE_SEGMENTS.PACK_NUMBER_LENGTH
  );

  const serial_start = cleaned.substring(
    BARCODE_SEGMENTS.SERIAL_START_START,
    BARCODE_SEGMENTS.SERIAL_START_START + BARCODE_SEGMENTS.SERIAL_START_LENGTH
  );

  const identifier = cleaned.substring(
    BARCODE_SEGMENTS.IDENTIFIER_START,
    BARCODE_SEGMENTS.IDENTIFIER_START + BARCODE_SEGMENTS.IDENTIFIER_LENGTH
  );

  return {
    raw: cleaned,
    game_code,
    pack_number,
    serial_start,
    identifier,
    is_valid: true,
    full_serial: `${game_code}${pack_number}`,
  };
}

/**
 * Try to parse a barcode, returning null instead of throwing on invalid input
 *
 * This is useful when you want to handle invalid barcodes without try/catch.
 *
 * @param barcode - Raw barcode string
 * @param options - Parsing options
 * @returns ParsedBarcode or null if invalid
 *
 * @example
 * ```typescript
 * const parsed = tryParseBarcode(userInput);
 * if (parsed) {
 *   console.log('Valid barcode:', parsed.pack_number);
 * } else {
 *   console.log('Invalid barcode');
 * }
 * ```
 */
export function tryParseBarcode(
  barcode: string,
  options: ParseBarcodeOptions = {}
): ParsedBarcode | null {
  try {
    return parseBarcode(barcode, options);
  } catch {
    return null;
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if a string is a valid barcode format
 *
 * Quick validation without full parsing. Useful for form validation
 * where you just need a boolean result.
 *
 * @param barcode - String to validate
 * @param options - Validation options (same as parsing options)
 * @returns true if valid 24-digit barcode format, false otherwise
 *
 * @example
 * ```typescript
 * // Strict validation (default)
 * isValidBarcode('000112345670253456789012'); // true
 * isValidBarcode('0001-1234567-025-3456789012'); // false (contains hyphens)
 *
 * // Lenient validation (cleans before checking)
 * isValidBarcode('0001-1234567-025-3456789012', { allowCleaning: true }); // true
 * ```
 *
 * @security SEC-014: Does not throw - safe for untrusted input
 */
export function isValidBarcode(barcode: string, options: ParseBarcodeOptions = {}): boolean {
  if (typeof barcode !== 'string') {
    return false;
  }

  const { allowCleaning = false } = options;
  const cleaned = allowCleaning ? barcode.replace(BARCODE_CLEAN_REGEX, '') : barcode;

  return BARCODE_REGEX.test(cleaned);
}

/**
 * Validate a barcode and return detailed result
 *
 * Use this when you need both the validation result and error details.
 *
 * @param barcode - Raw barcode string
 * @param options - Validation options
 * @returns Validation result with parsed data if valid
 *
 * @example
 * ```typescript
 * const result = validateBarcode(userInput);
 * if (result.valid) {
 *   console.log('Pack number:', result.parsed!.pack_number);
 * } else {
 *   console.error('Error:', result.error);
 * }
 * ```
 */
export function validateBarcode(
  barcode: string,
  options: ParseBarcodeOptions = {}
): BarcodeValidationResult {
  if (!barcode || typeof barcode !== 'string') {
    return { valid: false, error: 'Barcode is required' };
  }

  const { allowCleaning = false } = options;
  const cleaned = allowCleaning ? barcode.replace(BARCODE_CLEAN_REGEX, '') : barcode;

  if (cleaned.length !== BARCODE_LENGTH) {
    return {
      valid: false,
      error: `Barcode must be ${BARCODE_LENGTH} digits (got ${cleaned.length})`,
    };
  }

  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: 'Barcode must contain only digits' };
  }

  try {
    const parsed = parseBarcode(barcode, options);
    return { valid: true, parsed };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Failed to parse barcode',
    };
  }
}

// ============================================================================
// Extraction Convenience Functions
// ============================================================================

/**
 * Extract game code from a barcode without full parsing
 *
 * @param barcode - Raw barcode string
 * @param options - Parsing options
 * @returns 4-digit game code or null if invalid barcode
 *
 * @example
 * ```typescript
 * extractGameCode('000112345670253456789012'); // '0001'
 * extractGameCode('invalid'); // null
 * ```
 */
export function extractGameCode(barcode: string, options: ParseBarcodeOptions = {}): string | null {
  const parsed = tryParseBarcode(barcode, options);
  return parsed?.game_code ?? null;
}

/**
 * Extract pack number from a barcode without full parsing
 *
 * @param barcode - Raw barcode string
 * @param options - Parsing options
 * @returns 7-digit pack number or null if invalid barcode
 *
 * @example
 * ```typescript
 * extractPackNumber('000112345670253456789012'); // '1234567'
 * extractPackNumber('invalid'); // null
 * ```
 */
export function extractPackNumber(
  barcode: string,
  options: ParseBarcodeOptions = {}
): string | null {
  const parsed = tryParseBarcode(barcode, options);
  return parsed?.pack_number ?? null;
}

/**
 * Extract serial start (current ticket position) from a barcode
 *
 * This is the key field for the onboarding feature (BIZ-010).
 * The serial_start indicates how many tickets have already been sold.
 *
 * @param barcode - Raw barcode string
 * @param options - Parsing options
 * @returns 3-digit serial start (e.g., '025') or null if invalid barcode
 *
 * @example
 * ```typescript
 * // Pack with 25 tickets already sold
 * extractSerialStart('000112345670253456789012'); // '025'
 *
 * // New pack (no tickets sold)
 * extractSerialStart('000112345670003456789012'); // '000'
 * ```
 */
export function extractSerialStart(
  barcode: string,
  options: ParseBarcodeOptions = {}
): string | null {
  const parsed = tryParseBarcode(barcode, options);
  return parsed?.serial_start ?? null;
}

/**
 * Extract identifier (check data) from a barcode
 *
 * @param barcode - Raw barcode string
 * @param options - Parsing options
 * @returns 10-digit identifier or null if invalid barcode
 *
 * @example
 * ```typescript
 * extractIdentifier('000112345670253456789012'); // '3456789012'
 * ```
 */
export function extractIdentifier(
  barcode: string,
  options: ParseBarcodeOptions = {}
): string | null {
  const parsed = tryParseBarcode(barcode, options);
  return parsed?.identifier ?? null;
}

// ============================================================================
// Batch Processing Functions
// ============================================================================

/**
 * Result of batch barcode parsing
 */
export interface BatchParseResult {
  /** Successfully parsed barcodes */
  parsed: ParsedBarcode[];
  /** Errors encountered during parsing */
  errors: Array<{
    /** Index in original array */
    index: number;
    /** Original barcode string */
    raw: string;
    /** Error message */
    error: string;
  }>;
}

/**
 * Parse multiple barcodes at once
 *
 * Returns successful parses and errors separately, allowing you to
 * process valid barcodes while reporting issues with invalid ones.
 *
 * @param barcodes - Array of raw barcode strings
 * @param options - Parsing options (applied to all barcodes)
 * @returns Object with parsed results and errors
 *
 * @example
 * ```typescript
 * const barcodes = [
 *   '000112345670253456789012', // valid
 *   'invalid',                    // invalid
 *   '000298765430003456789012', // valid
 * ];
 *
 * const result = parseBarcodes(barcodes);
 * console.log(result.parsed.length);  // 2
 * console.log(result.errors.length);  // 1
 * console.log(result.errors[0].index); // 1
 * ```
 */
export function parseBarcodes(
  barcodes: string[],
  options: ParseBarcodeOptions = {}
): BatchParseResult {
  const parsed: ParsedBarcode[] = [];
  const errors: BatchParseResult['errors'] = [];

  for (let i = 0; i < barcodes.length; i++) {
    const raw = barcodes[i];
    const result = validateBarcode(raw, options);

    if (result.valid && result.parsed) {
      parsed.push(result.parsed);
    } else {
      errors.push({
        index: i,
        raw: raw ?? '',
        error: result.error ?? 'Unknown error',
      });
    }
  }

  return { parsed, errors };
}

/**
 * Deduplicate barcodes by pack identity (game_code + pack_number)
 *
 * Keeps the first occurrence of each unique pack. This is useful
 * when the same pack may be scanned multiple times at different
 * ticket positions.
 *
 * @param barcodes - Array of parsed barcodes
 * @returns Deduplicated array (first occurrence of each pack kept)
 *
 * @example
 * ```typescript
 * const barcodes = [
 *   parseBarcode('000112345670003456789012'), // Pack 1234567 at ticket 000
 *   parseBarcode('000112345670153456789012'), // Pack 1234567 at ticket 015
 *   parseBarcode('000298765430003456789012'), // Pack 9876543 at ticket 000
 * ];
 *
 * const unique = deduplicateBarcodes(barcodes);
 * console.log(unique.length); // 2 (first occurrence of each pack)
 * console.log(unique[0].serial_start); // '000' (first scan kept)
 * ```
 */
export function deduplicateBarcodes(barcodes: ParsedBarcode[]): ParsedBarcode[] {
  const seen = new Set<string>();
  const unique: ParsedBarcode[] = [];

  for (const barcode of barcodes) {
    // Use full_serial (game_code + pack_number) as unique key
    const key = barcode.full_serial;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(barcode);
    }
  }

  return unique;
}

// ============================================================================
// Serial Number Utilities
// ============================================================================

/**
 * Validate a 3-digit serial start string
 *
 * SEC-014: Strict validation for serial start field
 *
 * @param serial - Serial string to validate (should be 3 digits)
 * @returns true if valid 3-digit serial (000-999), false otherwise
 *
 * @example
 * ```typescript
 * isValidSerialStart('000'); // true
 * isValidSerialStart('025'); // true
 * isValidSerialStart('999'); // true
 * isValidSerialStart('25');  // false (must be 3 digits)
 * isValidSerialStart('abc'); // false
 * ```
 */
export function isValidSerialStart(serial: string): boolean {
  return /^\d{3}$/.test(serial);
}

/**
 * Parse a serial start string to a numeric value
 *
 * @param serial - 3-digit serial string (e.g., '025')
 * @returns Numeric value (e.g., 25) or null if invalid
 *
 * @example
 * ```typescript
 * parseSerialStart('000'); // 0
 * parseSerialStart('025'); // 25
 * parseSerialStart('999'); // 999
 * parseSerialStart('abc'); // null
 * ```
 */
export function parseSerialStart(serial: string): number | null {
  if (!isValidSerialStart(serial)) {
    return null;
  }
  return parseInt(serial, 10);
}

/**
 * Format a numeric serial value as a 3-digit string with leading zeros
 *
 * @param value - Numeric serial value (0-999)
 * @returns 3-digit string (e.g., '025') or null if out of range
 *
 * @example
 * ```typescript
 * formatSerialStart(0);   // '000'
 * formatSerialStart(25);  // '025'
 * formatSerialStart(150); // '150'
 * formatSerialStart(999); // '999'
 * formatSerialStart(1000); // null (out of range)
 * formatSerialStart(-1);   // null (out of range)
 * ```
 */
export function formatSerialStart(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 999) {
    return null;
  }
  return value.toString().padStart(3, '0');
}

// ============================================================================
// Legacy Compatibility Exports
// ============================================================================

/**
 * Legacy ParsedSerialNumber type for compatibility
 * @deprecated Use `ParsedBarcode` from this module instead
 */
export interface ParsedSerialNumber {
  game_code: string;
  pack_number: string;
  serial_start: string;
}

/**
 * Error thrown when serial number format is invalid
 * Extends InvalidBarcodeError but preserves the legacy name for backward compatibility.
 *
 * @deprecated Use `InvalidBarcodeError` from this module instead
 */
export class InvalidSerialNumberError extends Error {
  /** The invalid input that caused the error */
  readonly invalidInput: string;

  constructor(message: string, invalidInput: string = '') {
    super(message);
    this.name = 'InvalidSerialNumberError';
    this.invalidInput = invalidInput;
    Object.setPrototypeOf(this, InvalidSerialNumberError.prototype);
  }
}

/**
 * Parse a 24-digit serialized number into components (legacy interface)
 *
 * @deprecated Use `parseBarcode` from this module instead.
 * This function returns only the 3 legacy fields for backward compatibility.
 *
 * @param serial - The 24-digit serialized number (string)
 * @returns Parsed components: { game_code, pack_number, serial_start }
 * @throws {InvalidSerialNumberError} If serial format is invalid
 *
 * @example
 * const parsed = parseSerializedNumber("000112345670123456789012");
 * // Returns: { game_code: "0001", pack_number: "1234567", serial_start: "012" }
 */
export function parseSerializedNumber(serial: string): ParsedSerialNumber {
  // SEC-014: Validate input is a string
  if (typeof serial !== 'string') {
    throw new InvalidSerialNumberError(
      'Invalid serial number format. Must be 24 digits.',
      String(serial)
    );
  }

  // SEC-014: Strict format validation - exactly 24 digits (no cleaning for legacy compat)
  if (!BARCODE_REGEX.test(serial)) {
    throw new InvalidSerialNumberError('Invalid serial number format. Must be 24 digits.', serial);
  }

  // Extract components using defined segment positions
  const game_code = serial.substring(
    BARCODE_SEGMENTS.GAME_CODE_START,
    BARCODE_SEGMENTS.GAME_CODE_START + BARCODE_SEGMENTS.GAME_CODE_LENGTH
  );

  const pack_number = serial.substring(
    BARCODE_SEGMENTS.PACK_NUMBER_START,
    BARCODE_SEGMENTS.PACK_NUMBER_START + BARCODE_SEGMENTS.PACK_NUMBER_LENGTH
  );

  const serial_start = serial.substring(
    BARCODE_SEGMENTS.SERIAL_START_START,
    BARCODE_SEGMENTS.SERIAL_START_START + BARCODE_SEGMENTS.SERIAL_START_LENGTH
  );

  // Return ONLY the 3 legacy fields for backward compatibility
  return {
    game_code,
    pack_number,
    serial_start,
  };
}

/**
 * @deprecated Use `isValidBarcode` from this module instead.
 * This is a compatibility alias for code migrating from lottery-serial-parser.ts
 */
export const isValidSerialNumber = isValidBarcode;
