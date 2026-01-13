/**
 * Lottery Day Close Helper Functions
 *
 * Pure business logic functions for lottery day closing:
 * - Bin matching algorithm
 * - Closing serial validation
 * - Completion check logic
 * - Data transformation
 *
 * Story: Lottery Day Closing Feature
 * Tests: tests/unit/lottery/lottery-day-close.test.ts
 */

import type { DayBin, CloseLotteryDayInput } from "@/lib/api/lottery";

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of matching a scanned serial to a bin
 */
export interface MatchResult {
  matched: boolean;
  bin?: DayBin;
  error?: string;
}

/**
 * Result of validating a closing serial
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Scanned bin data for API submission
 */
export interface ScannedBin {
  bin_id: string;
  pack_id: string;
  closing_serial: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// BIN MATCHING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Match a parsed serial to a bin by game_code AND pack_number
 *
 * Both criteria must match for a successful match.
 * Empty bins (pack: null) are automatically filtered out.
 * Game code matching is case-insensitive.
 *
 * @param parsedSerial - Parsed serial with game_code, pack_number, serial_start
 * @param bins - List of bins with active packs
 * @param gamesMap - Map of pack_id -> game info (for game_code lookup)
 * @returns Match result with matched bin or error
 *
 * @example
 * const result = matchSerialToBin(
 *   { game_code: "0001", pack_number: "1234567", serial_start: "025" },
 *   bins,
 *   gamesMap
 * );
 * if (result.matched) {
 *   console.log("Matched bin:", result.bin.bin_number);
 * }
 */
export function matchSerialToBin(
  parsedSerial: {
    game_code: string;
    pack_number: string;
    serial_start: string;
  },
  bins: DayBin[],
  gamesMap: Map<string, { game_code: string }>,
): MatchResult {
  // Filter to bins with active packs only
  const activeBins = bins.filter((bin) => bin.pack !== null);

  // Find matching bin: game_code AND pack_number must both match
  const matchedBin = activeBins.find((bin) => {
    if (!bin.pack) return false;

    const packGameCode = gamesMap.get(bin.pack.pack_id)?.game_code;
    if (!packGameCode) return false;

    // Case-insensitive comparison for game codes
    const gameCodeMatches =
      packGameCode.toLowerCase() === parsedSerial.game_code.toLowerCase();
    const packNumberMatches = bin.pack.pack_number === parsedSerial.pack_number;

    return gameCodeMatches && packNumberMatches;
  });

  if (!matchedBin) {
    return {
      matched: false,
      error: `No bin found with game code "${parsedSerial.game_code}" and pack number "${parsedSerial.pack_number}"`,
    };
  }

  return {
    matched: true,
    bin: matchedBin,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SERIAL VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate that closing serial is within valid range
 *
 * Checks:
 * 1. Format: Must be exactly 3 digits, numeric only
 * 2. Range: Must be >= starting_serial and <= serial_end
 * 3. String comparison: Preserves leading zeros (e.g., "009" < "010")
 *
 * @param closingSerial - The closing serial to validate (3-digit string)
 * @param startingSerial - The starting serial for this day/period
 * @param serialEnd - The pack's maximum serial
 * @returns Validation result with error if invalid
 *
 * @example
 * const result = validateClosingSerial("025", "001", "050");
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 */
export function validateClosingSerial(
  closingSerial: string,
  startingSerial: string,
  serialEnd: string,
): ValidationResult {
  // Must be exactly 3 digits
  if (!/^\d{3}$/.test(closingSerial)) {
    return {
      valid: false,
      error: "Closing serial must be exactly 3 digits",
    };
  }

  // Must be numeric
  if (!/^\d+$/.test(closingSerial)) {
    return {
      valid: false,
      error: "Closing serial must be numeric",
    };
  }

  // CRITICAL: Compare as strings, not numbers
  // "009" < "010" in string comparison, "001" is NOT equal to "1"
  // This preserves leading zeros correctly

  // Must be >= starting_serial
  if (closingSerial < startingSerial) {
    return {
      valid: false,
      error: `Closing serial "${closingSerial}" is below starting serial "${startingSerial}"`,
    };
  }

  // Must be <= serial_end
  if (closingSerial > serialEnd) {
    return {
      valid: false,
      error: `Closing serial "${closingSerial}" exceeds pack maximum "${serialEnd}"`,
    };
  }

  return { valid: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPLETION CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if all bins with active packs have been scanned
 *
 * Empty bins (pack: null) are automatically ignored.
 * Returns completion status and list of pending bins for UI feedback.
 *
 * @param bins - List of all bins
 * @param scannedPackIds - Set of pack IDs that have been scanned
 * @returns Completion status and list of pending bins
 *
 * @example
 * const { complete, pendingBins } = checkAllBinsScanned(bins, scannedPackIds);
 * if (!complete) {
 *   console.log(`${pendingBins.length} bins remaining`);
 * }
 */
export function checkAllBinsScanned(
  bins: DayBin[],
  scannedPackIds: Set<string>,
): { complete: boolean; pendingBins: DayBin[] } {
  // Get bins with active packs (pack !== null)
  const activeBins = bins.filter((bin) => bin.pack !== null);

  // Edge case: No active bins means complete
  if (activeBins.length === 0) {
    return { complete: true, pendingBins: [] };
  }

  // Find bins that haven't been scanned
  const pendingBins = activeBins.filter(
    (bin) => bin.pack && !scannedPackIds.has(bin.pack.pack_id),
  );

  return {
    complete: pendingBins.length === 0,
    pendingBins,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA TRANSFORMATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transform scanned bins to API payload format
 *
 * Converts component state to the format expected by the API.
 * Filters out bin_id (not needed by API) and adds entry_method.
 *
 * @param scannedBins - List of scanned bins with closing serials
 * @param entryMethod - Entry method (default: 'SCAN')
 * @returns API payload for closing lottery day
 *
 * @example
 * const payload = transformToApiPayload(scannedBins);
 * await closeLotteryDay(storeId, payload);
 */
export function transformToApiPayload(
  scannedBins: ScannedBin[],
  entryMethod: "SCAN" | "MANUAL" = "SCAN",
): CloseLotteryDayInput {
  return {
    closings: scannedBins.map((bin) => ({
      pack_id: bin.pack_id,
      closing_serial: bin.closing_serial,
    })),
    entry_method: entryMethod,
  };
}
