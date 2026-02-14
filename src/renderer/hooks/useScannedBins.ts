/**
 * useScannedBins Hook
 *
 * State management hook for tracking scanned lottery bins during day close.
 * Provides:
 * - Scanned bins state with add/remove/clear operations
 * - Auto-scroll to newly scanned bins
 * - Controlled/uncontrolled mode support
 * - Pack number to bin mapping utilities
 *
 * Story: Lottery Day Close Scanner Feature - Phase 2
 *
 * MCP Guidance Applied:
 * - FE-001: FE_XSS_PREVENTION - No direct HTML rendering, safe state management
 * - FE-003: FE_SENSITIVE_DATA_EXPOSURE - No sensitive data stored/exposed
 * - PERF-002: FE_RENDER_OPTIMIZATION - useCallback for stable callbacks
 *
 * @module renderer/hooks/useScannedBins
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { DayBin } from '@/lib/api/lottery';

/**
 * Scanned bin state - tracks which bins have been scanned and their ending serials
 *
 * MCP: FE-001 - Track source of closing serial for correct calculation
 */
export interface ScannedBin {
  /** Unique bin identifier */
  bin_id: string;
  /** Bin display number (1-based) */
  bin_number: number;
  /** Pack identifier for the scanned pack */
  pack_id: string;
  /** Pack number (matches barcode) */
  pack_number: string;
  /** Game name for display */
  game_name: string;
  /** Closing serial number from barcode (3 digits) */
  closing_serial: string;
  /**
   * True if this bin was marked as sold out (depleted).
   * Affects ticket calculation formula:
   * - Sold out: (serial_end + 1) - starting (serial_end is last index)
   * - Normal scan: ending - starting (ending is next position)
   */
  is_sold_out?: boolean;
}

/**
 * Options for useScannedBins hook
 */
export interface UseScannedBinsOptions {
  /**
   * All bins for the current day (for pack number lookup)
   */
  bins: DayBin[];

  /**
   * Controlled mode: external scanned bins state
   */
  value?: ScannedBin[];

  /**
   * Controlled mode: callback when scanned bins change
   */
  onChange?: (bins: ScannedBin[]) => void;

  /**
   * Callback when a bin is successfully scanned
   */
  onScanSuccess?: (bin: ScannedBin) => void;

  /**
   * Callback when scan fails (pack not found, duplicate, etc.)
   */
  onScanError?: (error: ScanError) => void;

  /**
   * Callback for duplicate scan handling - return 'replace' to replace existing scan
   * If not provided, defaults to showing error without replacement option
   * MCP: FE-001 STATE_MANAGEMENT - User-controlled duplicate handling
   */
  onDuplicateScan?: (error: ScanError) => DuplicateScanAction | Promise<DuplicateScanAction>;
}

/**
 * Scan error types
 */
export type ScanErrorType =
  | 'PACK_NOT_FOUND'
  | 'DUPLICATE_SCAN'
  | 'INVALID_SERIAL_RANGE'
  | 'INVALID_FORMAT';

/**
 * Scan result for duplicate handling
 * MCP: FE-001 - Allow replacement of existing scans
 */
export type DuplicateScanAction = 'skip' | 'replace';

/**
 * Scan error details
 * MCP: API-003 - Generic error responses, no internal details exposed
 */
export interface ScanError {
  type: ScanErrorType;
  message: string;
  packNumber?: string;
  binNumber?: number;
  /** For DUPLICATE_SCAN errors, the existing serial that was scanned */
  existingSerial?: string;
  /** For DUPLICATE_SCAN errors, the new serial being scanned */
  newSerial?: string;
}

/**
 * Parsed serial components from 24-digit barcode
 * Positions: game_code (4) + pack_number (7) + serial (3) + identifier (10)
 */
interface ParsedSerial {
  packNumber: string;
  closingSerial: string;
}

/**
 * Return type for useScannedBins hook
 */
export interface UseScannedBinsReturn {
  /** Current list of scanned bins */
  scannedBins: ScannedBin[];

  /** Add a scanned bin from a 24-digit serial */
  addFromSerial: (serial: string) => boolean;

  /** Add a scanned bin directly (for sold-out marking) */
  addScannedBin: (bin: ScannedBin) => void;

  /** Remove a scanned bin by bin_id (undo) */
  removeScannedBin: (binId: string) => void;

