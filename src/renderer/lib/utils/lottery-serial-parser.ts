/**
 * Lottery Serial Number Parser Utility (Frontend)
 * Parses 24-digit serialized lottery pack numbers into components
 *
 * Story 6.12: Serialized Pack Reception with Batch Processing
 *
 * Serial Format:
 * - Total: 24 digits
 * - Positions 1-4: Game code (4 digits)
 * - Positions 5-11: Pack number (7 digits)
 * - Positions 12-14: Starting ticket number (3 digits)
 * - Positions 15-24: Identifier (10 digits, not used for reception)
 *
 * Example: "000112345670123456789012"
 * - game_code: "0001"
 * - pack_number: "1234567"
 * - serial_start: "012"
 */

/**
 * Parsed serial number components
 */
export interface ParsedSerialNumber {
  game_code: string;
  pack_number: string;
  serial_start: string;
}

/**
 * Error thrown when serial number format is invalid
 */
export class InvalidSerialNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSerialNumberError";
  }
}

/**
 * Parse a 24-digit serialized number into components
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
  // Validate: exactly 24 digits, numeric only
  if (!/^\d{24}$/.test(serial)) {
    throw new InvalidSerialNumberError(
      "Invalid serial number format. Must be 24 digits.",
    );
  }

  // Extract components based on positions
  const game_code = serial.substring(0, 4); // Positions 1-4
  const pack_number = serial.substring(4, 11); // Positions 5-11
  const serial_start = serial.substring(11, 14); // Positions 12-14

  return {
    game_code,
    pack_number,
    serial_start,
  };
}

/**
 * Validate serial number format without parsing
 *
 * @param serial - The serial number to validate
 * @returns True if valid format, false otherwise
 *
 * @example
 * isValidSerialNumber("000112345670123456789012"); // true
 * isValidSerialNumber("123"); // false (too short)
 * isValidSerialNumber("abc123"); // false (non-numeric)
 */
export function isValidSerialNumber(serial: string): boolean {
  return /^\d{24}$/.test(serial);
}

/**
 * Extract game code from serial number without full parsing
 *
 * @param serial - The 24-digit serialized number
 * @returns Game code (4 digits) or null if invalid format
 *
 * @example
 * extractGameCode("000112345670123456789012"); // "0001"
 */
export function extractGameCode(serial: string): string | null {
  if (!isValidSerialNumber(serial)) {
    return null;
  }
  return serial.substring(0, 4);
}
