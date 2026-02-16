/**
 * Pack Search Combobox Component
 * Searchable dropdown for selecting lottery packs with debounced search
 *
 * Story: Pack Activation UX Enhancement
 *
 * Architecture: FULLY CONTROLLED COMPONENT
 * - Parent owns all state (searchQuery passed via prop)
 * - No internal state synchronization with props (prevents infinite loops)
 * - Single source of truth for selection state
 * - Derived state computed during render, not stored
 *
 * Features:
 * - Debounced search (500ms) for game name or pack number
 * - Shows recent received packs on focus before typing
 * - Keyboard navigation (arrow keys, enter, escape)
 * - Loading state during search
 * - Displays game name and pack number
 * - Accessible with proper ARIA attributes
 *
 * MCP Guidance Applied:
 * - FE-002: FORM_VALIDATION - Input length validation before search
 * - SEC-014: INPUT_VALIDATION - Sanitized input (React auto-escapes)
 * - SEC-004: XSS - React auto-escapes output
 * - FE-001: STATE_MANAGEMENT - Fully controlled component pattern
 */

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Check, ChevronsUpDown, Loader2, Package } from 'lucide-react';
import { useLotteryPacks, usePackSearch } from '@/hooks/useLottery';
import type { LotteryPackResponse, LotteryPackStatus, LotteryGameStatus } from '@/lib/api/lottery';
import { checkPackExists } from '@/lib/api/lottery';
import { isValidSerialNumber, parseSerializedNumber } from '@/lib/utils/lottery-serial-parser';

/**
 * Expected barcode length for lottery serial numbers
 */
const EXPECTED_BARCODE_LENGTH = 24;

/**
 * Timeout after last input to validate barcode length (ms)
 * If no more input comes within this window and digits != 24, show error
 */
const SCAN_VALIDATION_TIMEOUT_MS = 400;

/**
 * Pack option for selection
 * SEC-014: INPUT_VALIDATION - Includes game_status for client-side validation
 * FE-002: FORM_VALIDATION - Mirrors backend game status check
 */
export interface PackSearchOption {
  pack_id: string;
  pack_number: string;
  game_id: string;
  game_name: string;
  game_price: number | null;
  serial_start: string;
  serial_end: string;
  /**
   * Game status for client-side validation
   * SEC-014: Used to validate only ACTIVE games can have packs activated
   * Mirrors backend validation in lottery:activatePack handler
   */
  game_status: LotteryGameStatus | null;
  /**
   * BIZ-010: Serial position from scanned barcode
   * When a pack is selected via barcode scan, this contains the serial_start
   * extracted from positions 12-14 of the 24-digit barcode.
   * Used in onboarding mode to set the correct starting ticket position.
   *
   * @example "025" means 25 tickets already sold, start at ticket #25
   */
  scanned_serial?: string;
}

/**
 * Props for PackSearchCombobox
 *
 * This is a FULLY CONTROLLED component:
 * - searchQuery: The current search input value (controlled by parent)
 * - onSearchQueryChange: Called when user types (parent updates searchQuery)
 * - onPackSelect: Called when user selects a pack
 * - onClear: Called when selection should be cleared
 */
export interface PackSearchComboboxProps {
  /** Store UUID for fetching packs */
  storeId: string | null | undefined;
  /** Current search query value (controlled) */
  searchQuery: string;
  /** Callback when search query changes */
  onSearchQueryChange: (query: string) => void;
  /** Callback when a pack is selected */
  onPackSelect: (pack: PackSearchOption) => void;
  /** Callback to clear the current selection */
  onClear?: () => void;
  /** Display label for the input */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Error message to display */
  error?: string;
  /** Filter by pack status - defaults to RECEIVED for activation */
  statusFilter?: 'RECEIVED' | 'ACTIVE' | 'DEPLETED' | 'RETURNED';
  /** Test ID for the input element */
  testId?: string;
}

/**
 * Handle interface for imperative methods exposed via ref
 */
export interface PackSearchComboboxHandle {
  /** Focus the input element */
  focus: () => void;
  /** Clear the search input (calls onSearchQueryChange with empty string) */
  clear: () => void;
}

/**
 * Map API response to PackSearchOption format
 * Memoized at module level to ensure stable reference
 *
 * SEC-014: INPUT_VALIDATION - Maps game_status for client-side validation
 * FE-002: FORM_VALIDATION - Enables mirroring backend game status checks
 */
