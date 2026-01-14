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
      <CardHeader className="flex flex-row items-center justify-between p-5 border-b">
        <CardTitle id="recent-voids-title" className="text-base font-semibold">
          Recent Voids
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          aria-label="View all voided transactions"
        >
          View All Voids
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table aria-label="Recent voided transactions">
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-semibold uppercase tracking-wider" scope="col">
                Terminal
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider" scope="col">
                Shift
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider" scope="col">
                Cashier
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider" scope="col">
                Void Amount
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wider" scope="col">
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
                      className="font-mono text-sm text-primary"
                      title={`Terminal ${safeTerminal}`}
                    >
                      {safeTerminal}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-sm text-primary" title={`Shift ${safeShiftId}`}>
                      {safeShiftId}
                    </span>
                  </TableCell>
                  <TableCell>{safeCashier}</TableCell>
                  <TableCell>
                    <span
                      className="font-semibold text-destructive"
                      aria-label={`Void amount: negative ${formattedAmount}`}
                    >
                      -{formattedAmount}
                    </span>
                  </TableCell>
                  <TableCell>
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
