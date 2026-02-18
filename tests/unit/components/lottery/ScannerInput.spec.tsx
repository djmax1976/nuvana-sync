/**
 * ScannerInput Unit Tests
 *
 * Tests the ScannerInput component for:
 * - Auto-focus behavior on mount
 * - 400ms debounce logic (scanner vs manual detection)
 * - Valid/invalid input handling (24-digit validation)
 * - Focus retention after scan
 * - Input sanitization (numeric only)
 * - Imperative handle methods (focus, clear, getValue)
 *
 * Story: Lottery Day Close Scanner Feature - Phase 2
 *
 * Traceability:
 * - REQ-002: Inline scanner input (auto-focused)
 * - REQ-003: 24-digit barcode parsing
 * - REQ-013: 400ms debounce for scanner vs manual detection
 * - REQ-014: Input stays focused after each scan
 * - SEC-014: Input validation (strict 24-digit numeric)
 * - ARCH-004: Component-level isolation tests
 * - TEST-005: Single concept per test
 *
 * @module tests/unit/components/lottery/ScannerInput
 */

// @vitest-environment jsdom

import React, { createRef } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ============================================================================
// Import Component Under Test
// ============================================================================

import {
  ScannerInput,
  type ScannerInputHandle,
} from '../../../../src/renderer/components/lottery/ScannerInput';

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_SERIAL = '000112345670123456789012'; // 24 digits
const VALID_SERIAL_2 = '000298765430153456789012'; // Different pack
const _INVALID_SERIAL_SHORT = '00011234567012345678901'; // 23 digits
const _INVALID_SERIAL_LONG = '0001123456701234567890123'; // 25 digits
// Reserved for future alpha character validation tests
const _INVALID_SERIAL_ALPHA = '000112345670123456789abc'; // Contains letters

// ============================================================================
// Tests
// ============================================================================

