/**
 * Lottery Games Inventory Page
 *
 * Lists all lottery games with pack counts, filtering, and pagination.
 * Provides inventory visibility into games received, active, settled, and returned.
 *
 * Enterprise-grade implementation with:
 * - SEC-004: XSS - Uses React's automatic output encoding
 * - FE-001: STATE_MANAGEMENT - TanStack Query for state management
 * - FE-005: UI_SECURITY - No sensitive data exposed in DOM
 * - API-008: OUTPUT_FILTERING - Displays only controlled response fields
 *
 * @module renderer/pages/LotteryGamesPage
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useGamesListPaginated, usePacksByGame, useInvalidateLottery } from '../hooks/useLottery';
import { useClientDashboard } from '../lib/api/client-dashboard';
import { useAuthGuard } from '../hooks/useAuthGuard';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ReturnPackDialog } from '../components/lottery/ReturnPackDialog';
import { PackReceptionForm } from '../components/lottery/PackReceptionForm';
import { PinVerificationDialog, type VerifiedUser } from '../components/auth/PinVerificationDialog';
import {
  Search,
  Package,
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  Loader2,
  Undo2,
  Plus,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import type {
  GameListFilters,
  GameListPagination,
  LotteryGameStatus,
  GameListItem,
  LotteryPackResponse,
} from '../lib/api/lottery';

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: LotteryGameStatus | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'DISCONTINUED', label: 'Discontinued' },
];

const SORT_OPTIONS: { value: GameListPagination['sortBy']; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'game_code', label: 'Game Code' },
  { value: 'price', label: 'Price' },
  { value: 'created_at', label: 'Date Added' },
];

// ============================================================================
// Main Component
// ============================================================================

export default function LotteryGamesPage() {
  // Filter state
  const [statusFilter, setStatusFilter] = useState<LotteryGameStatus | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Expandable rows state - track which game IDs are expanded
  const [expandedGameIds, setExpandedGameIds] = useState<Set<string>>(new Set());

  // Return Pack dialog state
  // MCP: FE-001 STATE_MANAGEMENT - Controlled dialog state with pack ID and data tracking
  const [returnPackDialogOpen, setReturnPackDialogOpen] = useState(false);
  const [packIdToReturn, setPackIdToReturn] = useState<string | null>(null);
  const [packDataToReturn, setPackDataToReturn] = useState<LotteryPackResponse | null>(null);

  // Receive Pack dialog state
  // FE-001: Auth guard for session-first validation (check before showing dialog)
  const { executeWithAuth } = useAuthGuard('cashier');
  const [receptionDialogOpen, setReceptionDialogOpen] = useState(false);
  const [receptionPinDialogOpen, setReceptionPinDialogOpen] = useState(false);

  // Get store ID from dashboard
  const { data: dashboardData } = useClientDashboard();
  const storeId =
    dashboardData?.stores.find((s) => s.status === 'ACTIVE')?.store_id ||
    dashboardData?.stores[0]?.store_id;

  // Lottery invalidation for refresh after return
  const { invalidateAll } = useInvalidateLottery();

  // Pagination state
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<GameListPagination['sortBy']>('name');
  const [sortOrder, setSortOrder] = useState<GameListPagination['sortOrder']>('ASC');

  // Debounce search input (SEC-014: min 2 chars requirement)
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    // Reset pagination when search changes
    setOffset(0);

    // Debounce the actual search
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(value.length >= 2 ? value : '');
    }, 300);

    return () => clearTimeout(timeoutId);
  }, []);

  // Build query input
  // inventoryOnly=true ensures we only show games that have packs in store inventory
  // This matches the cloud inventory view behavior
  const queryInput = useMemo(() => {
    const filters: GameListFilters = {
      // Only show games with at least one pack in inventory
      inventoryOnly: true,
    };
    if (statusFilter) filters.status = statusFilter;
    if (debouncedSearch) filters.search = debouncedSearch;

    const pagination: GameListPagination = {
      limit: PAGE_SIZE,
      offset,
      sortBy,
      sortOrder,
    };

    return { filters, pagination };
  }, [statusFilter, debouncedSearch, offset, sortBy, sortOrder]);

  // Fetch games with TanStack Query
  const { data, isLoading, error } = useGamesListPaginated(queryInput);

  // Handlers
  const handleStatusChange = (status: LotteryGameStatus | undefined) => {
    setStatusFilter(status);
    setOffset(0);
  };

  const handleSortChange = (newSortBy: GameListPagination['sortBy']) => {
    if (sortBy === newSortBy) {
      // Toggle sort order
      setSortOrder((prev) => (prev === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSortBy(newSortBy);
      setSortOrder('ASC');
    }
    setOffset(0);
  };

  const handleNextPage = () => {
    if (data && data.hasMore) {
      setOffset((prev) => prev + PAGE_SIZE);
    }
  };

  const handlePrevPage = () => {
    setOffset((prev) => Math.max(0, prev - PAGE_SIZE));
  };

  // Toggle game row expansion
  const toggleExpanded = useCallback((gameId: string) => {
    setExpandedGameIds((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        next.add(gameId);
      }
      return next;
    });
  }, []);

  /**
   * Handle Return Pack button click
   * Opens the ReturnPackDialog for the selected pack
   *
   * MCP Guidance Applied:
   * - FE-001: STATE_MANAGEMENT - Controlled dialog state with pack data
   * - SEC-014: INPUT_VALIDATION - Pack ID validated by dialog before API call
   * - SEC-010: AUTHZ - ACTIVATED and RECEIVED packs can be returned (enforced server-side)
   */
  const handleReturnPackClick = useCallback((pack: LotteryPackResponse) => {
    setPackDataToReturn(pack);
    setPackIdToReturn(pack.pack_id);
    setReturnPackDialogOpen(true);
  }, []);

  /**
   * Handle successful pack return
   * Refreshes data and closes dialog
   *
   * MCP Guidance Applied:
   * - FE-001: STATE_MANAGEMENT - Clear dialog state after success
   */
  const handleReturnPackSuccess = useCallback(() => {
    invalidateAll(); // Refresh all lottery data
    setPackDataToReturn(null);
    setPackIdToReturn(null);
  }, [invalidateAll]);

  /**
   * Handle Receive Pack button click
   * FE-001: Check session first, only show PIN dialog if session invalid
   */
  const handleReceivePackClick = useCallback(() => {
    executeWithAuth(
      () => setReceptionDialogOpen(true),
      () => setReceptionPinDialogOpen(true)
    );
  }, [executeWithAuth]);

  /**
   * Handle Pack Reception PIN verification success
   * SEC-010: AUTHZ - PIN verification logs user in, backend tracks received_by from session
   */
  const handleReceptionPinVerified = useCallback((_user: VerifiedUser) => {
    setReceptionPinDialogOpen(false);
    setReceptionDialogOpen(true);
  }, []);

  // Error state
  if (error) {
    return (
      <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
        <h3 className="text-destructive font-medium">Error loading games</h3>
        <p className="text-destructive/80 text-sm mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-1">
            View all lottery games and their pack inventory
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleReceivePackClick} data-testid="receive-pack-button">
            <Plus className="mr-2 h-4 w-4" />
            Receive Pack
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or game code..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {searchQuery.length > 0 && searchQuery.length < 2 && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              Min 2 chars
            </span>
          )}
        </div>

        {/* Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status:</span>
          <div className="flex gap-1">
            {STATUS_OPTIONS.map((option) => (
              <FilterButton
                key={option.label}
                active={statusFilter === option.value}
                onClick={() => handleStatusChange(option.value)}
              >
                {option.label}
              </FilterButton>
            ))}
          </div>
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => handleSortChange(e.target.value as GameListPagination['sortBy'])}
            className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSortOrder((prev) => (prev === 'ASC' ? 'DESC' : 'ASC'))}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            title={`Sort ${sortOrder === 'ASC' ? 'ascending' : 'descending'}`}
          >
            <ArrowUpDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Games Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner />
          </div>
        ) : data && data.games.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="w-10 px-2 py-3"></th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Game
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Code
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Price
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      <span className="flex items-center justify-center gap-1">
                        <Package className="h-3.5 w-3.5" />
                        Total
                      </span>
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Received
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Active
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Depleted
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Returned
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-border">
                  {data.games.map((game) => (
                    <GameRowExpandable
                      key={game.game_id}
                      game={game}
                      storeId={storeId}
                      isExpanded={expandedGameIds.has(game.game_id)}
                      onToggleExpand={() => toggleExpanded(game.game_id)}
                      onReturnPack={handleReturnPackClick}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-6 py-3 bg-muted/50 border-t border-border flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {data.offset + 1} to {Math.min(data.offset + data.games.length, data.total)}{' '}
                of {data.total} games
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handlePrevPage}
                  disabled={offset === 0}
                  className="px-3 py-1 text-sm border border-border rounded text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                >
                  Previous
                </button>
                <button
                  onClick={handleNextPage}
                  disabled={!data.hasMore}
                  className="px-3 py-1 text-sm border border-border rounded text-foreground disabled:opacity-50 disabled:cursor-not-allowed hover:bg-muted"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">No games found</p>
            <p className="text-sm mt-1">
              {debouncedSearch
                ? 'Try adjusting your search or filters'
                : 'Games will appear here once synced from cloud'}
            </p>
          </div>
        )}
      </div>

      {/* Return Pack Dialog
          MCP Guidance Applied:
          - FE-001: STATE_MANAGEMENT - Controlled dialog with pack ID and data
          - FE-002: FORM_VALIDATION - Dialog validates all inputs before API call
          - SEC-014: INPUT_VALIDATION - Serial format and range validated
          - SEC-010: AUTHZ - ACTIVATED and RECEIVED packs can be returned (enforced in dialog + server)
      */}
      <ReturnPackDialog
        open={returnPackDialogOpen}
        onOpenChange={setReturnPackDialogOpen}
        packId={packIdToReturn}
        packData={packDataToReturn}
        onSuccess={handleReturnPackSuccess}
      />

      {/* Pack Reception PIN Verification Dialog
          SEC-010: AUTHZ - Verify user before allowing pack reception
      */}
      <PinVerificationDialog
        open={receptionPinDialogOpen}
        onClose={() => setReceptionPinDialogOpen(false)}
        onVerified={handleReceptionPinVerified}
        requiredRole="cashier"
        title="Verify PIN for Pack Reception"
        description="Enter your PIN to receive lottery packs into inventory."
      />

      {/* Pack Reception Dialog */}
      <PackReceptionForm
        storeId={storeId!}
        open={receptionDialogOpen}
        onOpenChange={setReceptionDialogOpen}
        onSuccess={() => invalidateAll()}
      />
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function FilterButton({ active, onClick, children }: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm rounded-full transition-colors ${
        active
          ? 'bg-primary/10 text-primary font-medium'
          : 'bg-muted text-muted-foreground hover:bg-muted/80'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Expandable Game Row Component
 *
 * Shows game summary with expand/collapse functionality.
 * When expanded, fetches and displays individual packs with Return button.
 *
 * MCP Guidance Applied:
 * - FE-001: STATE_MANAGEMENT - TanStack Query for pack data fetching
 * - SEC-004: XSS - React auto-escapes all text content
 * - FE-005: UI_SECURITY - No sensitive data exposed in DOM
 * - SEC-010: AUTHZ - Return button only for ACTIVATED/RECEIVED packs
 */
interface GameRowExpandableProps {
  game: GameListItem;
  storeId: string | undefined;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onReturnPack: (pack: LotteryPackResponse) => void;
}

function GameRowExpandable({
  game,
  storeId,
  isExpanded,
  onToggleExpand,
  onReturnPack,
}: GameRowExpandableProps) {
  // Fetch packs when expanded (FE-001: STATE_MANAGEMENT - lazy loading)
  const {
    data: packs,
    isLoading: packsLoading,
    error: packsError,
  } = usePacksByGame(game.game_id, storeId, {
    enabled: isExpanded && !!storeId,
  });

  // Determine if row can be expanded (has packs)
  const canExpand = game.pack_counts.total > 0;

  return (
    <React.Fragment>
      {/* Main Game Row */}
      <tr
        className={`hover:bg-muted/50 ${canExpand ? 'cursor-pointer' : ''} ${isExpanded ? 'bg-primary/5' : ''}`}
        onClick={canExpand ? onToggleExpand : undefined}
        data-testid={`game-row-${game.game_id}`}
      >
        {/* Expand/Collapse Button */}
        <td className="w-10 px-2 py-4">
          {canExpand && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
              className="p-1 rounded hover:bg-muted"
              aria-label={isExpanded ? 'Collapse packs' : 'Expand packs'}
              data-testid={`expand-game-${game.game_id}`}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          )}
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <div className="text-sm font-medium text-foreground">{game.name}</div>
          {game.tickets_per_pack && (
            <div className="text-xs text-muted-foreground">
              {game.tickets_per_pack} tickets/pack
            </div>
          )}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground font-mono">
          {game.game_code}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground text-right font-medium">
          {formatCurrency(game.price)}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center">
          <StatusBadge status={game.status} />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center">
          <span className="text-sm font-semibold text-foreground">{game.pack_counts.total}</span>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center">
          <PackCountBadge count={game.pack_counts.received} variant="received" />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center">
          <PackCountBadge count={game.pack_counts.active} variant="active" />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center">
          <PackCountBadge count={game.pack_counts.depleted} variant="depleted" />
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center">
          <PackCountBadge count={game.pack_counts.returned} variant="returned" />
        </td>
      </tr>

      {/* Expanded Packs Section */}
      {isExpanded && (
        <>
          {/* Packs Header Row */}
          <tr className="bg-gradient-to-r from-blue-50 to-slate-50 dark:from-blue-950 dark:to-slate-900 border-l-[3px] border-l-blue-500 dark:border-l-blue-400">
            <td className="w-10"></td>
            <td className="px-6 py-2 text-xs font-medium text-blue-700 dark:text-blue-300">
              Pack #
            </td>
            <td className="px-6 py-2 text-xs font-medium text-blue-700 dark:text-blue-300">
              Opening
            </td>
            <td className="px-6 py-2 text-xs font-medium text-blue-700 dark:text-blue-300">
              Closing
            </td>
            <td className="px-6 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 text-center">
              Status
            </td>
            <td className="px-6 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 text-center">
              Received
            </td>
            <td className="px-6 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 text-center">
              Activated
            </td>
            <td
              className="px-6 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 text-center"
              colSpan={2}
            >
              Actions
            </td>
            <td></td>
          </tr>

          {/* Loading State */}
          {packsLoading && (
            <tr className="bg-gradient-to-r from-blue-50 to-slate-50 dark:from-blue-950 dark:to-slate-900 border-l-[3px] border-l-blue-500 dark:border-l-blue-400">
              <td colSpan={10} className="px-6 py-4 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mx-auto" />
              </td>
            </tr>
          )}

          {/* Error State */}
          {packsError && (
            <tr className="bg-gradient-to-r from-blue-50 to-slate-50 dark:from-blue-950 dark:to-slate-900 border-l-[3px] border-l-blue-500 dark:border-l-blue-400">
              <td colSpan={10} className="px-6 py-4 text-center text-destructive text-sm">
                Failed to load packs
              </td>
            </tr>
          )}

          {/* Packs List */}
          {packs &&
            packs.map((pack) => {
              // SEC-010: AUTHZ - Only ACTIVATED and RECEIVED packs can be returned
              const canReturn = pack.status === 'ACTIVE' || pack.status === 'RECEIVED';

              return (
                <tr
                  key={pack.pack_id}
                  className="bg-gradient-to-r from-blue-50 to-slate-50 dark:from-blue-950 dark:to-slate-900 border-l-[3px] border-l-blue-500 dark:border-l-blue-400 hover:from-blue-100 hover:to-blue-50 dark:hover:from-blue-900 dark:hover:to-blue-950"
                  data-testid={`pack-row-${pack.pack_id}`}
                >
                  <td className="w-10"></td>
                  <td className="px-6 py-3 text-sm font-mono">{pack.pack_number}</td>
                  <td className="px-6 py-3 text-sm font-mono text-muted-foreground">
                    {pack.opening_serial || '--'}
                  </td>
                  <td className="px-6 py-3 text-sm font-mono text-muted-foreground">
                    {pack.closing_serial || '--'}
                  </td>
                  <td className="px-6 py-3 text-center">
                    <PackStatusBadge status={pack.status} />
                  </td>
                  <td className="px-6 py-3 text-sm text-muted-foreground text-center">
                    {formatDate(pack.received_at)}
                  </td>
                  <td className="px-6 py-3 text-sm text-muted-foreground text-center">
                    {pack.activated_at ? formatDate(pack.activated_at) : '--'}
                  </td>
                  <td className="px-6 py-3 text-center" colSpan={2}>
                    {canReturn && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReturnPack(pack);
                        }}
                        className="h-7 text-xs px-2"
                        data-testid={`return-pack-btn-${pack.pack_id}`}
                        aria-label={`Return pack ${pack.pack_number}`}
                      >
                        <Undo2 className="h-3 w-3 mr-1" />
                        Return
                      </Button>
                    )}
                    {pack.status === 'RETURNED' && (
                      <span className="text-xs text-orange-600 dark:text-orange-400">
                        Returned {pack.returned_at ? formatDate(pack.returned_at) : ''}
                      </span>
                    )}
                    {pack.status === 'DEPLETED' && (
                      <span className="text-xs text-muted-foreground">Depleted</span>
                    )}
                  </td>
                  <td></td>
                </tr>
              );
            })}

          {/* Empty State */}
          {packs && packs.length === 0 && (
            <tr className="bg-gradient-to-r from-blue-50 to-slate-50 dark:from-blue-950 dark:to-slate-900 border-l-[3px] border-l-blue-500 dark:border-l-blue-400">
              <td colSpan={10} className="px-6 py-4 text-center text-muted-foreground text-sm">
                No packs found for this game
              </td>
            </tr>
          )}
        </>
      )}
    </React.Fragment>
  );
}

