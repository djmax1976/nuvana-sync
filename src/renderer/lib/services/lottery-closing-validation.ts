/**
 * Lottery Closing Validation Service
 *
 * Story: 10-3 - Ending Number Scanning & Validation
 *
 * Validates ending serial numbers from barcode scans using three-level validation:
 * - Level 1: Pack number match
 * - Level 2: Minimum check (ending >= starting)
 * - Level 3: Maximum check (ending <= serial_end)
 *
 * @security
 * - INPUT_VALIDATION: Validates serial format before processing
 * - FORM_VALIDATION: Client-side validation mirrors backend requirements
 *
 * NOTE: This is a STUB implementation for RED phase testing.
 * Tests will fail until this service is fully implemented.
 */

import { parseSerializedNumber } from "@/lib/utils/lottery-serial-parser";

/**
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  endingNumber?: string;
}

/**
 * Bin data required for validation
 */
export interface BinValidationData {
  pack_number: string; // Expected pack number for this bin
  starting_serial: string; // Opening serial for this shift
  serial_end: string; // Pack's maximum serial from database
}

/**
 * Validate 3-digit ending number for manual entry mode
 *
 * Implements range validation only (skips pack number validation):
 * - Level 1: Minimum check (ending >= starting serial)
 * - Level 2: Maximum check (ending <= pack's serial_end)
 *
 * @param endingNumber - 3-digit ending number (manual entry)
 * @param binData - Bin validation data (starting_serial, serial_end)
 * @returns ValidationResult with valid flag and error message
 *
 * @example
 * const result = await validateManualEntryEnding(
 *   "067",
 *   { starting_serial: "045", serial_end: "150" }
 * );
 * // Returns: { valid: true }
 */
export async function validateManualEntryEnding(
  endingNumber: string,
  binData: { starting_serial: string; serial_end: string },
): Promise<ValidationResult> {
  // INPUT_VALIDATION: Validate format before processing
  if (!endingNumber || typeof endingNumber !== "string") {
    return {
      valid: false,
      error: "Invalid ending number format",
    };
  }

  // INPUT_VALIDATION: Strict format validation (exactly 3 digits)
  if (!/^\d{3}$/.test(endingNumber)) {
    return {
      valid: false,
      error: "Ending number must be exactly 3 digits",
    };
  }

  // INPUT_VALIDATION: Validate binData structure
  if (
    !binData ||
    typeof binData.starting_serial !== "string" ||
    typeof binData.serial_end !== "string"
  ) {
    return {
      valid: false,
      error: "Invalid bin validation data",
    };
  }

  try {
    // Level 1: Minimum check (ending >= starting)
    const endingNum = parseInt(endingNumber, 10);
    const startingNum = parseInt(binData.starting_serial, 10);

    if (isNaN(endingNum) || isNaN(startingNum)) {
      return {
        valid: false,
        error: "Invalid serial number format",
      };
    }

    if (endingNum < startingNum) {
      return {
        valid: false,
        error: `Ending number cannot be less than starting (${binData.starting_serial})`,
      };
    }

    // Level 2: Maximum check (ending <= serial_end)
    const maxNum = parseInt(binData.serial_end, 10);

    if (isNaN(maxNum)) {
      return {
        valid: false,
        error: "Invalid pack maximum serial",
      };
    }

    if (endingNum > maxNum) {
      return {
        valid: false,
        error: `Number exceeds pack maximum (${binData.serial_end})`,
      };
    }

    // All validations passed
    return {
      valid: true,
    };
  } catch (error) {
    // ERROR_HANDLING: Return generic error, don't leak implementation details
    return {
      valid: false,
      error: "Invalid ending number format",
    };
  }
}

/**
 * Validate ending serial number from barcode scan
 *
 * Implements three-level validation:
 * - Level 1: Pack number match (scanned pack must match bin's pack)
 * - Level 2: Minimum check (ending >= starting serial)
 * - Level 3: Maximum check (ending <= pack's serial_end)
 *
 * @param scannedSerial - 24-digit serial number from barcode scan
 * @param binData - Bin validation data (pack_number, starting_serial, serial_end)
 * @returns ValidationResult with valid flag, error message, and endingNumber
 *
 * @example
 * const result = await validateEndingSerial(
 *   "000112345670123456789012",
 *   { pack_number: "1234567", starting_serial: "045", serial_end: "150" }
 * );
 * // Returns: { valid: true, endingNumber: "067" }
 */
export async function validateEndingSerial(
  scannedSerial: string,
  binData: BinValidationData,
): Promise<ValidationResult> {
  // INPUT_VALIDATION: Validate serial format before processing
  if (!scannedSerial || typeof scannedSerial !== "string") {
    return {
      valid: false,
      error: "Invalid serial number format",
    };
  }

  // INPUT_VALIDATION: Strict format validation (24 digits only)
  if (!/^\d{24}$/.test(scannedSerial)) {
    return {
      valid: false,
      error: "Serial number must be exactly 24 digits",
    };
  }

  // INPUT_VALIDATION: Validate binData structure
  if (
    !binData ||
    typeof binData.pack_number !== "string" ||
    typeof binData.starting_serial !== "string" ||
    typeof binData.serial_end !== "string"
  ) {
    return {
      valid: false,
      error: "Invalid bin validation data",
    };
  }

  try {
    // Parse the scanned serial using existing utility
    const parsed = parseSerializedNumber(scannedSerial);

    // Level 1: Pack number match validation
    if (parsed.pack_number !== binData.pack_number) {
      return {
        valid: false,
        error: `Wrong pack - this serial belongs to a different lottery`,
      };
    }

    // Level 2: Minimum check (ending >= starting)
    const endingNum = parseInt(parsed.serial_start, 10);
    const startingNum = parseInt(binData.starting_serial, 10);

    if (isNaN(endingNum) || isNaN(startingNum)) {
      return {
        valid: false,
        error: "Invalid serial number format",
      };
    }

    if (endingNum < startingNum) {
      return {
        valid: false,
        error: `Ending number cannot be less than starting (${binData.starting_serial})`,
      };
    }

    // Level 3: Maximum check (ending <= serial_end)
    const maxNum = parseInt(binData.serial_end, 10);

    if (isNaN(maxNum)) {
      return {
        valid: false,
        error: "Invalid pack maximum serial",
      };
    }

    if (endingNum > maxNum) {
      return {
        valid: false,
        error: `Number exceeds pack maximum (${binData.serial_end})`,
      };
    }

    // All validations passed
    return {
      valid: true,
      endingNumber: parsed.serial_start, // The 3-digit ticket number
    };
  } catch (error) {
    // ERROR_HANDLING: Return generic error, don't leak implementation details
    // parseSerializedNumber throws InvalidSerialNumberError, but we return generic message
    return {
      valid: false,
      error: "Invalid serial number format",
    };
  }
}