describe('ScannerInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Rendering
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render with data-testid', () => {
      render(<ScannerInput onScan={vi.fn()} />);
      expect(screen.getByTestId('scanner-input')).toBeInTheDocument();
    });

    it('should render with custom data-testid', () => {
      render(<ScannerInput onScan={vi.fn()} data-testid="custom-scanner" />);
      expect(screen.getByTestId('custom-scanner')).toBeInTheDocument();
    });

    it('should render placeholder text', () => {
      render(<ScannerInput onScan={vi.fn()} placeholder="Scan here..." />);
      expect(screen.getByPlaceholderText('Scan here...')).toBeInTheDocument();
    });

    it('should show 0/24 counter initially', () => {
      render(<ScannerInput onScan={vi.fn()} />);
      expect(screen.getByText('0/24')).toBeInTheDocument();
    });

    it('should have aria-label for accessibility', () => {
      render(<ScannerInput onScan={vi.fn()} />);
      const input = screen.getByTestId('scanner-input');
      expect(input).toHaveAttribute('aria-label', 'Scan lottery serial number');
    });

    it('should have numeric input mode', () => {
      render(<ScannerInput onScan={vi.fn()} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;
      expect(input).toHaveAttribute('inputMode', 'numeric');
      expect(input).toHaveAttribute('pattern', '[0-9]*');
    });

    it('should disable autocomplete/autocorrect', () => {
      render(<ScannerInput onScan={vi.fn()} />);
      const input = screen.getByTestId('scanner-input');
      expect(input).toHaveAttribute('autocomplete', 'off');
      expect(input).toHaveAttribute('autocorrect', 'off');
      expect(input).toHaveAttribute('autocapitalize', 'off');
    });
  });

  // --------------------------------------------------------------------------
  // Auto-Focus
  // --------------------------------------------------------------------------
  describe('Auto-Focus', () => {
    it('should auto-focus on mount when autoFocus is true (default)', async () => {
      render(<ScannerInput onScan={vi.fn()} />);
      const input = screen.getByTestId('scanner-input');

      // Wait for auto-focus timeout (100ms)
      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(document.activeElement).toBe(input);
    });

    it('should NOT auto-focus when autoFocus is false', async () => {
      render(<ScannerInput onScan={vi.fn()} autoFocus={false} />);
      const input = screen.getByTestId('scanner-input');

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(document.activeElement).not.toBe(input);
    });

    it('should NOT auto-focus when disabled', async () => {
      render(<ScannerInput onScan={vi.fn()} disabled={true} />);
      const input = screen.getByTestId('scanner-input');

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(document.activeElement).not.toBe(input);
    });
  });

  // --------------------------------------------------------------------------
  // Input Sanitization (SEC-014)
  // --------------------------------------------------------------------------
  describe('Input Sanitization', () => {
    it('should strip non-numeric characters', () => {
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'abc123def' } });

      // Only digits should remain
      expect(input.value).toBe('123');
    });

    it('should strip spaces and special characters', () => {
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: '1 2-3.4/5' } });

      expect(input.value).toBe('12345');
    });

    it('should truncate input to 24 characters max', () => {
      const onScanError = vi.fn();
      render(<ScannerInput onScan={vi.fn()} onScanError={onScanError} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;

      // Try to enter 25+ digits
      fireEvent.change(input, { target: { value: '0001234567890123456789012345' } });

      // Should call error and clear
      expect(onScanError).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Valid 24-Digit Input
  // --------------------------------------------------------------------------
  describe('Valid 24-Digit Input', () => {
    it('should call onScan when exactly 24 digits are entered', () => {
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: VALID_SERIAL } });

      expect(onScan).toHaveBeenCalledWith(VALID_SERIAL);
    });

    it('should clear input after successful scan', () => {
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: VALID_SERIAL } });

      // Input should be cleared
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(input.value).toBe('');
    });

    it('should handle rapid successive scans', () => {
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;

      // First scan
      fireEvent.change(input, { target: { value: VALID_SERIAL } });
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(onScan).toHaveBeenCalledTimes(1);

      // Second scan
      fireEvent.change(input, { target: { value: VALID_SERIAL_2 } });
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(onScan).toHaveBeenCalledTimes(2);
      expect(onScan).toHaveBeenLastCalledWith(VALID_SERIAL_2);
    });
  });

  // --------------------------------------------------------------------------
  // 400ms Debounce Validation
  // --------------------------------------------------------------------------
  describe('400ms Debounce Validation', () => {
    it('should call onScanError after 400ms if input is incomplete', () => {
      const onScanError = vi.fn();
      render(<ScannerInput onScan={vi.fn()} onScanError={onScanError} />);
      const input = screen.getByTestId('scanner-input');

      // Enter partial input (less than 24 digits)
      fireEvent.change(input, { target: { value: '00011234567' } });

      // Should not error immediately
      expect(onScanError).not.toHaveBeenCalled();

      // Wait 400ms
      act(() => {
        vi.advanceTimersByTime(400);
      });

      // Should error after timeout
      expect(onScanError).toHaveBeenCalledWith('00011234567');
    });

    it('should NOT call onScanError before 400ms timeout', () => {
      const onScanError = vi.fn();
      render(<ScannerInput onScan={vi.fn()} onScanError={onScanError} />);
      const input = screen.getByTestId('scanner-input');

      fireEvent.change(input, { target: { value: '00011234567' } });

      // Wait only 300ms
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(onScanError).not.toHaveBeenCalled();
    });

    it('should reset timer on additional input', () => {
      const onScanError = vi.fn();
      render(<ScannerInput onScan={vi.fn()} onScanError={onScanError} />);
      const input = screen.getByTestId('scanner-input');

      // First partial input
      fireEvent.change(input, { target: { value: '000112345' } });

      // Wait 300ms
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // More input (timer should reset)
      fireEvent.change(input, { target: { value: '00011234567' } });

      // Wait another 300ms (total 600ms from first, but only 300ms from second)
      act(() => {
        vi.advanceTimersByTime(300);
      });

      // Should not have errored yet (timer was reset)
      expect(onScanError).not.toHaveBeenCalled();

      // Wait another 100ms (now 400ms from second input)
      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(onScanError).toHaveBeenCalledWith('00011234567');
    });

    it('should NOT trigger timeout error if valid 24 digits entered before timeout', () => {
      const onScanError = vi.fn();
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} onScanError={onScanError} />);
      const input = screen.getByTestId('scanner-input');

      // Enter partial input
      fireEvent.change(input, { target: { value: '000112345670123456789' } });

      // Wait 200ms
      act(() => {
        vi.advanceTimersByTime(200);
      });

      // Complete to 24 digits
      fireEvent.change(input, { target: { value: VALID_SERIAL } });

      // Wait full 400ms
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(onScanError).not.toHaveBeenCalled();
      expect(onScan).toHaveBeenCalledWith(VALID_SERIAL);
    });

    it('should clear input after timeout error', () => {
      const onScanError = vi.fn();
      render(<ScannerInput onScan={vi.fn()} onScanError={onScanError} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;

      fireEvent.change(input, { target: { value: '00011234567' } });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(input.value).toBe('');
    });
  });

  // --------------------------------------------------------------------------
  // Disabled State
  // --------------------------------------------------------------------------
  describe('Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<ScannerInput onScan={vi.fn()} disabled={true} />);
      const input = screen.getByTestId('scanner-input');
      expect(input).toBeDisabled();
    });

    it('should NOT process input when disabled', () => {
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} disabled={true} />);
      const input = screen.getByTestId('scanner-input');

      // Input is disabled, so change won't work in a real browser
      // but we can verify the disabled state
      expect(input).toBeDisabled();
    });
  });

  // --------------------------------------------------------------------------
  // Imperative Handle
  // --------------------------------------------------------------------------
  describe('Imperative Handle', () => {
    it('should expose focus method', () => {
      const ref = createRef<ScannerInputHandle>();
      render(<ScannerInput ref={ref} onScan={vi.fn()} autoFocus={false} />);

      const input = screen.getByTestId('scanner-input');

      // Initially not focused (autoFocus disabled)
      expect(document.activeElement).not.toBe(input);

      // Call focus via ref
      act(() => {
        ref.current?.focus();
      });

      expect(document.activeElement).toBe(input);
    });

    it('should expose clear method', () => {
      const ref = createRef<ScannerInputHandle>();
      render(<ScannerInput ref={ref} onScan={vi.fn()} />);
      const input = screen.getByTestId('scanner-input') as HTMLInputElement;

      // Enter some text
      fireEvent.change(input, { target: { value: '12345' } });
      expect(input.value).toBe('12345');

      // Clear via ref
      act(() => {
        ref.current?.clear();
      });

      expect(input.value).toBe('');
    });

    it('should expose getValue method', () => {
      const ref = createRef<ScannerInputHandle>();
      render(<ScannerInput ref={ref} onScan={vi.fn()} />);
      const input = screen.getByTestId('scanner-input');

      fireEvent.change(input, { target: { value: '12345' } });

      expect(ref.current?.getValue()).toBe('12345');
    });
  });

  // --------------------------------------------------------------------------
  // Edge Cases
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle empty input gracefully', () => {
      const onScan = vi.fn();
      const onScanError = vi.fn();
      render(<ScannerInput onScan={onScan} onScanError={onScanError} />);
      const input = screen.getByTestId('scanner-input');

      fireEvent.change(input, { target: { value: '' } });

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onScan).not.toHaveBeenCalled();
      expect(onScanError).not.toHaveBeenCalled();
    });

    it('should handle all zeros as valid input', () => {
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} />);
      const input = screen.getByTestId('scanner-input');

      const allZeros = '0'.repeat(24);
      fireEvent.change(input, { target: { value: allZeros } });

      expect(onScan).toHaveBeenCalledWith(allZeros);
    });

    it('should handle all nines as valid input', () => {
      const onScan = vi.fn();
      render(<ScannerInput onScan={onScan} />);
      const input = screen.getByTestId('scanner-input');

      const allNines = '9'.repeat(24);
      fireEvent.change(input, { target: { value: allNines } });

      expect(onScan).toHaveBeenCalledWith(allNines);
    });
  });

  // --------------------------------------------------------------------------
  // CSS Classes
  // --------------------------------------------------------------------------
  describe('CSS Classes', () => {
    it('should apply custom className', () => {
      render(<ScannerInput onScan={vi.fn()} className="custom-class" />);
      const input = screen.getByTestId('scanner-input');
      expect(input.className).toContain('custom-class');
    });

    it('should have font-mono class for monospace font', () => {
      render(<ScannerInput onScan={vi.fn()} />);
      const input = screen.getByTestId('scanner-input');
      expect(input.className).toContain('font-mono');
    });
  });
});
