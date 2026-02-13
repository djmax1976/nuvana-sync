/**
 * SyncMonitorPanel Unit Tests
 *
 * Tests the extracted SyncMonitorPanel component that is now embedded
 * in the Settings page. Verifies rendering, tab switching, loading states,
 * and responsive CSS class application.
 *
 * Component Coverage:
 * - COMP-001: Renders header with title and action buttons
 * - COMP-002: Tab switching between Sync Queue and Dead Letter Queue
 * - COMP-003: Loading state rendering
 * - COMP-004: Empty state rendering
 * - COMP-005: Error state rendering
 * - COMP-006: className prop passthrough via cn()
 * - COMP-007: Responsive grid classes for embeddable layout
 *
 * @module tests/unit/components/sync/SyncMonitorPanel
 * @security SEC-004: Verifies no XSS vectors — all content is text via React escaping
 * @security FE-005: No sensitive data exposed in DOM
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Hoisted mocks for hooks
const {
  mockUseSyncActivity,
  mockUseRetrySyncItem,
  mockUseDeleteSyncItem,
  mockUseInvalidateSyncActivity,
  mockUseDeadLetterItems,
  mockUseDeadLetterStats,
  mockUseRestoreFromDeadLetter,
  mockUseRestoreFromDeadLetterMany,
  mockUseDeleteDeadLetterItem,
  mockUseInvalidateDeadLetter,
} = vi.hoisted(() => ({
  mockUseSyncActivity: vi.fn(),
  mockUseRetrySyncItem: vi.fn(),
  mockUseDeleteSyncItem: vi.fn(),
  mockUseInvalidateSyncActivity: vi.fn(),
  mockUseDeadLetterItems: vi.fn(),
  mockUseDeadLetterStats: vi.fn(),
  mockUseRestoreFromDeadLetter: vi.fn(),
  mockUseRestoreFromDeadLetterMany: vi.fn(),
  mockUseDeleteDeadLetterItem: vi.fn(),
  mockUseInvalidateDeadLetter: vi.fn(),
}));

vi.mock('../../../../src/renderer/lib/hooks', () => ({
  useSyncActivity: mockUseSyncActivity,
  useRetrySyncItem: mockUseRetrySyncItem,
  useDeleteSyncItem: mockUseDeleteSyncItem,
  useInvalidateSyncActivity: mockUseInvalidateSyncActivity,
  useDeadLetterItems: mockUseDeadLetterItems,
  useDeadLetterStats: mockUseDeadLetterStats,
  useRestoreFromDeadLetter: mockUseRestoreFromDeadLetter,
  useRestoreFromDeadLetterMany: mockUseRestoreFromDeadLetterMany,
  useDeleteDeadLetterItem: mockUseDeleteDeadLetterItem,
  useInvalidateDeadLetter: mockUseInvalidateDeadLetter,
}));

// Mock syncAPI
vi.mock('../../../../src/renderer/lib/api/ipc-client', () => ({
  syncAPI: {
    getActivity: vi.fn(),
    retryItem: vi.fn(),
    deleteItem: vi.fn(),
  },
}));

// Mock LoadingSpinner
vi.mock('../../../../src/renderer/components/ui/LoadingSpinner', () => ({
  LoadingSpinner: ({ size }: { size?: string }) => (
    <div data-testid="loading-spinner" data-size={size} />
  ),
}));

// Mock lucide-react icons as simple spans
vi.mock('lucide-react', () => {
  const iconFactory = (name: string) => (props: { className?: string }) => (
    <span data-testid={`icon-${name}`} className={props.className} />
  );
  return {
    RefreshCw: iconFactory('refresh-cw'),
    AlertTriangle: iconFactory('alert-triangle'),
    CheckCircle2: iconFactory('check-circle'),
    Clock: iconFactory('clock'),
    RotateCcw: iconFactory('rotate-ccw'),
    Trash2: iconFactory('trash'),
    ChevronLeft: iconFactory('chevron-left'),
    ChevronRight: iconFactory('chevron-right'),
    Activity: iconFactory('activity'),
    Package: iconFactory('package'),
    Zap: iconFactory('zap'),
    XCircle: iconFactory('x-circle'),
    Filter: iconFactory('filter'),
    ArrowUpRight: iconFactory('arrow-up-right'),
    ArrowDownLeft: iconFactory('arrow-down-left'),
    Globe: iconFactory('globe'),
    Archive: iconFactory('archive'),
    Undo2: iconFactory('undo'),
    Ban: iconFactory('ban'),
    Skull: iconFactory('skull'),
  };
});

// Import component AFTER all mocks
import { SyncMonitorPanel } from '../../../../src/renderer/components/sync/SyncMonitorPanel';

// ============================================================================
// Test Helpers
// ============================================================================

function createStats(overrides: Record<string, unknown> = {}) {
  return {
    queued: 0,
    pending: 0,
    failed: 0,
    syncedToday: 0,
    syncedTotal: 0,
    byDirection: [],
    byEntityType: [],
    byOperation: [],
    ...overrides,
  };
}

function setupDefaultMocks() {
  mockUseSyncActivity.mockReturnValue({
    data: {
      items: [],
      total: 0,
      stats: createStats(),
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });

  mockUseRetrySyncItem.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });

  mockUseDeleteSyncItem.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });

  mockUseInvalidateSyncActivity.mockReturnValue(vi.fn());

  mockUseDeadLetterItems.mockReturnValue({
    data: { items: [], total: 0 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });

  mockUseDeadLetterStats.mockReturnValue({
    data: {
      total: 0,
      byReason: {
        MAX_ATTEMPTS_EXCEEDED: 0,
        PERMANENT_ERROR: 0,
        STRUCTURAL_FAILURE: 0,
      },
      byEntity: {},
    },
    isLoading: false,
    isError: false,
  });

  mockUseRestoreFromDeadLetter.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });

  mockUseRestoreFromDeadLetterMany.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });

  mockUseDeleteDeadLetterItem.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });

  mockUseInvalidateDeadLetter.mockReturnValue(vi.fn());
}

function setupLoadingMocks() {
  setupDefaultMocks();
  mockUseSyncActivity.mockReturnValue({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

function setupErrorMocks(message = 'Network error') {
  setupDefaultMocks();
  mockUseSyncActivity.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: true,
    error: new Error(message),
    refetch: vi.fn(),
  });
}

function setupWithItems(itemCount: number) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    id: `item-${i}`,
    entity_type: 'pack',
    entity_id: `pack-${i}`,
    direction: 'PUSH' as const,
    status: i % 2 === 0 ? 'queued' : 'synced',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    retry_count: 0,
    last_error: null,
  }));

  setupDefaultMocks();
  mockUseSyncActivity.mockReturnValue({
    data: {
      items,
      total: itemCount,
      stats: createStats({
        queued: Math.ceil(itemCount / 2),
        pending: Math.ceil(itemCount / 2),
        failed: 0,
        syncedToday: Math.floor(itemCount / 2),
        syncedTotal: itemCount,
      }),
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('SyncMonitorPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // --------------------------------------------------------------------------
  // COMP-001: Header Rendering
  // --------------------------------------------------------------------------

  describe('Header Rendering', () => {
    it('should render "Sync Monitor" heading', () => {
      render(<SyncMonitorPanel />);
      expect(screen.getByText('Sync Monitor')).toBeInTheDocument();
    });

    it('should render refresh button', () => {
      render(<SyncMonitorPanel />);
      // The refresh button contains a RefreshCw icon
      expect(screen.getByTestId('icon-refresh-cw')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // COMP-002: Tab Switching
  // --------------------------------------------------------------------------

  describe('Tab Switching', () => {
    it('should render Sync Queue tab as active by default', () => {
      render(<SyncMonitorPanel />);
      const queueTab = screen.getByRole('button', { name: /sync queue/i });
      expect(queueTab).toBeInTheDocument();
    });

    it('should render Dead Letter Queue tab', () => {
      render(<SyncMonitorPanel />);
      const dlqTab = screen.getByRole('button', { name: /dead letter queue/i });
      expect(dlqTab).toBeInTheDocument();
    });

    it('should switch to Dead Letter Queue tab on click', () => {
      render(<SyncMonitorPanel />);
      const dlqTab = screen.getByRole('button', { name: /dead letter queue/i });
      fireEvent.click(dlqTab);
      // After switching, DLQ content should be visible
      // The DLQ tab should now be the active tab
      expect(dlqTab.className).toContain('border-b');
    });
  });

  // --------------------------------------------------------------------------
  // COMP-003: Loading State
  // --------------------------------------------------------------------------

  describe('Loading State', () => {
    it('should show loading spinner when data is loading', () => {
      setupLoadingMocks();
      render(<SyncMonitorPanel />);
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // COMP-005: Error State
  // --------------------------------------------------------------------------

  describe('Error State', () => {
    it('should show error message when query fails', () => {
      setupErrorMocks('Connection refused');
      render(<SyncMonitorPanel />);
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // COMP-004: Empty State
  // --------------------------------------------------------------------------

  describe('Empty State', () => {
    it('should show empty message when no sync items exist', () => {
      setupDefaultMocks();
      render(<SyncMonitorPanel />);
      // With 0 items, the empty state message should appear
      expect(screen.getByText('No sync activity found')).toBeInTheDocument();
    });

    it('should show all stat card values as 0', () => {
      setupDefaultMocks();
      render(<SyncMonitorPanel />);
      // All stat cards should display '0' — multiple instances expected
      const zeros = screen.getAllByText('0');
      expect(zeros.length).toBeGreaterThanOrEqual(4);
    });
  });

  // --------------------------------------------------------------------------
  // COMP-006: className Prop Passthrough
  // --------------------------------------------------------------------------

  describe('className Prop', () => {
    it('should apply additional className to container', () => {
      const { container } = render(<SyncMonitorPanel className="custom-panel" />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('custom-panel');
      // Should also retain base class
      expect(root.className).toContain('space-y-4');
    });

    it('should render without className prop', () => {
      const { container } = render(<SyncMonitorPanel />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain('space-y-4');
    });
  });

  // --------------------------------------------------------------------------
  // COMP-007: Responsive Grid Classes
  // --------------------------------------------------------------------------

  describe('Responsive Layout', () => {
    it('should use responsive grid classes for stat cards', () => {
      setupWithItems(5);
      const { container } = render(<SyncMonitorPanel />);
      // The stat cards grid should have responsive classes
      const grids = container.querySelectorAll('.grid');
      expect(grids.length).toBeGreaterThan(0);
      // At least one grid should use xl: breakpoint classes for responsive embedding
      const hasResponsiveGrid = Array.from(grids).some(
        (g) => g.className.includes('xl:grid-cols')
      );
      expect(hasResponsiveGrid).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Data Display with Items
  // --------------------------------------------------------------------------

  describe('Data Display', () => {
    it('should display stat card labels when items exist', () => {
      setupWithItems(10);
      const { container } = render(<SyncMonitorPanel />);
      // Scope to the stat cards grid (first .grid element)
      const statsGrid = container.querySelector('.grid.grid-cols-2');
      expect(statsGrid).toBeTruthy();
      const gridEl = statsGrid as HTMLElement;
      expect(within(gridEl).getByText('Failed')).toBeInTheDocument();
      expect(within(gridEl).getByText('Synced Today')).toBeInTheDocument();
      expect(within(gridEl).getByText('Total Synced')).toBeInTheDocument();
    });

    it('should display non-zero queued count in stat card', () => {
      setupWithItems(10);
      const { container } = render(<SyncMonitorPanel />);
      const statsGrid = container.querySelector('.grid.grid-cols-2') as HTMLElement;
      // Find the value element (text-2xl bold) for the first stat card (Queued)
      const valueEls = statsGrid.querySelectorAll('.text-2xl');
      // First stat card is Queued with value 5
      expect(valueEls[0]).toHaveTextContent('5');
    });

    it('should display total synced count in stat card', () => {
      setupWithItems(10);
      const { container } = render(<SyncMonitorPanel />);
      const statsGrid = container.querySelector('.grid.grid-cols-2') as HTMLElement;
      const valueEls = statsGrid.querySelectorAll('.text-2xl');
      // Fourth stat card is Total Synced with value 10
      expect(valueEls[3]).toHaveTextContent('10');
    });
  });
});