function mapPackToOption(pack: LotteryPackResponse): PackSearchOption {
  return {
    pack_id: pack.pack_id,
    pack_number: pack.pack_number,
    game_id: pack.game_id,
    game_name: pack.game?.name || 'Unknown Game',
    game_price: pack.game?.price || null,
    serial_start: pack.opening_serial || '',
    serial_end: pack.closing_serial || '',
    // SEC-014: Map game status for client-side validation
    // Null if game data not available (defensive - should always be present)
    game_status: pack.game?.status ?? null,
  };
}

/**
 * Get user-friendly error message based on pack status
 * Explains why the pack cannot be activated
 */
function getPackStatusErrorMessage(
  status: LotteryPackStatus,
  packNumber: string,
  gameName?: string,
  binName?: string | null
): { title: string; description: string } {
  const gameInfo = gameName ? ` (${gameName})` : '';

  switch (status) {
    case 'ACTIVE':
      return {
        title: 'Pack is already active',
        description: binName
          ? `Pack #${packNumber}${gameInfo} is currently active in ${binName}. A pack can only be activated once.`
          : `Pack #${packNumber}${gameInfo} is already activated. A pack can only be activated once.`,
      };
    case 'DEPLETED':
      return {
        title: 'Pack has been sold/depleted',
        description: `Pack #${packNumber}${gameInfo} was previously activated and has been depleted. It cannot be activated again.`,
      };
    case 'RETURNED':
      return {
        title: 'Pack was returned',
        description: `Pack #${packNumber}${gameInfo} was returned to the distributor and cannot be activated.`,
      };
    case 'RECEIVED':
      // This shouldn't happen in this context, but handle it gracefully
      return {
        title: 'Pack not found in search',
        description: `Pack #${packNumber}${gameInfo} exists but was not found. Please try again.`,
      };
    default:
      return {
        title: 'Pack unavailable',
        description: `Pack #${packNumber}${gameInfo} has status "${status}" and cannot be activated.`,
      };
  }
}

/**
 * Get user-friendly error message based on game status
 * SEC-014: INPUT_VALIDATION - Validates game status before allowing pack selection
 * FE-002: FORM_VALIDATION - Mirrors backend game status validation
 *
 * Business Rule: Only packs for ACTIVE games can be activated.
 * Games that are INACTIVE or DISCONTINUED should block pack activation.
 *
 * @param gameStatus - The game's current status
 * @param gameName - Game name for display
 * @param packNumber - Pack number for display
 * @returns Error message object with title and description
 */
function getGameStatusErrorMessage(
  gameStatus: LotteryGameStatus | null,
  gameName: string,
  packNumber: string
): { title: string; description: string } {
  switch (gameStatus) {
    case 'INACTIVE':
      return {
        title: 'Game is inactive',
        description: `Cannot activate Pack #${packNumber}. Game "${gameName}" is currently INACTIVE. Only packs for ACTIVE games can be activated.`,
      };
    case 'DISCONTINUED':
      return {
        title: 'Game has been discontinued',
        description: `Cannot activate Pack #${packNumber}. Game "${gameName}" has been DISCONTINUED and is no longer available.`,
      };
    case null:
      // Defensive: game status not available - block activation for safety
      return {
        title: 'Game status unavailable',
        description: `Cannot verify game status for Pack #${packNumber}. Please try again or contact support.`,
      };
    default:
      // ACTIVE status should not trigger this function
      return {
        title: 'Activation blocked',
        description: `Pack #${packNumber} cannot be activated at this time.`,
      };
  }
}

/**
 * Check if a pack's game is eligible for activation
 * SEC-014: INPUT_VALIDATION - Allowlist validation for game status
 *
 * @param gameStatus - The game's current status
 * @returns true if game is ACTIVE and pack can be activated
 */
function isGameActiveForActivation(gameStatus: LotteryGameStatus | null): boolean {
  // SEC-014: Strict allowlist - only ACTIVE status is allowed
  return gameStatus === 'ACTIVE';
}

/**
 * PackSearchCombobox component
 * Fully controlled searchable dropdown for selecting lottery packs
 *
 * Enterprise Pattern: Fully Controlled Component
 * - All state owned by parent
 * - No useEffect for state synchronization (prevents infinite loops)
 * - Derived state computed during render
 */
