import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Check, AlertTriangle, XCircle } from 'lucide-react';
import {
  sanitizeForDisplay,
  maskEmployeeName,
  maskSensitiveData,
  formatCurrency,
} from '../../lib/utils/security';

/**
 * RecentShiftHistory Component
 *
 * Displays a full-width table of recent shifts with variance indicators.
 *
 * Security Features:
 * - SEC-004: XSS prevention via sanitized output
 * - FE-005: Employee name and shift ID masking for privacy
 * - WCAG 2.1: Full accessibility support with variance status announcements
 *
 * Story: MyStore Dashboard Redesign
 */

// Sample shift data - will be replaced with real API data
const shifts = [
  {
    id: 'SFT-000446',
    cashier: 'Sarah Miller',
    time: '2:00 PM - Now',
    totalSales: 2145.5,
    transactions: 86,
    cashVariance: { amount: 0, status: 'ok' as const },
    lotteryVariance: { count: 0, status: 'ok' as const },
    status: 'active' as const,
  },
  {
    id: 'SFT-000445',
    cashier: 'John Davis',
    time: '6:00 AM - 2:00 PM',
    totalSales: 3245.0,
    transactions: 142,
    cashVariance: { amount: 0, status: 'ok' as const },
    lotteryVariance: { count: 0, status: 'ok' as const },
    status: 'closed' as const,
  },
  {
    id: 'SFT-000444',
    cashier: 'Mike Johnson',
    time: '10:00 PM - 6:00 AM',
    totalSales: 1892.25,
    transactions: 78,
    cashVariance: { amount: -2.5, status: 'warning' as const },
    lotteryVariance: { count: 0, status: 'ok' as const },
    status: 'review' as const,
  },
  {
    id: 'SFT-000443',
    cashier: 'Emily Chen',
    time: '2:00 PM - 10:00 PM',
    totalSales: 4125.75,
    transactions: 168,
    cashVariance: { amount: 0, status: 'ok' as const },
    lotteryVariance: { count: -2, status: 'critical' as const },
    status: 'flagged' as const,
  },
];

const statusVariants: Record<string, 'default' | 'success' | 'warning' | 'destructive'> = {
  active: 'default',
  closed: 'success',
  review: 'warning',
  flagged: 'destructive',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  closed: 'Closed',
  review: 'Review',
  flagged: 'Flagged',
};

// Status descriptions for screen readers
const statusAriaLabels: Record<string, string> = {
  ok: 'No variance, balanced',
  warning: 'Minor variance, needs review',
  critical: 'Critical variance, flagged for attention',
};

function VarianceIndicator({
  status,
  value,
  isCurrency = true,
}: {
  status: 'ok' | 'warning' | 'critical';
  value: number;
  isCurrency?: boolean;
}) {
  const icons = {
    ok: <Check className="w-3 h-3" aria-hidden="true" />,
    warning: <AlertTriangle className="w-3 h-3" aria-hidden="true" />,
    critical: <XCircle className="w-3 h-3" aria-hidden="true" />,
  };

  const colors = {
    ok: 'text-success',
    warning: 'text-warning',
    critical: 'text-destructive',
  };

  const displayValue = isCurrency ? formatCurrency(Math.abs(value)) : value.toString();

  // eslint-disable-next-line security/detect-object-injection -- Safe: status is typed 'ok' | 'warning' | 'critical'
  const colorClass = colors[status as keyof typeof colors];
  // eslint-disable-next-line security/detect-object-injection -- Safe: status is typed 'ok' | 'warning' | 'critical'
  const iconElement = icons[status as keyof typeof icons];
  // eslint-disable-next-line security/detect-object-injection -- Safe: status is typed 'ok' | 'warning' | 'critical'
  const ariaLabel = `${statusAriaLabels[status]}: ${value < 0 ? 'negative ' : ''}${displayValue}`;

  return (
    <span
      className={`flex items-center gap-1 text-xs sm:text-sm ${colorClass}`}
      role="status"
      aria-label={ariaLabel}
    >
      {iconElement}
      {value < 0 && isCurrency ? '-' : ''}
      {displayValue}
    </span>
  );
}

export function RecentShiftHistory() {
  return (
    <Card
      data-testid="recent-shift-history"
      role="region"
      aria-labelledby="recent-shift-history-title"
    >
      <CardHeader className="flex flex-row items-center justify-between p-3 sm:p-4 lg:p-5 border-b gap-2">
        <CardTitle id="recent-shift-history-title" className="text-sm sm:text-base font-semibold">
          Recent Shift History
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="text-xs flex-shrink-0"
          aria-label="View all shift history"
        >
          View All Shifts
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table
          aria-label="Recent shift history with variance tracking"
          className="min-w-[700px]"
          size="compact"
          nested
        >
          <TableHeader>
            <TableRow>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Shift ID
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Cashier
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap hidden md:table-cell"
                scope="col"
              >
                Time
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Total Sales
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap hidden lg:table-cell"
                scope="col"
              >
                Transactions
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap hidden sm:table-cell"
                scope="col"
              >
                Cash Variance
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap hidden sm:table-cell"
                scope="col"
              >
                Lottery Variance
              </TableHead>
              <TableHead
                className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shifts.map((shift) => {
              // Sanitize and mask all display values (SEC-004, FE-005)
              const safeShiftId = maskSensitiveData(shift.id, 4);
              const safeCashier = maskEmployeeName(shift.cashier);
              const safeTime = sanitizeForDisplay(shift.time);
              const formattedSales = formatCurrency(shift.totalSales);
              const safeStatus = sanitizeForDisplay(statusLabels[shift.status]);

              return (
                <TableRow key={shift.id}>
                  <TableCell>
                    <span
                      className="font-mono text-xs sm:text-sm text-primary"
                      title={`Shift ${safeShiftId}`}
                    >
                      {safeShiftId}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs sm:text-sm">{safeCashier}</TableCell>
                  <TableCell className="hidden md:table-cell text-xs sm:text-sm">
                    <time dateTime={safeTime}>{safeTime}</time>
                  </TableCell>
                  <TableCell>
                    <span
                      className="font-semibold text-xs sm:text-sm"
                      aria-label={`Total sales: ${formattedSales}`}
                    >
                      {formattedSales}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs sm:text-sm">
                    {shift.transactions}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <VarianceIndicator
                      status={shift.cashVariance.status}
                      value={shift.cashVariance.amount}
                    />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <VarianceIndicator
                      status={shift.lotteryVariance.status}
                      value={shift.lotteryVariance.count}
                      isCurrency={false}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={statusVariants[shift.status]}
                      className="text-[10px] sm:text-xs"
                      aria-label={`Shift status: ${safeStatus}`}
                    >
                      {safeStatus}
                    </Badge>
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
