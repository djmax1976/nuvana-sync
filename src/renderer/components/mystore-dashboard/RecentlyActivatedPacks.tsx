import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import {
  sanitizeForDisplay,
  maskSensitiveData,
  maskEmployeeName,
  sanitizeId,
} from '../../lib/utils/security';

/**
 * RecentlyActivatedPacks Component
 *
 * Displays a table of recently activated lottery packs
 * with game name, pack ID, and activator name
 *
 * Security Features:
 * - SEC-004: XSS prevention via sanitized output
 * - FE-005: Employee name and pack ID masking for privacy
 * - WCAG 2.1: Full accessibility support with proper table semantics
 *
 * Story: MyStore Dashboard Redesign
 */

// Sample pack data - will be replaced with real API data
const recentPacks = [
  {
    id: '1',
    game: 'Lucky 7s ($1)',
    packId: 'PKG-004821',
    activatedBy: 'Sarah Miller',
  },
  {
    id: '2',
    game: 'Cash Bonanza ($2)',
    packId: 'PKG-004820',
    activatedBy: 'John Davis',
  },
  {
    id: '3',
    game: 'Diamond Doubler ($5)',
    packId: 'PKG-004819',
    activatedBy: 'Sarah Miller',
  },
  {
    id: '4',
    game: 'Mega Millions ($10)',
    packId: 'PKG-004818',
    activatedBy: 'Mike Johnson',
  },
  {
    id: '5',
    game: 'Jackpot Fortune ($20)',
    packId: 'PKG-004817',
    activatedBy: 'Emily Chen',
  },
];

export function RecentlyActivatedPacks() {
  return (
    <Card
      className="min-h-[380px] flex flex-col"
      data-testid="recently-activated-packs"
      role="region"
      aria-labelledby="recently-activated-packs-title"
    >
      <CardHeader className="flex flex-row items-center justify-between p-5 border-b">
        <CardTitle id="recently-activated-packs-title" className="text-base font-semibold">
          Recently Activated Packs
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          aria-label="View all activated lottery packs"
        >
          View All
        </Button>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-x-auto">
        <Table aria-label="Recently activated lottery packs" className="min-w-[320px]">
          <TableHeader>
            <TableRow>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Game
              </TableHead>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                scope="col"
              >
                Pack
              </TableHead>
              <TableHead
                className="text-xs font-semibold uppercase tracking-wider whitespace-nowrap hidden sm:table-cell"
                scope="col"
              >
                Activated By
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentPacks.map((pack) => {
              // Sanitize all display values (SEC-004: XSS prevention)
              const safeKey = sanitizeId(pack.id) || pack.id;
              const safeGame = sanitizeForDisplay(pack.game);
              // Mask pack ID for privacy (FE-005)
              const maskedPackId = maskSensitiveData(pack.packId, 4);
              // Mask employee name for privacy (FE-005)
              const maskedActivator = maskEmployeeName(pack.activatedBy);

              return (
                <TableRow key={safeKey}>
                  <TableCell className="font-medium text-sm max-w-[120px] truncate">
                    {safeGame}
                  </TableCell>
                  <TableCell>
                    <span
                      className="font-mono text-xs sm:text-sm text-primary"
                      title={`Pack ${maskedPackId}`}
                    >
                      {maskedPackId}
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm">{maskedActivator}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
