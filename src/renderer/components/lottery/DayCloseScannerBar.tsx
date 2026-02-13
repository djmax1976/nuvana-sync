/**
 * DayCloseScannerBar Component
 *
 * Floating/sticky scanner bar for day close lottery scanning.
 * Features:
 * - Sticky positioning (stays visible when scrolling)
 * - Progress indicator (X/Y bins scanned)
 * - Mute toggle for sound feedback
 * - Cancel and Complete action buttons
 * - Visual scan input with icon
 *
 * Story: Lottery Day Close Scanner Feature - Phase 2
 *
 * MCP Guidance Applied:
 * - SEC-014: INPUT_VALIDATION - Serial number validation via ScannerInput
 * - FE-001: FE_XSS_PREVENTION - React JSX auto-escapes all output
 * - PERF-002: FE_RENDER_OPTIMIZATION - useMemo for progress calculations
 * - ARCH-001: FE_COMPONENT_DESIGN - Single responsibility, clear props interface
 *
 * @module renderer/components/lottery/DayCloseScannerBar
 */

import { useMemo, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Scan, Volume2, VolumeX, X, ArrowRight, Loader2 } from 'lucide-react';
import { ScannerInput, type ScannerInputHandle } from './ScannerInput';
import type { ScannedBin } from '@/hooks/useScannedBins';
import type { DayBin } from '@/lib/api/lottery';
import { cn } from '@/lib/utils';

/**
 * Props for DayCloseScannerBar component
 *
 * MCP: ARCH-001 - Clear props interface with TypeScript
 */
export interface DayCloseScannerBarProps {
  /**
   * All bins for the current day (active + empty)
   */
  bins: DayBin[];

  /**
   * Currently scanned bins with their closing serials
   */
  scannedBins: ScannedBin[];

  /**
   * Callback when a barcode is scanned
   * @param serial - The 24-digit serial number
   */
  onScan: (serial: string) => void;

  /**
   * Callback when scan fails (invalid input)
   */
  onScanError?: () => void;

  /**
   * Callback when Cancel button is clicked
   */
  onCancel: () => void;

  /**
   * Callback when Complete/Continue button is clicked
   */
  onComplete: () => void;

  /**
   * Whether the sound is muted
   */
  isMuted: boolean;

  /**
   * Callback to toggle mute state
   */
  onToggleMute: () => void;

  /**
   * Whether submission is in progress
   */
  isSubmitting?: boolean;

  /**
   * Whether all bins have been scanned
   */
  isComplete?: boolean;

  /**
   * Whether the bar should use floating/sticky positioning
   * @default true
   */
  floating?: boolean;

  /**
   * Test ID for testing
   */
  'data-testid'?: string;
}

/**
 * DayCloseScannerBar component
 *
 * A floating/sticky bar with scanner input, progress indicator,
 * and action buttons for day close lottery scanning.
 *
 * @example
 * ```tsx
 * <DayCloseScannerBar
 *   bins={activeBins}
 *   scannedBins={scannedBins}
 *   onScan={handleScan}
 *   onCancel={handleCancel}
 *   onComplete={handleComplete}
 *   isMuted={isMuted}
 *   onToggleMute={toggleMute}
 * />
 * ```
 */