export const PackSearchCombobox = forwardRef<PackSearchComboboxHandle, PackSearchComboboxProps>(
  function PackSearchCombobox(
    {
      storeId,
      searchQuery,
      onSearchQueryChange,
      onPackSelect,
      onClear,
      label = 'Pack',
      placeholder = 'Scan barcode or search by game name...',
      disabled = false,
      error,
      statusFilter = 'RECEIVED',
      testId,
    },
    ref
  ) {
    const { toast } = useToast();

    // ============================================================================
    // INTERNAL UI STATE ONLY (not derived from props, no sync needed)
    // ============================================================================
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    // Track if Enter was pressed while search was pending (scanner race condition fix)
    const [pendingEnterSelect, setPendingEnterSelect] = useState(false);

    // Refs
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Debounce search query for API calls
    const debouncedSearch = useDebounce(searchQuery, 500);

    // Timer ref for scan validation (400ms after last input)
    const scanValidationTimerRef = useRef<NodeJS.Timeout | null>(null);

    // ============================================================================
    // IMPERATIVE HANDLE (for parent to control focus/clear)
    // ============================================================================
    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          inputRef.current?.focus();
        },
        clear: () => {
          onSearchQueryChange('');
          // Clear any pending scan validation timer
          if (scanValidationTimerRef.current) {
            clearTimeout(scanValidationTimerRef.current);
            scanValidationTimerRef.current = null;
          }
          onClear?.();
        },
      }),
      [onSearchQueryChange, onClear]
    );

    // ============================================================================
    // DATA FETCHING
    // ============================================================================

    // Determine if we're in search mode (2+ characters typed)
    const isSearchMode = debouncedSearch.trim().length >= 2;

    // CRITICAL: Extract pack number from 24-digit barcode for searching
    // Barcode format: [game_code:4][pack_number:7][serial_start:3][identifier:10]
    // Example: "182501032300005216695473" → pack_number = "0103230"
    // If input is 24 digits, extract positions 5-11 (pack number)
    // Otherwise, use the input as-is (could be game name or partial pack number)
    const effectiveSearchTerm = useMemo(() => {
      const trimmed = debouncedSearch.trim();
      if (isValidSerialNumber(trimmed)) {
        // It's a 24-digit barcode - extract pack number
        const parsed = parseSerializedNumber(trimmed);
        return parsed.pack_number;
      }
      // Not a barcode - use as-is (game name or partial match)
      return trimmed;
    }, [debouncedSearch]);

    // Fetch recent packs - disabled, only show results after user types 2+ characters
    const { data: recentPacksData, isLoading: isLoadingRecent } = useLotteryPacks(
      storeId,
      { status: statusFilter },
      { enabled: false } // Disabled: only show suggestions after 2+ characters typed
    );

    // Fetch packs based on search query (only when searching)
    // Uses effectiveSearchTerm which extracts pack_number from barcodes
    const { data: searchPacksData, isLoading: isLoadingSearch } = usePackSearch(
      storeId,
      isSearchMode ? effectiveSearchTerm : undefined,
      { status: statusFilter },
      { enabled: isSearchMode }
    );

    // ============================================================================
    // DERIVED STATE (computed during render, not stored)
    // ============================================================================

    const isLoading = isSearchMode ? isLoadingSearch : isLoadingRecent;

    // Memoize packs list with stable mapping
    const packs = useMemo(() => {
      const rawPacks = isSearchMode ? searchPacksData : recentPacksData;
      if (!rawPacks) return [];
      return rawPacks.map(mapPackToOption);
    }, [isSearchMode, searchPacksData, recentPacksData]);

    // ============================================================================
    // EFFECTS (UI behavior only, NO state synchronization)
    // ============================================================================

    // Close dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Reset highlighted index when packs change
    useEffect(() => {
      // Use queueMicrotask to avoid synchronous setState during effect
      queueMicrotask(() => {
        setHighlightedIndex(0);
      });
    }, [packs.length]);

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Clear input and refocus for next scan
     */
    const clearAndRefocus = useCallback(() => {
      onSearchQueryChange('');
      if (scanValidationTimerRef.current) {
        clearTimeout(scanValidationTimerRef.current);
        scanValidationTimerRef.current = null;
      }
      setTimeout(() => inputRef.current?.focus(), 100);
    }, [onSearchQueryChange]);

    /**
     * Check pack status and show appropriate error when pack not found in RECEIVED status
     * This provides clear feedback when a user scans a pack that exists but cannot be activated
     * (already active, depleted, or returned)
     *
     * @param packNumber - The pack number extracted from barcode
     */
    const checkPackStatusAndShowError = useCallback(
      async (packNumber: string) => {
        if (!storeId) {
          toast({
            title: 'Pack not found. Please scan again.',
            variant: 'destructive',
          });
          clearAndRefocus();
          return;
        }

        try {
          const response = await checkPackExists(storeId, packNumber);

          if (response.success && response.data?.exists && response.data.pack) {
            const pack = response.data.pack;
            // Pack exists but not in RECEIVED status - show status-specific message
            const errorMsg = getPackStatusErrorMessage(
              pack.status,
              pack.pack_number,
              pack.game?.name,
              pack.bin?.name
            );
            toast({
              title: errorMsg.title,
              description: errorMsg.description,
              variant: 'destructive',
            });
          } else {
            // Pack truly doesn't exist in inventory
            toast({
              title: 'Pack not found',
              description:
                'This pack has not been received into inventory. Please receive the pack first before activating.',
              variant: 'destructive',
            });
          }
        } catch {
          // Fallback to generic message on API error
          toast({
            title: 'Pack not found. Please scan again.',
            variant: 'destructive',
          });
        }

        clearAndRefocus();
      },
      [storeId, toast, clearAndRefocus]
    );

    /**
     * Handle input change with simple 400ms validation
     *
     * Logic:
     * - On every input change, reset the 400ms timer
     * - If input is all digits and timer fires:
     *   - If digits != 24: show error, clear, refocus
     *   - If digits == 24: valid scan (process normally)
     * - Text search (non-numeric) skips validation
     */
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const query = e.target.value;
        const isAllDigits = /^\d+$/.test(query);

        // Clear any pending validation timer
        if (scanValidationTimerRef.current) {
          clearTimeout(scanValidationTimerRef.current);
          scanValidationTimerRef.current = null;
        }

        // For numeric input, start 400ms validation timer
        if (isAllDigits && query.length > 0) {
          // Too long - reject immediately
          if (query.length > EXPECTED_BARCODE_LENGTH) {
            toast({
              title: 'Invalid input. Please scan again.',
              variant: 'destructive',
            });
            clearAndRefocus();
            return;
          }

          // Start 400ms timer - if no more input comes and length != 24, show error
          const capturedLength = query.length;
          scanValidationTimerRef.current = setTimeout(() => {
            if (capturedLength !== EXPECTED_BARCODE_LENGTH) {
              toast({
                title: 'Invalid input. Please scan again.',
                variant: 'destructive',
              });
              clearAndRefocus();
            }
          }, SCAN_VALIDATION_TIMEOUT_MS);
        }

        onSearchQueryChange(query);
        setIsOpen(true);
      },
      [onSearchQueryChange, toast, clearAndRefocus]
    );

    // Cleanup timer on unmount
    useEffect(() => {
      return () => {
        if (scanValidationTimerRef.current) {
          clearTimeout(scanValidationTimerRef.current);
        }
      };
    }, []);

    const handleSelectPack = useCallback(
      (pack: PackSearchOption) => {
        // ========================================================================
        // SEC-014: INPUT_VALIDATION - Validate game status before selection
        // FE-002: FORM_VALIDATION - Mirror backend game status validation
        // Business Rule: Only ACTIVE games can have packs activated
        // ========================================================================
        if (!isGameActiveForActivation(pack.game_status)) {
          const errorMsg = getGameStatusErrorMessage(
            pack.game_status,
            pack.game_name,
            pack.pack_number
          );
          toast({
            title: errorMsg.title,
            description: errorMsg.description,
            variant: 'destructive',
          });
          // Clear and refocus for next scan
          clearAndRefocus();
          return;
        }

        // ========================================================================
        // BIZ-010: Extract scanned_serial from barcode for onboarding mode
        // When pack is selected via 24-digit barcode scan, extract the serial_start
        // from positions 12-14 and include it in the pack option.
        // SEC-014: Validated by isValidSerialNumber (strict 24-digit regex)
        // ========================================================================
        let packWithScannedSerial = pack;
        const trimmedQuery = searchQuery.trim();
        if (isValidSerialNumber(trimmedQuery)) {
          const parsed = parseSerializedNumber(trimmedQuery);
          // SEC-014: serial_start is validated as exactly 3 digits by parseSerializedNumber
          packWithScannedSerial = {
            ...pack,
            scanned_serial: parsed.serial_start,
          };
        }

        // Notify parent of selection (only for ACTIVE games)
        onPackSelect(packWithScannedSerial);
        // Clear search query
        onSearchQueryChange('');
        // Clear any pending validation timer
        if (scanValidationTimerRef.current) {
          clearTimeout(scanValidationTimerRef.current);
          scanValidationTimerRef.current = null;
        }
        // Close dropdown
        setIsOpen(false);
      },
      [onPackSelect, onSearchQueryChange, toast, clearAndRefocus, searchQuery]
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          setIsOpen(true);
          return;
        }

        if (!isOpen) return;

        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault();
            setHighlightedIndex((prev) => (prev < packs.length - 1 ? prev + 1 : prev));
            break;
          case 'ArrowUp':
            e.preventDefault();
            setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
            break;
          case 'Enter':
            e.preventDefault();
            // Handle scanner race condition - Enter arrives before debounce completes
            if (searchQuery.trim() !== debouncedSearch.trim()) {
              setPendingEnterSelect(true);
              return;
            }
            // eslint-disable-next-line security/detect-object-injection -- highlightedIndex is a controlled number index
            if (packs[highlightedIndex]) {
              // eslint-disable-next-line security/detect-object-injection -- highlightedIndex is a controlled number index
              handleSelectPack(packs[highlightedIndex]);
            }
            break;
          case 'Escape':
            e.preventDefault();
            setIsOpen(false);
            break;
        }
      },
      [isOpen, packs, highlightedIndex, handleSelectPack, searchQuery, debouncedSearch]
    );

    const handleInputFocus = useCallback(() => {
      setIsOpen(true);
    }, []);

    // ============================================================================
    // SCANNER RACE CONDITION FIX - Effects after handlers
    // ============================================================================

    // CRITICAL FIX: Auto-select first result when search completes after pending Enter
    // This handles the scanner race condition where Enter arrives before debounce completes.
    // When pendingEnterSelect is true and FILTERED search results arrive, auto-select first match.
    //
    // IMPORTANT: Must check isSearchMode to ensure we're selecting from FILTERED results,
    // not the unfiltered list of all packs. The sequence is:
    // 1. Scanner types barcode → searchQuery updates character by character
    // 2. Scanner sends Enter → pendingEnterSelect = true
    // 3. 500ms later → debouncedSearch updates → isSearchMode = true → API call starts
    // 4. API returns → isLoading = false → NOW we can safely select
    //
    // MCP FE-001: STATE_MANAGEMENT - Handle async state transitions correctly
    useEffect(() => {
      // Only auto-select when:
      // 1. pendingEnterSelect is true (Enter was pressed)
      // 2. isSearchMode is true (debounce completed, we have filtered results)
      // 3. isLoading is false (API call completed)
      // 4. packs.length > 0 (we have results to select from)
      if (pendingEnterSelect && isSearchMode && !isLoading && packs.length > 0) {
        // Use queueMicrotask to avoid synchronous setState during effect
        queueMicrotask(() => {
          // Search completed with FILTERED results - auto-select first pack
          handleSelectPack(packs[0]);
          setPendingEnterSelect(false);
        });
      } else if (pendingEnterSelect && isSearchMode && !isLoading && packs.length === 0) {
        // Search completed but no results - check if pack exists with different status
        // This provides clear feedback for already-activated, depleted, or returned packs
        queueMicrotask(() => {
          setPendingEnterSelect(false);
          // Extract pack number from the search query (could be barcode or direct pack number)
          const trimmedQuery = searchQuery.trim();
          let packNumber = trimmedQuery;
          if (isValidSerialNumber(trimmedQuery)) {
            const parsed = parseSerializedNumber(trimmedQuery);
            packNumber = parsed.pack_number;
          }
          // Check pack status and show appropriate error message
          checkPackStatusAndShowError(packNumber);
        });
      }
      // Note: If pendingEnterSelect && !isSearchMode, we wait for debounce to complete
    }, [
      pendingEnterSelect,
      isSearchMode,
      isLoading,
      packs,
      handleSelectPack,
      searchQuery,
      checkPackStatusAndShowError,
    ]);

    // ============================================================================
    // BARCODE AUTO-SELECT: Auto-select when valid barcode scan finds exact match
    // ============================================================================
    // When a 24-digit barcode is scanned (without Enter key), auto-select if:
    // 1. The debounced search matches the barcode (debounce completed)
    // 2. Search is not loading (API call completed)
    // 3. Exactly one pack matches OR the first pack's pack_number matches the barcode
    //
    // This handles scanners that don't send Enter key after barcode.
    useEffect(() => {
      // Only trigger for valid 24-digit barcodes
      const trimmedQuery = searchQuery.trim();
      if (!isValidSerialNumber(trimmedQuery)) {
        return;
      }

      // Wait for debounce to complete
      if (debouncedSearch.trim() !== trimmedQuery) {
        return;
      }

      // Wait for API call to complete
      if (isLoading || !isSearchMode) {
        return;
      }

      // Extract pack number from barcode for matching
      const parsed = parseSerializedNumber(trimmedQuery);
      const barcodePackNumber = parsed.pack_number;

      // Auto-select if exactly one result, or first result matches barcode pack number
      if (packs.length === 1) {
        // Exactly one match - auto-select it
        queueMicrotask(() => {
          handleSelectPack(packs[0]);
        });
      } else if (packs.length > 1) {
        // Multiple results - check if first one matches the barcode pack number
        const firstPack = packs[0];
        if (firstPack.pack_number === barcodePackNumber) {
          queueMicrotask(() => {
            handleSelectPack(firstPack);
          });
        }
        // If no exact match, leave dropdown open for manual selection
      } else {
        // No results for valid barcode - check if pack exists with different status
        // This provides clear feedback for already-activated, depleted, or returned packs
        queueMicrotask(() => {
          checkPackStatusAndShowError(barcodePackNumber);
        });
      }
    }, [
      searchQuery,
      debouncedSearch,
      isLoading,
      isSearchMode,
      packs,
      handleSelectPack,
      checkPackStatusAndShowError,
    ]);

    return (
      <div ref={dropdownRef} className="relative space-y-2">
        {label && <Label htmlFor="pack-search">{label}</Label>}

        <div className="relative">
          <Input
            ref={inputRef}
            id="pack-search"
            type="text"
            value={searchQuery}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
            placeholder={placeholder}
            disabled={disabled}
            className={cn('pr-10', error && 'border-red-500 focus-visible:ring-red-500')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls="pack-listbox"
            aria-autocomplete="list"
            aria-activedescendant={
              // eslint-disable-next-line security/detect-object-injection -- highlightedIndex is a controlled number index
              isOpen && packs[highlightedIndex] ? `pack-option-${highlightedIndex}` : undefined
            }
            data-testid={testId}
          />

          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {isOpen && isSearchMode && (
          <div
            id="pack-listbox"
            role="listbox"
            className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md"
            data-testid={testId ? `${testId}-dropdown` : undefined}
          >
            {isLoading ? (
              <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isSearchMode ? 'Searching packs...' : 'Loading packs...'}
              </div>
            ) : packs.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {isSearchMode
                  ? `No ${statusFilter.toLowerCase()} packs found matching "${debouncedSearch}"`
                  : `No ${statusFilter.toLowerCase()} packs available`}
              </div>
            ) : (
              <>
                {/* Show header for recent packs when not searching */}
                {!isSearchMode && (
                  <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                    <Package className="h-3 w-3" />
                    Recent {statusFilter.toLowerCase()} packs
                  </div>
                )}
                <ul className="py-1">
                  {packs.map((pack, index) => {
                    const isHighlighted = highlightedIndex === index;

                    return (
                      <li
                        key={pack.pack_id}
                        id={`pack-option-${index}`}
                        role="option"
                        aria-selected={isHighlighted}
                        onClick={() => handleSelectPack(pack)}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        className={cn(
                          'relative flex cursor-pointer select-none items-center px-3 py-2 text-sm outline-none transition-colors',
                          isHighlighted && 'bg-accent'
                        )}
                        data-testid={testId ? `${testId}-option-${index}` : undefined}
                      >
                        <div className="flex flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{pack.game_name}</span>
                            {pack.game_price !== null && (
                              <span className="text-xs text-muted-foreground">
                                ${pack.game_price}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Pack #{pack.pack_number} • Serials {pack.serial_start}-{pack.serial_end}
                          </span>
                        </div>
                        {isHighlighted && <Check className="h-4 w-4" />}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Search by game name or pack number (min 2 characters)
        </p>
      </div>
    );
  }
);
