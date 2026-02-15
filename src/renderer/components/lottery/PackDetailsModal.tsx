/**
 * Pack Details Modal Component
 * Displays full pack details including serial range, status, game, bin, activation timestamp,
 * tickets remaining, and associated shift openings/closings
 *
 * Story: 6.10 - Lottery Management UI
 * AC #4: View pack details (serial range, tickets remaining, status, game, bin, activation timestamp)
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Uses centralized timezone from StoreContext
 * - FE-005: UI_SECURITY - No secrets exposed; only pack metadata displayed
 * - SEC-004: XSS - React auto-escapes all text content
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getPackStatusBadgeVariant, getPackStatusText } from './pack-status-badge';
import { Loader2, Package, Calendar, MapPin } from 'lucide-react';
import { useDateFormat } from '@/hooks/useDateFormat';
import { calculateTicketsRemainingFromSerials } from '../../../shared/lottery/ticket-calculations';

export type PackStatus = 'RECEIVED' | 'ACTIVE' | 'DEPLETED' | 'RETURNED';

export interface PackDetailsData {
  pack_id: string;
  pack_number: string;
  serial_start: string;
  serial_end: string;
  status: PackStatus;
  game: {
    game_id: string;
    name: string;
    description?: string;
    price?: number;
  };
  bin?: {
    bin_id: string;
    name: string;
    location?: string;
  } | null;
  received_at?: string | null;
  activated_at?: string | null;
  depleted_at?: string | null;
  returned_at?: string | null;
  tickets_remaining?: number;
  shift_openings?: Array<{
    opening_id: string;
    shift_id: string;
    opening_serial: string;
    created_at: string;
    shift?: {
      shift_id: string;
      shift_number: number;
      status: string;
    };
  }>;
  shift_closings?: Array<{
    closing_id: string;
    shift_id: string;
    closing_serial: string;
    opening_serial: string;
    expected_count: number;
    actual_count: number;
    difference: number;
    has_variance: boolean;
    created_at: string;
    shift?: {
      shift_id: string;
      shift_number: number;
      status: string;
    };
  }>;
}

interface PackDetailsModalProps {
  pack: PackDetailsData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading?: boolean;
}

/**
 * Get tickets remaining for display
 *
 * Priority:
 * 1. Use backend-provided value (most accurate - considers current position)
 * 2. Fall back to centralized calculation utility (for total pack count)
 *
 * @param serialStart - Starting serial number (0-based index)
 * @param serialEnd - Ending serial number (0-based index)
 * @param currentPosition - Current selling position (if known)
 * @param providedRemaining - Pre-calculated remaining count from backend
 * @returns Number of tickets remaining
 *
 * MCP Guidance Applied:
 * - SEC-014: INPUT_VALIDATION - Uses centralized utility with bounds checking
 * @see shared/lottery/ticket-calculations.ts
 */
function getTicketsRemainingForDisplay(
  serialStart: string,
  serialEnd: string,
  currentPosition: string | undefined,
  providedRemaining?: number
): number {
  // Priority 1: Use backend-provided value (most accurate)
  if (providedRemaining !== undefined) {
    return providedRemaining;
  }

  // Priority 2: Calculate using centralized utility
  // If we have current position, calculate remaining from there
  // Otherwise calculate total tickets in pack (fallback for RECEIVED status)
  const positionToUse = currentPosition || serialStart;
  const result = calculateTicketsRemainingFromSerials(serialStart, serialEnd, positionToUse);

  return result.success ? result.value : 0;
}

/**
 * PackDetailsModal component
 * Modal dialog displaying comprehensive pack details
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - Uses useDateFormat hook for centralized timezone
 * - FE-005: UI_SECURITY - No secrets exposed; only pack metadata displayed
 * - SEC-004: XSS - React auto-escapes all text content
 */
