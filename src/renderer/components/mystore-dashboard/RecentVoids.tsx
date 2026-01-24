import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import {
  sanitizeForDisplay,
  maskEmployeeName,
  maskSensitiveData,
  formatCurrency,
} from '../../lib/utils/security';

/**
 * RecentVoids Component
 *
 * Displays a full-width table of recent voided transactions.
 *
 * Security Features:
 * - SEC-004: XSS prevention via sanitized output
 * - FE-005: Employee name and ID masking for privacy
 * - WCAG 2.1: Full accessibility support with proper table semantics
 *
 * Story: MyStore Dashboard Redesign
 */

// Sample voids data - will be replaced with real API data
const voids = [
  {
    id: '1',
    terminal: 'POS-001',
    shiftId: 'SFT-000446',
    cashier: 'Sarah Miller',
    amount: -12.99,
    dateTime: 'Dec 25, 2024 @ 3:45 PM',
  },
  {
    id: '2',
    terminal: 'POS-002',
    shiftId: 'SFT-000446',
    cashier: 'Sarah Miller',
    amount: -5.49,
    dateTime: 'Dec 25, 2024 @ 2:32 PM',
  },
  {
    id: '3',
    terminal: 'POS-001',
    shiftId: 'SFT-000445',
    cashier: 'John Davis',
    amount: -23.75,
    dateTime: 'Dec 25, 2024 @ 11:15 AM',
  },
  {
    id: '4',
    terminal: 'POS-001',
    shiftId: 'SFT-000445',
    cashier: 'John Davis',
    amount: -8.99,
    dateTime: 'Dec 25, 2024 @ 9:22 AM',
  },
  {
    id: '5',
    terminal: 'POS-002',
    shiftId: 'SFT-000444',
    cashier: 'Mike Johnson',
    amount: -45.0,
    dateTime: 'Dec 25, 2024 @ 2:18 AM',
  },
];

export function RecentVoids() {
  return (
    <Card data-testid="recent-voids" role="region" aria-labelledby="recent-voids-title">
      <CardHeader className="flex flex-row items-center justify-between p-3 sm:p-4 lg:p-5 border-b gap-2">
        <CardTitle id="recent-voids-title" className="text-sm sm:text-base font-semibold">
          Recent Voids
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="text-xs flex-shrink-0"
          aria-label="View all voided transactions"
        >
          View All Voids
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table
          aria-label="Recent voided transactions"
          className="min-w-[500px]"
          size="compact"
          nested
        >
          <TableHeader>
            <TableRow>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Terminal
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap hidden sm:table-cell"
                scope="col"
              >
                Shift
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Cashier
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Void Amount
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap hidden md:table-cell"
                scope="col"
              >
                Date & Time
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {voids.map((voidItem) => {
              // Sanitize and mask all display values (SEC-004, FE-005)
              const safeTerminal = sanitizeForDisplay(voidItem.terminal);
              const safeShiftId = maskSensitiveData(voidItem.shiftId, 4);
              const safeCashier = maskEmployeeName(voidItem.cashier);
              const formattedAmount = formatCurrency(Math.abs(voidItem.amount));
              const safeDateTime = sanitizeForDisplay(voidItem.dateTime);

              return (
                <TableRow key={voidItem.id}>
                  <TableCell>
                    <span
                      className="font-mono text-xs sm:text-sm text-primary"
                      title={`Terminal ${safeTerminal}`}
                    >
                      {safeTerminal}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span
                      className="font-mono text-xs sm:text-sm text-primary"
                      title={`Shift ${safeShiftId}`}
                    >
                      {safeShiftId}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs sm:text-sm">{safeCashier}</TableCell>
                  <TableCell>
                    <span
                      className="font-semibold text-destructive text-xs sm:text-sm"
                      aria-label={`Void amount: negative ${formattedAmount}`}
                    >
                      -{formattedAmount}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs sm:text-sm">
                    <time dateTime={safeDateTime}>{safeDateTime}</time>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