interface StatusBadgeProps {
  status: LotteryGameStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const colors: Record<LotteryGameStatus, string> = {
    ACTIVE: 'bg-green-500/10 text-green-600 dark:text-green-400',
    INACTIVE: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
    DISCONTINUED: 'bg-muted text-muted-foreground',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status]}`}>{status}</span>
  );
}

interface PackCountBadgeProps {
  count: number;
  variant: 'received' | 'active' | 'depleted' | 'returned';
}

function PackCountBadge({ count, variant }: PackCountBadgeProps) {
  if (count === 0) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }

  const colors: Record<typeof variant, string> = {
    received: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    active: 'bg-green-500/10 text-green-600 dark:text-green-400',
    depleted: 'bg-muted text-muted-foreground',
    returned: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  };

  return (
    <span
      className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 text-xs font-medium rounded ${colors[variant]}`}
    >
      {count}
    </span>
  );
}

/**
 * Pack Status Badge Component
 * Displays pack status with appropriate color coding
 *
 * SEC-004: XSS - React auto-escapes status text
 */
interface PackStatusBadgeProps {
  status: LotteryPackResponse['status'];
}

function PackStatusBadge({ status }: PackStatusBadgeProps) {
  const colors: Record<LotteryPackResponse['status'], string> = {
    RECEIVED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    ACTIVE: 'bg-green-500/10 text-green-600 dark:text-green-400',
    DEPLETED: 'bg-muted text-muted-foreground',
    RETURNED: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status]}`}>{status}</span>
  );
}

// ============================================================================
// Formatters
// ============================================================================

/**
 * Format currency value for display
 * SEC-004: XSS safe - uses React text node
 */
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/**
 * Format date for display
 * SEC-004: XSS safe - uses React text node
 */
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '--';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(dateString));
  } catch {
    return '--';
  }
}