export function DayCloseScannerBar({
  bins,
  scannedBins,
  onScan,
  onScanError,
  onCancel,
  onComplete,
  isMuted,
  onToggleMute,
  isSubmitting = false,
  isComplete: isCompleteOverride,
  floating = true,
  'data-testid': testId = 'day-close-scanner-bar',
}: DayCloseScannerBarProps) {
  // Ref to scanner input for imperative control
  const scannerRef = useRef<ScannerInputHandle>(null);

  /**
   * Get bins with active packs (need scanning)
   * MCP: PERF-002 - Memoize expensive computation
   */
  const activeBins = useMemo(
    () => bins.filter((bin) => bin.is_active && bin.pack !== null),
    [bins]
  );

  /**
   * Get count of empty bins (bins without active packs)
   * Phase 5.4: Show empty bins count in progress
   * MCP: PERF-002 - Memoize derived values
   */
  const emptyBinsCount = useMemo(
    () => bins.filter((bin) => bin.is_active && bin.pack === null).length,
    [bins]
  );

  /**
   * Calculate progress
   * MCP: PERF-002 - Memoize derived values
   */
  const progress = useMemo(() => {
    const total = activeBins.length;
    const scanned = scannedBins.length;
    const percent = total > 0 ? Math.round((scanned / total) * 100) : 0;
    return { total, scanned, percent, emptyBins: emptyBinsCount };
  }, [activeBins.length, scannedBins.length, emptyBinsCount]);

  /**
   * Check if all bins are scanned
   */
  const allBinsScanned = useMemo(
    () => isCompleteOverride ?? (progress.total > 0 && progress.scanned === progress.total),
    [isCompleteOverride, progress.total, progress.scanned]
  );

  /**
   * Handle scan callback - refocus input after scan
   */
  const handleScan = useCallback(
    (serial: string) => {
      onScan(serial);
      // Refocus is handled by ScannerInput internally
    },
    [onScan]
  );

  /**
   * Handle scan error
   */
  const handleScanError = useCallback(() => {
    onScanError?.();
    // Refocus is handled by ScannerInput internally
  }, [onScanError]);

  // Base container classes
  const containerClasses = cn(
    'bg-primary text-primary-foreground shadow-lg z-40',
    floating && 'sticky top-0',
    !floating && 'relative'
  );

  return (
    <div className={containerClasses} data-testid={testId}>
      <div className="px-4 sm:px-6 py-3">
        {/* Main row: Icon, Input, Progress, Sound toggle, Actions */}
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Scanner icon and label */}
          <div className="flex items-center gap-2 shrink-0">
            <Scan className="w-5 h-5" aria-hidden="true" />
            <span className="font-semibold hidden sm:inline">Scan Ticket</span>
          </div>

          {/* Scanner Input */}
          <div className="flex-1 min-w-0">
            <ScannerInput
              ref={scannerRef}
              onScan={handleScan}
              onScanError={handleScanError}
              disabled={isSubmitting}
              autoFocus={true}
              placeholder="Scan barcode..."
              className="bg-white text-foreground border-2 border-white focus:border-primary/50"
              data-testid="scanner-bar-input"
            />
          </div>

          {/* Progress indicator
              Phase 5.4: Show empty bins count in progress
          */}
          <div
            className="text-center px-2 sm:px-3 shrink-0"
            data-testid="scanner-progress"
            aria-label={`${progress.scanned} of ${progress.total} bins scanned${progress.emptyBins > 0 ? `, ${progress.emptyBins} empty` : ''}`}
          >
            <div className="text-xl sm:text-2xl font-bold tabular-nums">
              {progress.scanned}/{progress.total}
            </div>
            <div className="text-[10px] sm:text-xs opacity-80">
              {progress.emptyBins > 0 ? (
                <span>
                  scanned <span className="text-primary-foreground/60">({progress.emptyBins} empty)</span>
                </span>
              ) : (
                'scanned'
              )}
            </div>
          </div>

          {/* Sound Toggle */}
          <button
            type="button"
            onClick={onToggleMute}
            className="p-2 hover:bg-primary/80 rounded-md shrink-0 transition-colors"
            title={isMuted ? 'Enable scan sounds' : 'Disable scan sounds'}
            aria-label={isMuted ? 'Enable scan sounds' : 'Disable scan sounds'}
            aria-pressed={!isMuted}
            data-testid="scanner-sound-toggle"
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
            ) : (
              <Volume2 className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
            )}
          </button>

          {/* Cancel Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={isSubmitting}
            className="shrink-0"
            data-testid="scanner-cancel-button"
          >
            <X className="w-4 h-4 sm:mr-1" aria-hidden="true" />
            <span className="hidden sm:inline">Cancel</span>
          </Button>

          {/* Complete Button */}
          <Button
            size="sm"
            onClick={onComplete}
            disabled={isSubmitting || !allBinsScanned}
            className={cn(
              'shrink-0 transition-colors',
              allBinsScanned && 'bg-green-600 hover:bg-green-700 text-white'
            )}
            data-testid="scanner-complete-button"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin sm:mr-1" aria-hidden="true" />
            ) : (
              <ArrowRight className="w-4 h-4 sm:mr-1" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">
              {isSubmitting ? 'Processing...' : 'Continue'}
            </span>
          </Button>
        </div>

        {/* Progress bar row */}
        <div className="flex items-center gap-3 mt-3">
          <span className="text-xs font-medium opacity-80">Progress</span>
          <Progress
            value={progress.percent}
            className="flex-1 h-2 bg-primary/30"
            data-testid="scanner-progress-bar"
          />
          <span className="text-xs opacity-80 tabular-nums">{progress.percent}%</span>
        </div>
      </div>
    </div>
  );
}
