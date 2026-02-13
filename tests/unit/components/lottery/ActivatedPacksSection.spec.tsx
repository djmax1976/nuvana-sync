/**
 * ActivatedPacksSection Unit Tests
 *
 * Tests the ActivatedPacksSection component for correct rendering of:
 * - Section header with title, count, and status subtitle
 * - Collapsible expand/collapse behavior
 * - Pack rows with BinBadge, game data, status badges
 * - Dimmed rows for non-ACTIVE packs
 * - Date/time parsing and display
 * - Edge cases: empty data, invalid dates, missing fields
 *
 * Traceability:
 * - SEC-004: XSS prevention — all output via JSX auto-escaping
 * - SEC-014: Type-safe props with defensive null checks
 * - API-008: Only whitelisted fields displayed
 * - ARCH-004: Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/ActivatedPacksSection
 */

// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ============================================================================
// Mock Dependencies
// ============================================================================

vi.mock('lucide-react', () => ({
  Zap: (props: Record<string, unknown>) => <div data-testid="zap-icon" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => (
    <div data-testid="chevron-icon" {...props} />
  ),
}));

vi.mock('../../../../src/renderer/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatCustom: (date: Date | string, fmt: string) => {
      const d = typeof date === 'string' ? new Date(date) : date;
      if (Number.isNaN(d.getTime())) return '--';
      if (fmt === 'MMM') return d.toLocaleString('en-US', { month: 'short' });
      if (fmt === 'd') return String(d.getDate());
      if (fmt === 'yyyy') return String(d.getFullYear());
      if (fmt === 'h:mm a')
        return d.toLocaleString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
      return d.toISOString();
    },
    timezone: 'America/Denver',
  }),
}));

// ============================================================================
// Import Component Under Test
// ============================================================================

import { ActivatedPacksSection } from '../../../../src/renderer/components/lottery/ActivatedPacksSection';
import type {
  ActivatedPackDay,
  OpenBusinessPeriod,
} from '../../../../src/renderer/lib/api/lottery';

// ============================================================================
// Test Fixtures
// ============================================================================

function createPack(overrides: Partial<ActivatedPackDay> = {}): ActivatedPackDay {
  return {
    pack_id: 'pack-001',
    pack_number: 'PKG-001',
    game_name: 'Powerball',
    game_price: 30,
    bin_number: 1,
    activated_at: '2026-02-02T10:00:00Z',
    status: 'ACTIVE',
    ...overrides,
  };
}

