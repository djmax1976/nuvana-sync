/**
 * Lottery Sales Details Component
 *
 * Displays detailed breakdown of lottery sales after day/shift close.
 * Shows each bin's tickets sold, prices, and amounts in a table format.
 *
 * @security
 * - FE-005: UI_SECURITY - No sensitive data exposed
 * - SEC-004: XSS - All outputs are properly escaped by React
 * - API-008: OUTPUT_FILTERING - Only displays whitelisted fields from API
 * - SEC-014: INPUT_VALIDATION - All numeric values sanitized before display
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { LotterySalesDetailsProps } from './types';
import { formatCurrency } from './utils';

/**
 * Safely convert a value to a number, returning 0 for invalid/NaN values
 * SEC-014: INPUT_VALIDATION - Sanitize numeric input before display
 */
function safeNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Lottery Sales Details Table
 *
 * Displays comprehensive breakdown of lottery sales including:
 * - Bin number
 * - Game name
 * - Ticket price
 * - Starting and ending serial numbers
 * - Tickets sold count
 * - Sales amount per pack
 * - Totals row
 */
export function LotterySalesDetails({ data }: LotterySalesDetailsProps) {
  // Memoize total tickets calculation - must be before any early return (Rules of Hooks)
  // SEC-014: Ensure we handle undefined/NaN values gracefully with safeNumber conversion
  const totalTickets = useMemo(
    () =>
      data?.bins_closed?.reduce((sum: number, bin: { tickets_sold: number }) => {
        return sum + safeNumber(bin.tickets_sold);
      }, 0) ?? 0,
    [data?.bins_closed]
  );

  // Don't render if no bins closed
  if (!data || data.bins_closed.length === 0) {
    return null;
  }

  return (
    <Card data-testid="lottery-sales-details">
      <CardHeader>
        <CardTitle className="text-lg">Lottery Sales Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm" role="table" aria-label="Lottery sales breakdown">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b bg-card">
                <th scope="col" className="text-left py-2 px-2 font-medium bg-card">
                  Bin
                </th>
                <th scope="col" className="text-left py-2 px-2 font-medium bg-card">
                  Game
                </th>
                <th scope="col" className="text-right py-2 px-2 font-medium bg-card">
                  Price
                </th>
                <th scope="col" className="text-right py-2 px-2 font-medium bg-card">
                  Start
                </th>
                <th scope="col" className="text-right py-2 px-2 font-medium bg-card">
                  End
                </th>
                <th scope="col" className="text-right py-2 px-2 font-medium bg-card">
                  Sold
                </th>
                <th scope="col" className="text-right py-2 px-2 font-medium bg-card">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {data.bins_closed.map(
                (
                  bin: {
                    bin_number: number;
                    pack_number: string;
                    game_name: string;
                    game_price: number;
                    starting_serial: string;
                    closing_serial: string;
                    tickets_sold: number;
                    sales_amount: number;
                  },
                  index: number
                ) => (
                  <tr
                    key={`${bin.pack_number}-${index}`}
                    className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    data-testid={`lottery-row-${bin.bin_number}`}
                  >
                    <td className="py-2 px-2 font-mono">{safeNumber(bin.bin_number)}</td>
                    <td className="py-2 px-2" title={bin.pack_number || ''}>
                      {bin.game_name || 'Unknown'}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      {formatCurrency(safeNumber(bin.game_price))}
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-muted-foreground">
                      {bin.starting_serial || '-'}
                    </td>
                    <td className="py-2 px-2 text-right font-mono">{bin.closing_serial || '-'}</td>
                    <td className="py-2 px-2 text-right font-mono">
                      {safeNumber(bin.tickets_sold)}
                    </td>
                    <td className="py-2 px-2 text-right font-mono font-medium">
                      {formatCurrency(safeNumber(bin.sales_amount))}
                    </td>
                  </tr>
                )
              )}
            </tbody>
            <tfoot className="sticky bottom-0 bg-card">
              <tr className="bg-muted/50 font-bold" data-testid="lottery-totals-row">
                <td colSpan={5} className="py-2 px-2">
                  Total Lottery Sales
                </td>
                <td className="py-2 px-2 text-right font-mono">{totalTickets}</td>
                <td className="py-2 px-2 text-right font-mono text-green-600 dark:text-green-400">
                  {formatCurrency(safeNumber(data.lottery_total))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