export function PackDetailsModal({
  pack,
  open,
  onOpenChange,
  isLoading = false,
}: PackDetailsModalProps) {
  /**
   * Use centralized date formatting with store timezone
   * This ensures all timestamps display in the store's local time
   *
   * MCP Guidance Applied:
   * - FE-001: STATE_MANAGEMENT - Centralized timezone from StoreContext
   */
  const { formatDateTime } = useDateFormat();

  /**
   * Format timestamp for display using store timezone
   * Returns em-dash for null/undefined values
   *
   * @param timestamp - ISO 8601 timestamp string or null/undefined
   * @returns Formatted timestamp string in store timezone
   *
   * MCP Guidance Applied:
   * - SEC-014: INPUT_VALIDATION - Handles null/undefined gracefully
   */
  const formatTimestamp = (timestamp: string | null | undefined): string => {
    if (!timestamp) return '—';
    try {
      return formatDateTime(timestamp);
    } catch {
      // Fallback for malformed timestamps - return original for debugging
      return timestamp;
    }
  };

  if (!pack && !isLoading) {
    return null;
  }

  const statusVariant = pack ? getPackStatusBadgeVariant(pack.status) : 'outline';
  const statusText = pack ? getPackStatusText(pack.status) : '';
  // Use backend-provided tickets_remaining (calculated with current position)
  // Falls back to centralized calculation if not provided
  const ticketsRemaining = pack
    ? getTicketsRemainingForDisplay(
        pack.serial_start,
        pack.serial_end,
        undefined, // Current position not available in modal - backend provides accurate count
        pack.tickets_remaining
      )
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pack Details</DialogTitle>
          <DialogDescription>
            Complete information for pack {pack?.pack_number || ''}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading pack details...</span>
          </div>
        )}

        {pack && !isLoading && (
          <div className="space-y-4">
            {/* Pack Information */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{pack.pack_number}</CardTitle>
                    <CardDescription>{pack.game.name}</CardDescription>
                  </div>
                  <Badge variant={statusVariant}>{statusText}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium text-muted-foreground">Serial Range</div>
                    <div className="mt-1">
                      {pack.serial_start} - {pack.serial_end}
                    </div>
                  </div>
                  <div>
                    <div className="font-medium text-muted-foreground">Tickets Remaining</div>
                    <div className="mt-1">{ticketsRemaining}</div>
                  </div>
                </div>

                {pack.bin && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="font-medium text-muted-foreground">Bin: </span>
                      <span>{pack.bin.name}</span>
                      {pack.bin.location && (
                        <span className="text-muted-foreground"> ({pack.bin.location})</span>
                      )}
                    </div>
                  </div>
                )}

                {pack.game.price && (
                  <div className="text-sm">
                    <div className="font-medium text-muted-foreground">Game Price</div>
                    <div className="mt-1">${pack.game.price.toFixed(2)}</div>
                  </div>
                )}

                {pack.game.description && (
                  <div className="text-sm">
                    <div className="font-medium text-muted-foreground">Game Description</div>
                    <div className="mt-1 text-muted-foreground">{pack.game.description}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Timestamps */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Received:</span>
                  <span>{formatTimestamp(pack.received_at)}</span>
                </div>
                {pack.activated_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Activated:</span>
                    <span>{formatTimestamp(pack.activated_at)}</span>
                  </div>
                )}
                {pack.depleted_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Depleted:</span>
                    <span>{formatTimestamp(pack.depleted_at)}</span>
                  </div>
                )}
                {pack.returned_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Returned:</span>
                    <span>{formatTimestamp(pack.returned_at)}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Shift Openings */}
            {pack.shift_openings && pack.shift_openings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Shift Openings ({pack.shift_openings.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pack.shift_openings.map((opening) => (
                      <div key={opening.opening_id} className="rounded-md border p-3 text-sm">
                        <div className="font-medium">
                          Shift #{opening.shift?.shift_number || opening.shift_id.substring(0, 8)}
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          Opening Serial: {opening.opening_serial}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatTimestamp(opening.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Shift Closings */}
            {pack.shift_closings && pack.shift_closings.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Shift Closings ({pack.shift_closings.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pack.shift_closings.map((closing) => (
                      <div key={closing.closing_id} className="rounded-md border p-3 text-sm">
                        <div className="font-medium">
                          Shift #{closing.shift?.shift_number || closing.shift_id.substring(0, 8)}
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-2 text-muted-foreground">
                          <div>Opening: {closing.opening_serial}</div>
                          <div>Closing: {closing.closing_serial}</div>
                          <div>Expected: {closing.expected_count}</div>
                          <div>Actual: {closing.actual_count}</div>
                        </div>
                        {closing.has_variance && (
                          <div className="mt-2 text-sm">
                            <Badge variant="destructive">
                              Variance: {closing.difference > 0 ? '+' : ''}
                              {closing.difference}
                            </Badge>
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          {formatTimestamp(closing.created_at)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