function createOpenPeriod(
  overrides: Partial<OpenBusinessPeriod> = {}
): OpenBusinessPeriod {
  return {
    started_at: '2026-02-02T08:00:00Z',
    last_closed_date: '2026-02-01',
    days_since_last_close: 1,
    is_first_period: false,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ActivatedPacksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Null/Empty Guard (SEC-014)
  // --------------------------------------------------------------------------
  describe('Empty State Guard', () => {
    it('should return null when activatedPacks is empty array', () => {
      const { container } = render(
        <ActivatedPacksSection activatedPacks={[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should return null when activatedPacks is null', () => {
      const { container } = render(
        <ActivatedPacksSection activatedPacks={null as unknown as ActivatedPackDay[]} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should return null when activatedPacks is undefined', () => {
      const { container } = render(
        <ActivatedPacksSection activatedPacks={undefined as unknown as ActivatedPackDay[]} />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Section Header
  // --------------------------------------------------------------------------
  describe('Section Header', () => {
    it('should render section with correct testid', () => {
      render(<ActivatedPacksSection activatedPacks={[createPack()]} />);
      expect(screen.getByTestId('activated-packs-section')).toBeInTheDocument();
    });

    it('should display title with pack count', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack(), createPack({ pack_id: 'pack-002' })]}
        />
      );
      expect(screen.getByText('Activated Packs (2)')).toBeInTheDocument();
    });

    it('should render blue SectionIcon with Zap icon', () => {
      render(<ActivatedPacksSection activatedPacks={[createPack()]} />);
      expect(screen.getByTestId('zap-icon')).toBeInTheDocument();
    });

    it('should show status subtitle when mixed statuses exist', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[
            createPack({ pack_id: 'p1', status: 'ACTIVE' }),
            createPack({ pack_id: 'p2', status: 'ACTIVE' }),
            createPack({ pack_id: 'p3', status: 'DEPLETED' }),
            createPack({ pack_id: 'p4', status: 'RETURNED' }),
          ]}
        />
      );
      expect(screen.getByText('2 active, 1 sold out, 1 returned')).toBeInTheDocument();
    });

    it('should not show subtitle when only one status type exists', () => {
      const { container } = render(
        <ActivatedPacksSection
          activatedPacks={[
            createPack({ pack_id: 'p1', status: 'ACTIVE' }),
            createPack({ pack_id: 'p2', status: 'ACTIVE' }),
          ]}
        />
      );
      const subtitle = container.querySelector('.text-xs.font-normal.text-muted-foreground');
      expect(subtitle).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Section Title Variants
  // --------------------------------------------------------------------------
  describe('Section Title Variants', () => {
    it('should show "Activated Packs" for normal period', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ days_since_last_close: 1 })}
        />
      );
      expect(screen.getByText('Activated Packs (1)')).toBeInTheDocument();
    });

    it('should show "Activated Packs - Current Period" when multiple days since close', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ days_since_last_close: 3 })}
        />
      );
      expect(
        screen.getByText('Activated Packs - Current Period (1)')
      ).toBeInTheDocument();
    });

    it('should show "Activated Packs" for first period', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack()]}
          openBusinessPeriod={createOpenPeriod({ is_first_period: true })}
        />
      );
      expect(screen.getByText('Activated Packs (1)')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Collapse / Expand
  // --------------------------------------------------------------------------
  describe('Collapse / Expand', () => {
    it('should be collapsed by default', () => {
      render(<ActivatedPacksSection activatedPacks={[createPack()]} />);
      expect(screen.queryByTestId('activated-packs-content')).not.toBeInTheDocument();
    });

    it('should expand when header is clicked', () => {
      render(<ActivatedPacksSection activatedPacks={[createPack()]} />);
      const button = screen.getByRole('button');
      fireEvent.click(button);
      expect(screen.getByTestId('activated-packs-content')).toBeInTheDocument();
    });

    it('should collapse when header is clicked twice', () => {
      render(<ActivatedPacksSection activatedPacks={[createPack()]} />);
      const button = screen.getByRole('button');
      fireEvent.click(button);
      fireEvent.click(button);
      expect(screen.queryByTestId('activated-packs-content')).not.toBeInTheDocument();
    });

    it('should start expanded when defaultOpen=true', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      expect(screen.getByTestId('activated-packs-content')).toBeInTheDocument();
    });

    it('should have correct aria-expanded toggle', () => {
      render(<ActivatedPacksSection activatedPacks={[createPack()]} />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });
  });

  // --------------------------------------------------------------------------
  // Pack Row Data Display
  // --------------------------------------------------------------------------
  describe('Pack Row Data', () => {
    it('should render BinBadge with bin number', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      // BinBadge renders the number as text
      const section = screen.getByTestId('activated-packs-content');
      const binBadge = section.querySelector('span[class*="bg-blue-100"]');
      expect(binBadge).not.toBeNull();
      expect(binBadge!.textContent).toBe('1');
    });

    it('should display game name', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      expect(screen.getByText('Powerball')).toBeInTheDocument();
    });

    it('should display game price as currency', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      expect(screen.getByText('$30.00')).toBeInTheDocument();
    });

    it('should display pack number', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      expect(screen.getByText('PKG-001')).toBeInTheDocument();
    });

    it('should render pack row with data-testid', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      expect(screen.getByTestId('activated-pack-row-pack-001')).toBeInTheDocument();
    });

    it('should display Start column with 000', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      const row = screen.getByTestId('activated-pack-row-pack-001');
      const cells = row.querySelectorAll('td');
      // Start column is the 5th cell (index 4)
      expect(cells[4].textContent).toBe('000');
    });

    it('should display End column with "- - -"', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      const row = screen.getByTestId('activated-pack-row-pack-001');
      const cells = row.querySelectorAll('td');
      // End column is the 6th cell (index 5)
      expect(cells[5].textContent).toBe('- - -');
    });

    it('should have blue hover on rows', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      const row = screen.getByTestId('activated-pack-row-pack-001');
      expect(row.className).toContain('hover:bg-blue-50');
    });

    it('should display activated date and time', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack({ activated_at: '2026-02-02T10:00:00Z' })]}
          defaultOpen={true}
        />
      );
      // Date: Feb 2nd, 2026; Time: 10:00 AM
      expect(screen.getByText(/Feb 2nd, 2026/)).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Start/End Columns
  // --------------------------------------------------------------------------
  describe('Start/End Columns', () => {
    it('should display "Start" and "End" column headers', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      expect(screen.getByText('Start')).toBeInTheDocument();
      expect(screen.getByText('End')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // Status Badges (SEC-014: Constrained allowlist)
  // --------------------------------------------------------------------------
  describe('Status Badges', () => {
    it('should show "Active" badge for ACTIVE packs', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack({ status: 'ACTIVE' })]}
          defaultOpen={true}
        />
      );
      expect(screen.getByText('Active')).toBeInTheDocument();
    });

    it('should show "Sold Out" badge for DEPLETED packs', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack({ status: 'DEPLETED' })]}
          defaultOpen={true}
        />
      );
      expect(screen.getByText('Sold Out')).toBeInTheDocument();
    });

    it('should show "Returned" badge for RETURNED packs', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack({ status: 'RETURNED' })]}
          defaultOpen={true}
        />
      );
      expect(screen.getByText('Returned')).toBeInTheDocument();
    });

    it('should dim rows for non-ACTIVE packs', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack({ status: 'DEPLETED' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('activated-pack-row-pack-001');
      expect(row.className).toContain('opacity-70');
    });

    it('should NOT dim rows for ACTIVE packs', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack({ status: 'ACTIVE' })]}
          defaultOpen={true}
        />
      );
      const row = screen.getByTestId('activated-pack-row-pack-001');
      expect(row.className).not.toContain('opacity-70');
    });

    it('should apply emerald styling for ACTIVE status badge', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack({ status: 'ACTIVE' })]}
          defaultOpen={true}
        />
      );
      const badge = screen.getByText('Active');
      expect(badge.className).toContain('bg-emerald-50');
      expect(badge.className).toContain('text-emerald-600');
    });
  });

  // --------------------------------------------------------------------------
  // Multiple Packs
  // --------------------------------------------------------------------------
  describe('Multiple Packs', () => {
    it('should render all packs', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[
            createPack({ pack_id: 'p1', game_name: 'Powerball', bin_number: 1 }),
            createPack({ pack_id: 'p2', game_name: 'Mega Millions', bin_number: 2 }),
            createPack({ pack_id: 'p3', game_name: 'Cash 5', bin_number: 3 }),
          ]}
          defaultOpen={true}
        />
      );
      expect(screen.getByText('Powerball')).toBeInTheDocument();
      expect(screen.getByText('Mega Millions')).toBeInTheDocument();
      expect(screen.getByText('Cash 5')).toBeInTheDocument();
    });

    it('should skip packs with invalid pack_id', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[
            createPack({ pack_id: 'p1', game_name: 'Powerball' }),
            { pack_id: 123 as unknown as string } as unknown as ActivatedPackDay,
          ]}
          defaultOpen={true}
        />
      );
      expect(screen.getByText('Powerball')).toBeInTheDocument();
      // Only one valid row rendered
      const rows = screen.getAllByTestId(/activated-pack-row/);
      expect(rows.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should show "--" for non-string game_name', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[
            createPack({ game_name: null as unknown as string }),
          ]}
          defaultOpen={true}
        />
      );
      const section = screen.getByTestId('activated-packs-content');
      expect(section.textContent).toContain('--');
    });

    it('should show "--" for non-number game_price', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[
            createPack({ game_price: null as unknown as number }),
          ]}
          defaultOpen={true}
        />
      );
      const section = screen.getByTestId('activated-packs-content');
      expect(section.textContent).toContain('--');
    });

    it('should show 0 in BinBadge for non-number bin_number', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[
            createPack({ bin_number: null as unknown as number }),
          ]}
          defaultOpen={true}
        />
      );
      const section = screen.getByTestId('activated-packs-content');
      const binBadge = section.querySelector('span[class*="bg-blue-100"]');
      expect(binBadge!.textContent).toBe('0');
    });

    it('should show "--" for invalid activated_at date', () => {
      render(
        <ActivatedPacksSection
          activatedPacks={[createPack({ activated_at: 'invalid-date' })]}
          defaultOpen={true}
        />
      );
      const section = screen.getByTestId('activated-packs-content');
      // The date and time cells should show '--'
      const dateCells = section.querySelectorAll('.text-xs.text-foreground');
      const hasPlaceholder = Array.from(dateCells).some((c) => c.textContent === '--');
      expect(hasPlaceholder).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Accessibility
  // --------------------------------------------------------------------------
  describe('Accessibility', () => {
    it('should have aria-label on table region', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      const region = screen.getByRole('region');
      expect(region).toHaveAttribute('aria-label', 'Activated packs table');
    });

    it('should have column headers with scope="col"', () => {
      render(
        <ActivatedPacksSection activatedPacks={[createPack()]} defaultOpen={true} />
      );
      const headers = screen.getAllByRole('columnheader');
      headers.forEach((header) => {
        expect(header).toHaveAttribute('scope', 'col');
      });
    });
  });
});
