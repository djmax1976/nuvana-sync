/**
 * Lottery Serial Number Parser Utility (Frontend)
 *
 * @deprecated This module is deprecated. Import from '@shared/lottery/barcode-parser' instead.
 *
 * This file now re-exports from the centralized barcode parser for backward compatibility.
 * The shared module provides a single source of truth for barcode parsing across frontend
 * and backend.
 *
 * @module renderer/lib/utils/lottery-serial-parser
 * @see {@link @shared/lottery/barcode-parser} for the centralized implementation
 *
 * ## Migration Guide
 *
 * Old imports:
 * ```typescript
 * import { parseSerializedNumber, isValidSerialNumber } from '@/lib/utils/lottery-serial-parser';
 * ```
 *
 * New imports:
 * ```typescript
 * import { parseBarcode, isValidBarcode } from '@shared/lottery/barcode-parser';
 * ```
 *
 * ## Key Changes
 *
 * | Old (this module)         | New (shared module)        |
 * |---------------------------|----------------------------|
 * | parseSerializedNumber()   | parseBarcode()             |
 * | isValidSerialNumber()     | isValidBarcode()           |
 * | extractGameCode()         | extractGameCode()          |
 * | ParsedSerialNumber        | ParsedBarcode              |
 * | InvalidSerialNumberError  | InvalidBarcodeError        |
 *
 * ## New Fields Available
 *
 * The shared ParsedBarcode type includes additional fields:
 * - `identifier`: The 10-digit check data (positions 15-24)
 * - `raw`: The cleaned barcode string
 * - `is_valid`: Boolean indicating validation status
 * - `full_serial`: Combined game_code + pack_number for lookups
 */

// Import parseBarcode directly for use in legacy function
import { parseBarcode as _parseBarcode } from '@shared/lottery/barcode-parser';

// Re-export everything from the shared module for backward compatibility
export {
  // Core parsing functions
  parseBarcode,
  tryParseBarcode,
  isValidBarcode,
  validateBarcode,

  // Extraction convenience functions
  extractGameCode,
  extractPackNumber,
  extractSerialStart,
  extractIdentifier,

  // Batch processing
  parseBarcodes,
  deduplicateBarcodes,

  // Serial utilities
  isValidSerialStart,
  parseSerialStart,
  formatSerialStart,

  // Error class
  InvalidBarcodeError,

  // Types
  type ParsedBarcode,
  type ParseBarcodeOptions,
  type BarcodeValidationResult,
  type BatchParseResult,

  // Constants
  BARCODE_LENGTH,
  BARCODE_REGEX,
  BARCODE_SEGMENTS,

  // Legacy compatibility aliases (re-exported from shared)
  parseSerializedNumber,
  isValidSerialNumber,
  InvalidSerialNumberError,
  type ParsedSerialNumber,
} from '@shared/lottery/barcode-parser';

/**
 * @deprecated Use `parseBarcode` from '@shared/lottery/barcode-parser' instead.
 *
 * This is a compatibility wrapper that provides the old interface.
 * The new parseBarcode function returns additional fields (identifier, raw, is_valid, full_serial).
 *
 * @example
 * // Old usage (deprecated):
 * import { parseSerializedNumberLegacy } from '@/lib/utils/lottery-serial-parser';
 * const result = parseSerializedNumberLegacy('000112345670253456789012');
 *
 * // New usage:
 * import { parseBarcode } from '@shared/lottery/barcode-parser';
 * const result = parseBarcode('000112345670253456789012');
 */
export function parseSerializedNumberLegacy(serial: string): {
  game_code: string;
  pack_number: string;
  serial_start: string;
} {
  // Use the imported shared parseBarcode function
  const result = _parseBarcode(serial);
  return {
    game_code: result.game_code,
    pack_number: result.pack_number,
    serial_start: result.serial_start,
  };
}