  /** Clear all scanned bins */
  clearScannedBins: () => void;

  /** Check if a bin is scanned */
  isScanned: (binId: string) => boolean;

  /** Get scanned bin by bin_id */
  getScannedBin: (binId: string) => ScannedBin | undefined;

  /** ID of the last scanned bin (for animation) */
  lastScannedBinId: string | null;

  /** Clear the last scanned bin ID */
  clearLastScannedBinId: () => void;

  /** Progress stats */
  progress: {
    scanned: number;
    total: number;
    percent: number;
    /** Number of empty bins (bins without active packs) */
    emptyBins: number;
  };

  /** Replace an existing scanned bin with a new serial */
  replaceScannedBin: (binId: string, newSerial: string) => boolean;

  /** Whether all active bins are scanned */
  allBinsScanned: boolean;
}

/**
 * Parse a 24-digit serial number into components
 *
 * Format: GGGGPPPPPPPSSSIIIIIIIIII
 * - GGGG: Game code (4 digits, positions 0-3)
 * - PPPPPPP: Pack number (7 digits, positions 4-10)
 * - SSS: Serial number (3 digits, positions 11-13)
 * - IIIIIIIIII: Identifier (10 digits, positions 14-23)
 *
 * SEC-014: INPUT_VALIDATION - Strict regex validation
 */
function parseSerial(serial: string): ParsedSerial | null {
  // SEC-014: Validate format - exactly 24 digits
  if (!/^\d{24}$/.test(serial)) {
    return null;
  }

  return {
    packNumber: serial.substring(4, 11), // 7 digits
    closingSerial: serial.substring(11, 14), // 3 digits
  };
}

/**
 * Scroll a bin row into view with smooth animation
 *
 * @param binId - The bin ID to scroll to
 * @param offset - Offset from top for sticky headers (default: 120px)
 */
export function scrollToBin(binId: string, offset: number = 120): void {
  const row = document.getElementById(`bin-row-${binId}`);
  if (row) {
    const elementPosition = row.getBoundingClientRect().top + window.scrollY;
    const offsetPosition = elementPosition - offset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
  }
}

/**
 * useScannedBins hook
 *
 * Manages scanned bins state for day close lottery scanning.
 * Supports both controlled and uncontrolled modes.
 *
 * @example
 * ```tsx
 * const {
 *   scannedBins,
 *   addFromSerial,
 *   removeScannedBin,
 *   allBinsScanned,
 * } = useScannedBins({ bins });
 *
 * const handleScan = (serial: string) => {
 *   if (addFromSerial(serial)) {
 *     playSuccessSound();
 *   } else {
 *     playErrorSound();
 *   }
 * };
 * ```
 */
