import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import {
  maskTransactionId,
  formatCurrency,
  sanitizeForDisplay,
  sanitizeId,
} from "../../lib/utils/security";

/**
 * RecentTransactions Component
 *
 * Displays a table of recent transactions with type badges.
 *
 * Security Features:
 * - SEC-004: XSS prevention via sanitized output
 * - FE-005: Transaction ID masking for privacy
 * - API-008: Safe currency formatting
 * - WCAG 2.1: Full accessibility support
 *
 * Story: MyStore Dashboard Redesign
 */

// Sample transaction data - will be replaced with real API data
const transactions = [
  {
    id: "TXN-8847291",
    type: "Credit" as const,
    time: "4:32 PM",
    amount: 47.85,
  },
  {
    id: "TXN-8847290",
    type: "Cash" as const,
    time: "4:28 PM",
    amount: 23.5,
  },
  {
    id: "TXN-8847289",
    type: "EBT" as const,
    time: "4:21 PM",
    amount: 156.32,
  },
  {
    id: "TXN-8847288",
    type: "Debit" as const,
    time: "4:15 PM",
    amount: 12.99,
  },
  {
    id: "TXN-8847287",
    type: "Cash" as const,
    time: "4:08 PM",
    amount: 8.75,
  },
];

const typeVariants: Record<string, "default" | "success" | "warning"> = {
  Credit: "default",
  Debit: "default",
  Cash: "success",
  EBT: "warning",
};

// Type labels for screen readers
const typeAriaLabels: Record<string, string> = {
  Credit: "Credit card payment",
  Debit: "Debit card payment",
  Cash: "Cash payment",
  EBT: "Electronic Benefits Transfer payment",
};

export function RecentTransactions() {
  return (
    <Card
      data-testid="recent-transactions"
      role="region"
      aria-labelledby="recent-transactions-title"
    >
      <CardHeader className="flex flex-row items-center justify-between p-5 border-b">
        <CardTitle
          id="recent-transactions-title"
          className="text-base font-semibold"
        >
          Recent Transactions
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          aria-label="View all transactions"
        >
          View All
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table aria-label="Recent transactions table">
          <TableHeader>
            <TableRow>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider"
                scope="col"
              >
                Transaction ID
              </TableHead>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider"
                scope="col"
              >
                Type
              </TableHead>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider"
                scope="col"
              >
                Time
              </TableHead>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider"
                scope="col"
              >
                Amount
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((txn) => {
              // Sanitize ID for use as key (SEC-004)
              const safeKey = sanitizeId(txn.id) || txn.id;
              // Mask transaction ID for display (FE-005)
              const maskedId = maskTransactionId(txn.id);
              // Sanitize type for display
              const safeType = sanitizeForDisplay(txn.type);
              // Format currency safely
              const formattedAmount = formatCurrency(txn.amount);
              // Sanitize time
              const safeTime = sanitizeForDisplay(txn.time);

              return (
                <TableRow key={safeKey}>
                  <TableCell>
                    <span
                      className="font-mono text-sm text-primary"
                      title={`Transaction ${maskedId}`}
                    >
                      {maskedId}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={typeVariants[txn.type]}
                      aria-label={typeAriaLabels[txn.type] || safeType}
                    >
                      {safeType}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <time dateTime={safeTime}>{safeTime}</time>
                  </TableCell>
                  <TableCell>
                    <span
                      className="font-semibold"
                      aria-label={`Amount: ${formattedAmount}`}
                    >
                      {formattedAmount}
                    </span>
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
