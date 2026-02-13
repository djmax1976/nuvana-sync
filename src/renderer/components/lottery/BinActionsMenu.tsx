/**
 * Bin Actions Menu Component
 *
 * Story: Lottery Day Close Scanner Feature - Phase 3
 *
 * Dropdown menu for bin row actions (Mark Sold, Return).
 * Uses shadcn/ui DropdownMenu with MoreVertical trigger icon.
 *
 * MCP Guidance Applied:
 * - FE-001: FE_XSS_PREVENTION - React JSX auto-escaping, no dangerouslySetInnerHTML
 * - SEC-004: XSS - All output escaped via JSX
 * - SEC-014: INPUT_VALIDATION - Type-safe props with TypeScript interfaces
 * - ARCH-001: FE_COMPONENT_DESIGN - Single responsibility component
 *
 * @module renderer/components/lottery/BinActionsMenu
 */

import { useCallback } from 'react';
import { MoreVertical, Package, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Props for BinActionsMenu component
 * SEC-014: Strict type definitions for component props
 */
export interface BinActionsMenuProps {
  /** Pack UUID for action callbacks */
  packId: string;
  /** Pack number for display/accessibility */
  packNumber: string;
  /** Callback when "Mark Sold" is selected */
  onMarkSold?: (packId: string) => void;
  /** Callback when "Return" is selected */
  onReturn?: (packId: string) => void;
  /** Whether the menu is disabled */
  disabled?: boolean;
  /** Data test ID prefix for testing */
  testIdPrefix?: string;
}

/**
 * BinActionsMenu component
 *
 * Renders a ⋮ icon that opens a dropdown menu with Mark Sold and Return options.
 * Stops event propagation to prevent row click handlers from firing.
 *
 * @example
 * ```tsx
 * <BinActionsMenu
 *   packId="pack-001"
 *   packNumber="1234567"
 *   onMarkSold={(id) => openMarkSoldDialog(id)}
 *   onReturn={(id) => openReturnDialog(id)}
 * />
 * ```
 */
export function BinActionsMenu({
  packId,
  packNumber,
  onMarkSold,
  onReturn,
  disabled = false,
  testIdPrefix = '',
}: BinActionsMenuProps) {
  /**
   * Handle Mark Sold selection
   * SEC-014: packId is validated at component boundary (string type)
   */
  const handleMarkSold = useCallback(() => {
    onMarkSold?.(packId);
  }, [onMarkSold, packId]);

  /**
   * Handle Return selection
   * SEC-014: packId is validated at component boundary (string type)
   */
  const handleReturn = useCallback(() => {
    onReturn?.(packId);
  }, [onReturn, packId]);

  // Don't render menu if no actions are available
  if (!onMarkSold && !onReturn) {
    return <span className="text-muted-foreground">--</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 hover:bg-muted"
          disabled={disabled}
          onClick={(e) => e.stopPropagation()} // Prevent row click
          data-testid={`${testIdPrefix}actions-menu-trigger`}
          aria-label={`Actions for pack ${packNumber}`}
        >
          <MoreVertical className="h-4 w-4 text-muted-foreground" />
          <span className="sr-only">Open actions menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-40"
        onClick={(e) => e.stopPropagation()} // Prevent row click on menu
      >
        {onMarkSold && (
          <DropdownMenuItem
            onClick={handleMarkSold}
            className="cursor-pointer"
            data-testid={`${testIdPrefix}mark-sold-menu-item`}
          >
            <Package className="mr-2 h-4 w-4" />
            <span>Mark Sold</span>
          </DropdownMenuItem>
        )}
        {onReturn && (
          <DropdownMenuItem
            onClick={handleReturn}
            className="cursor-pointer"
            data-testid={`${testIdPrefix}return-menu-item`}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            <span>Return</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