export function useScannedBins({
  bins,
  value,
  onChange,
  onScanSuccess,
  onScanError,
  onDuplicateScan,
}: UseScannedBinsOptions): UseScannedBinsReturn {
  // Determine if we're in controlled mode
  const isControlled = value !== undefined;

  // Internal state for uncontrolled mode
  const [internalScannedBins, setInternalScannedBins] = useState<ScannedBin[]>([]);

  // Get the current scanned bins based on mode
  const scannedBins = isControlled ? value : internalScannedBins;

  // Track last scanned bin for animation
  const [lastScannedBinId, setLastScannedBinId] = useState<string | null>(null);

  // Refs for callbacks to avoid stale closures
  const callbacksRef = useRef({ onChange, onScanSuccess, onScanError, onDuplicateScan });
  useEffect(() => {
    callbacksRef.current = { onChange, onScanSuccess, onScanError, onDuplicateScan };
  }, [onChange, onScanSuccess, onScanError, onDuplicateScan]);

  /**
   * Get bins with active packs
   * MCP: PERF-002 - Memoize expensive computation
   */
  const activeBins = useMemo(
    () => bins.filter((bin) => bin.is_active && bin.pack !== null),
    [bins]
  );

  /**
   * Get count of empty bins (bins without active packs)
   * MCP: PERF-002 - Memoize expensive computation
   * Phase 5.4: Show empty bins count in progress
   */
  const emptyBinsCount = useMemo(
    () => bins.filter((bin) => bin.is_active && bin.pack === null).length,
    [bins]
  );

  /**
   * Create pack number to bin mapping for fast lookup
   * MCP: PERF-002 - Memoize map creation
   */
  const packToBinMap = useMemo(() => {
    const map = new Map<string, DayBin>();
    for (const bin of activeBins) {
      if (bin.pack) {
        map.set(bin.pack.pack_number, bin);
      }
    }
    return map;
  }, [activeBins]);

  /**
   * Update scanned bins - handles both controlled and uncontrolled
   */
  const updateScannedBins = useCallback(
    (updater: ScannedBin[] | ((prev: ScannedBin[]) => ScannedBin[])) => {
      if (isControlled) {
        const newValue = typeof updater === 'function' ? updater(value) : updater;
        callbacksRef.current.onChange?.(newValue);
      } else {
        setInternalScannedBins(updater);
      }
    },
    [isControlled, value]
  );

  /**
   * Add a scanned bin from a 24-digit serial
   * Returns true if successful, false if error
   */
  const addFromSerial = useCallback(
    (serial: string): boolean => {
      // Parse the serial
      const parsed = parseSerial(serial);
      if (!parsed) {
        callbacksRef.current.onScanError?.({
          type: 'INVALID_FORMAT',
          message: 'Invalid serial format. Must be 24 digits.',
        });
        return false;
      }

      // Find matching bin by pack number
      const matchingBin = packToBinMap.get(parsed.packNumber);
      if (!matchingBin || !matchingBin.pack) {
        callbacksRef.current.onScanError?.({
          type: 'PACK_NOT_FOUND',
          message: `No active pack matching ${parsed.packNumber}`,
          packNumber: parsed.packNumber,
        });
        return false;
      }

      // Check if already scanned
      // Phase 5.2: Handle duplicate scans with optional replacement
      const alreadyScanned = scannedBins.find((s) => s.bin_id === matchingBin.bin_id);
      if (alreadyScanned) {
        const duplicateError: ScanError = {
          type: 'DUPLICATE_SCAN',
          message: `Bin ${matchingBin.bin_number} has already been scanned`,
          binNumber: matchingBin.bin_number,
          existingSerial: alreadyScanned.closing_serial,
          newSerial: parsed.closingSerial,
        };

        // If onDuplicateScan is provided, allow async handling for replacement
        // The caller can return 'replace' to update the existing scan
        // For now, just report the error - replacement happens via replaceScannedBin
        callbacksRef.current.onScanError?.(duplicateError);
        return false;
      }

      // Validate serial range
      const closingNum = parseInt(parsed.closingSerial, 10);
      const startingNum = parseInt(matchingBin.pack.starting_serial, 10);
      const serialEndNum = parseInt(matchingBin.pack.serial_end, 10);

      if (closingNum < startingNum) {
        callbacksRef.current.onScanError?.({
          type: 'INVALID_SERIAL_RANGE',
          message: `Ending ${parsed.closingSerial} is less than starting ${matchingBin.pack.starting_serial}`,
          binNumber: matchingBin.bin_number,
        });
        return false;
      }

      if (closingNum > serialEndNum) {
        callbacksRef.current.onScanError?.({
          type: 'INVALID_SERIAL_RANGE',
          message: `Ending ${parsed.closingSerial} exceeds pack max ${matchingBin.pack.serial_end}`,
          binNumber: matchingBin.bin_number,
        });
        return false;
      }

      // Create scanned bin entry
      const newScannedBin: ScannedBin = {
        bin_id: matchingBin.bin_id,
        bin_number: matchingBin.bin_number,
        pack_id: matchingBin.pack.pack_id,
        pack_number: matchingBin.pack.pack_number,
        game_name: matchingBin.pack.game_name,
        closing_serial: parsed.closingSerial,
      };

      // Add to state (sorted by bin_number)
      updateScannedBins((prev) =>
        [...prev, newScannedBin].sort((a, b) => a.bin_number - b.bin_number)
      );

      // Set last scanned for animation
      setLastScannedBinId(matchingBin.bin_id);

      // Scroll to the scanned bin
      scrollToBin(matchingBin.bin_id);

      // Callback
      callbacksRef.current.onScanSuccess?.(newScannedBin);

      return true;
    },
    [packToBinMap, scannedBins, updateScannedBins]
  );

  /**
   * Add a scanned bin directly (for sold-out marking)
   */
  const addScannedBin = useCallback(
    (bin: ScannedBin) => {
      updateScannedBins((prev) => {
        // Avoid duplicates
        if (prev.find((s) => s.bin_id === bin.bin_id)) {
          return prev;
        }
        return [...prev, bin].sort((a, b) => a.bin_number - b.bin_number);
      });
      setLastScannedBinId(bin.bin_id);
    },
    [updateScannedBins]
  );

  /**
   * Replace an existing scanned bin with a new serial
   * Phase 5.2: Support re-scanning to replace existing value
   * MCP: SEC-014 INPUT_VALIDATION - Validates new serial format
   *
   * @param binId - The bin ID to replace
   * @param newSerial - The new 3-digit closing serial
   * @returns true if replaced successfully, false if bin not found or invalid serial
   */
  const replaceScannedBin = useCallback(
    (binId: string, newSerial: string): boolean => {
      // SEC-014: Validate serial format - exactly 3 digits
      if (!/^\d{3}$/.test(newSerial)) {
        return false;
      }

      // Check if the bin is actually scanned
      const existingBin = scannedBins.find((s) => s.bin_id === binId);
      if (!existingBin) {
        return false;
      }

      // Find the actual bin to validate serial range
      const dayBin = activeBins.find((b) => b.bin_id === binId);
      if (!dayBin?.pack) {
        return false;
      }

      // Validate serial range
      const newSerialNum = parseInt(newSerial, 10);
      const startingNum = parseInt(dayBin.pack.starting_serial, 10);
      const serialEndNum = parseInt(dayBin.pack.serial_end, 10);

      if (newSerialNum < startingNum || newSerialNum > serialEndNum) {
        return false;
      }

      // Update the scanned bin with new serial
      updateScannedBins((prev) =>
        prev.map((s) => (s.bin_id === binId ? { ...s, closing_serial: newSerial } : s))
      );

      // Set as last scanned for animation
      setLastScannedBinId(binId);
      scrollToBin(binId);

      return true;
    },
    [scannedBins, activeBins, updateScannedBins]
  );

  /**
   * Remove a scanned bin by bin_id (undo)
   */
  const removeScannedBin = useCallback(
    (binId: string) => {
      updateScannedBins((prev) => prev.filter((bin) => bin.bin_id !== binId));
      if (lastScannedBinId === binId) {
        setLastScannedBinId(null);
      }
    },
    [updateScannedBins, lastScannedBinId]
  );

  /**
   * Clear all scanned bins
   */
  const clearScannedBins = useCallback(() => {
    updateScannedBins([]);
    setLastScannedBinId(null);
  }, [updateScannedBins]);

  /**
   * Check if a bin is scanned
   */
  const isScanned = useCallback(
    (binId: string): boolean => {
      return scannedBins.some((s) => s.bin_id === binId);
    },
    [scannedBins]
  );

  /**
   * Get scanned bin by bin_id
   */
  const getScannedBin = useCallback(
    (binId: string): ScannedBin | undefined => {
      return scannedBins.find((s) => s.bin_id === binId);
    },
    [scannedBins]
  );

  /**
   * Clear last scanned bin ID
   */
  const clearLastScannedBinId = useCallback(() => {
    setLastScannedBinId(null);
  }, []);

  /**
   * Progress calculation
   * MCP: PERF-002 - Memoize derived values
   * Phase 5.4: Include empty bins count for progress display
   */
  const progress = useMemo(() => {
    const total = activeBins.length;
    const scanned = scannedBins.length;
    const percent = total > 0 ? Math.round((scanned / total) * 100) : 0;
    return { total, scanned, percent, emptyBins: emptyBinsCount };
  }, [activeBins.length, scannedBins.length, emptyBinsCount]);

  /**
   * Check if all active bins are scanned
   */
  const allBinsScanned = useMemo(
    () => progress.total > 0 && progress.scanned === progress.total,
    [progress.total, progress.scanned]
  );

  // Auto-clear animation state after delay
  useEffect(() => {
    if (lastScannedBinId) {
      const timeoutId = setTimeout(() => {
        setLastScannedBinId(null);
      }, 800);
      return () => clearTimeout(timeoutId);
    }
  }, [lastScannedBinId]);

  return {
    scannedBins,
    addFromSerial,
    addScannedBin,
    removeScannedBin,
    clearScannedBins,
    isScanned,
    getScannedBin,
    lastScannedBinId,
    clearLastScannedBinId,
    progress,
    allBinsScanned,
    replaceScannedBin,
  };
}
