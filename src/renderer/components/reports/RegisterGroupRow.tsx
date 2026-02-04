/**
 * Register Group Row Component for Reports
 *
 * Renders a subtle divider row that groups shifts by register name.
 * Provides visual separation and labeling for register groups within the table.
 *
 * @module renderer/components/reports/RegisterGroupRow
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-001: No dangerouslySetInnerHTML, all content is text
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface RegisterGroupRowProps {
  /** The name of the register (e.g., "POS1", "POS2") */
  registerName: string;
  /** Number of columns in the parent table (for colspan) */
  colSpan?: number;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for testing purposes */
  'data-testid'?: string;
}

/**
 * RegisterGroupRow Component
 *
 * Renders a full-width table row that acts as a section header for a register group.
 * Styled with a subtle background to visually separate register groups.
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-001: No use of dangerouslySetInnerHTML
 *
 * Accessibility:
 * - Uses scope="colgroup" for semantic table grouping
 * - Proper text contrast for readability
 *
 * @example
 * <RegisterGroupRow registerName="POS1" colSpan={6} />
 */
export const RegisterGroupRow = React.memo(function RegisterGroupRow({
  registerName,
  colSpan = 6,
  className,
  'data-testid': testId,
}: RegisterGroupRowProps) {
  // Handle empty or invalid register names defensively
  const displayName = registerName?.trim() || 'Unknown Register';

  return (
    <tr
      className={cn('register-group-row', className)}
      data-testid={testId ?? `register-group-${registerName}`}
      aria-label={`Register group: ${displayName}`}
    >
      <th
        colSpan={colSpan}
        scope="colgroup"
        className={cn(
          'bg-muted/50 px-6 py-2 text-left',
          'text-[11px] font-bold uppercase tracking-[1px] text-muted-foreground'
        )}
      >
        {displayName}
      </th>
    </tr>
  );
});

RegisterGroupRow.displayName = 'RegisterGroupRow';
