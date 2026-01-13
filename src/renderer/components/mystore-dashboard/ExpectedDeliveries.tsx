import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import { Badge } from "../ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Calendar } from "lucide-react";
import { sanitizeForDisplay, sanitizeId } from "../../lib/utils/security";

/**
 * ExpectedDeliveries Component
 *
 * Displays a table of expected vendor deliveries for the day
 * with status indicators (Delivered/Pending)
 *
 * Security Features:
 * - SEC-004: XSS prevention via sanitized output
 * - WCAG 2.1: Full accessibility support with proper table semantics
 *
 * Story: MyStore Dashboard Redesign
 */

// Sample delivery data - will be replaced with real API data
const deliveries = [
  {
    id: "1",
    vendor: "Pepsi",
    initials: "PEP",
    bgColor: "bg-green-100",
    textColor: "text-green-700",
    status: "delivered" as const,
  },
  {
    id: "2",
    vendor: "Coca-Cola",
    initials: "CC",
    bgColor: "bg-red-100",
    textColor: "text-red-700",
    status: "pending" as const,
  },
  {
    id: "3",
    vendor: "Frito-Lay",
    initials: "FL",
    bgColor: "bg-orange-100",
    textColor: "text-orange-700",
    status: "pending" as const,
  },
  {
    id: "4",
    vendor: "McLane",
    initials: "MC",
    bgColor: "bg-blue-100",
    textColor: "text-blue-700",
    status: "delivered" as const,
  },
  {
    id: "5",
    vendor: "Hostess Brands",
    initials: "HB",
    bgColor: "bg-pink-100",
    textColor: "text-pink-700",
    status: "delivered" as const,
  },
];

// Status labels for screen readers
const statusAriaLabels: Record<string, string> = {
  delivered: "Delivery completed",
  pending: "Delivery pending",
};

export function ExpectedDeliveries() {
  return (
    <Card
      className="min-h-[380px] flex flex-col"
      data-testid="expected-deliveries"
      role="region"
      aria-labelledby="expected-deliveries-title"
    >
      <CardHeader className="flex flex-row items-center justify-between p-5 border-b">
        <CardTitle
          id="expected-deliveries-title"
          className="text-base font-semibold"
        >
          Expected Deliveries
        </CardTitle>
        <button
          className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground bg-muted/50 rounded-md border hover:border-primary transition-colors"
          aria-label="Filter deliveries by date: Today selected"
        >
          <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
          Today
        </button>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-x-auto">
        <Table aria-label="Expected vendor deliveries for today" className="min-w-[280px]">
          <TableHeader>
            <TableRow>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Vendor
              </TableHead>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Status
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((delivery) => {
              // Sanitize all display values (SEC-004: XSS prevention)
              const safeKey = sanitizeId(delivery.id) || delivery.id;
              const safeVendor = sanitizeForDisplay(delivery.vendor);
              const safeInitials = sanitizeForDisplay(delivery.initials);
              const statusLabel =
                delivery.status === "delivered" ? "Delivered" : "Pending";

              return (
                <TableRow key={safeKey}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-md shrink-0 ${delivery.bgColor} flex items-center justify-center`}
                        aria-hidden="true"
                      >
                        <span
                          className={`text-[10px] sm:text-[11px] font-semibold ${delivery.textColor}`}
                        >
                          {safeInitials}
                        </span>
                      </div>
                      <span className="font-medium text-sm truncate max-w-[100px] sm:max-w-none">{safeVendor}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        delivery.status === "delivered"
                          ? "success"
                          : "secondary"
                      }
                      className={`text-xs ${
                        delivery.status === "pending"
                          ? "bg-muted text-muted-foreground"
                          : ""
                      }`}
                      aria-label={
                        statusAriaLabels[delivery.status] || statusLabel
                      }
                    >
                      {statusLabel}
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
