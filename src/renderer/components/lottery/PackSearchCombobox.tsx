
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
} from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Loader2, Package } from "lucide-react";
import { useLotteryPacks, usePackSearch } from "@/hooks/useLottery";
import type { LotteryPackResponse } from "@/lib/api/lottery";
import {
  isValidSerialNumber,
  parseSerializedNumber,
} from "@/lib/utils/lottery-serial-parser";

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
 */
export interface PackSearchOption {
  pack_id: string;
  pack_number: string;
  game_id: string;
  game_name: string;
  game_price: number | null;
  serial_start: string;
  serial_end: string;
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
  statusFilter?: "RECEIVED" | "ACTIVATED" | "SETTLED" | "RETURNED";
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
 */
function mapPackToOption(pack: LotteryPackResponse): PackSearchOption {
  return {
    pack_id: pack.pack_id,
    pack_number: pack.pack_number,
    game_id: pack.game_id,
    game_name: pack.game?.name || "Unknown Game",
    game_price: pack.game?.price || null,
    serial_start: pack.opening_serial || "",
    serial_end: pack.closing_serial || "",
  };
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
export const PackSearchCombobox = forwardRef<
  PackSearchComboboxHandle,
  PackSearchComboboxProps
>(function PackSearchCombobox(
  {
    storeId,
    searchQuery,
    onSearchQueryChange,
    onPackSelect,
    onClear,
    label = "Pack",
    placeholder = "Scan barcode or search by game name...",
    disabled = false,
    error,
    statusFilter = "RECEIVED",
    testId,
  },
  ref,
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
        onSearchQueryChange("");
        // Clear any pending scan validation timer
        if (scanValidationTimerRef.current) {
          clearTimeout(scanValidationTimerRef.current);
          scanValidationTimerRef.current = null;
        }
        onClear?.();
      },
    }),
    [onSearchQueryChange, onClear],
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
    { enabled: false }, // Disabled: only show suggestions after 2+ characters typed
  );

  // Fetch packs based on search query (only when searching)
  // Uses effectiveSearchTerm which extracts pack_number from barcodes
  const { data: searchPacksData, isLoading: isLoadingSearch } = usePackSearch(
    storeId,
    isSearchMode ? effectiveSearchTerm : undefined,
    { status: statusFilter },
    { enabled: isSearchMode },
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
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset highlighted index when packs change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [packs.length]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  /**
   * Clear input and refocus for next scan
   */
  const clearAndRefocus = useCallback(() => {
    onSearchQueryChange("");
    if (scanValidationTimerRef.current) {
      clearTimeout(scanValidationTimerRef.current);
      scanValidationTimerRef.current = null;
    }
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [onSearchQueryChange]);

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
            title: "Invalid input. Please scan again.",
            variant: "destructive",
          });
          clearAndRefocus();
          return;
        }

        // Start 400ms timer - if no more input comes and length != 24, show error
        const capturedLength = query.length;
        scanValidationTimerRef.current = setTimeout(() => {
          if (capturedLength !== EXPECTED_BARCODE_LENGTH) {
            toast({
              title: "Invalid input. Please scan again.",
              variant: "destructive",
            });
            clearAndRefocus();
          }
        }, SCAN_VALIDATION_TIMEOUT_MS);
      }

      onSearchQueryChange(query);
      setIsOpen(true);
    },
    [onSearchQueryChange, toast, clearAndRefocus],
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
      // Notify parent of selection
      onPackSelect(pack);
      // Clear search query
      onSearchQueryChange("");
      // Clear any pending validation timer
      if (scanValidationTimerRef.current) {
        clearTimeout(scanValidationTimerRef.current);
        scanValidationTimerRef.current = null;
      }
      // Close dropdown
      setIsOpen(false);
    },
    [onPackSelect, onSearchQueryChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        setIsOpen(true);
        return;
      }

      if (!isOpen) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev < packs.length - 1 ? prev + 1 : prev,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        case "Enter":
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
        case "Escape":
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [
      isOpen,
      packs,
      highlightedIndex,
      handleSelectPack,
      searchQuery,
      debouncedSearch,
    ],
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
      // Search completed with FILTERED results - auto-select first pack
      handleSelectPack(packs[0]);
      setPendingEnterSelect(false);
    } else if (
      pendingEnterSelect &&
      isSearchMode &&
      !isLoading &&
      packs.length === 0
    ) {
      // Search completed but no results - clear pending state
      setPendingEnterSelect(false);
    }
    // Note: If pendingEnterSelect && !isSearchMode, we wait for debounce to complete
  }, [pendingEnterSelect, isSearchMode, isLoading, packs, handleSelectPack]);

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
          className={cn(
            "pr-10",
            error && "border-red-500 focus-visible:ring-red-500",
          )}
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
            isOpen && packs[highlightedIndex]
              ? `pack-option-${highlightedIndex}`
              : undefined
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
              {isSearchMode ? "Searching packs..." : "Loading packs..."}
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
                        "relative flex cursor-pointer select-none items-center px-3 py-2 text-sm outline-none transition-colors",
                        isHighlighted && "bg-accent",
                      )}
                      data-testid={
                        testId ? `${testId}-option-${index}` : undefined
                      }
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
                          Pack #{pack.pack_number} • Serials {pack.serial_start}
                          -{pack.serial_end}
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
});
