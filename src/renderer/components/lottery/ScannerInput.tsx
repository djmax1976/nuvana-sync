/**
 * ScannerInput Component
 *
 * Specialized input component for barcode scanner entry with:
 * - Auto-focus on mount and after each scan
 * - 400ms debounce for scanner vs manual detection
 * - 24-digit serial number validation
 * - Input sanitization (numeric only)
 * - Error feedback for invalid input
 *
 * Story: Lottery Day Close Scanner Feature - Phase 2
 *
 * MCP Guidance Applied:
 * - SEC-014: INPUT_VALIDATION - Strict regex allowlist for 24-digit numeric input
 * - FE-001: FE_XSS_PREVENTION - React JSX auto-escapes all output
 * - PERF-002: FE_RENDER_OPTIMIZATION - useCallback/useMemo for expensive operations
 * - ARCH-001: FE_COMPONENT_DESIGN - Single responsibility, clear props interface
 *
 * @module renderer/components/lottery/ScannerInput
 */

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  forwardRef,
  useImperativeHandle,
  type ChangeEvent,
  type ForwardedRef,
} from 'react';
import { Input } from '@/components/ui/input';

/**
 * Expected length of lottery serial number
 * SEC-014: Strict format constraint
 */
const SERIAL_LENGTH = 24;

/**
 * Validation timeout in milliseconds
 * Scanner input completes in ~120-250ms for 24 digits
 * If 400ms passes with no more input and length != 24, it's invalid
 */
const SCAN_VALIDATION_TIMEOUT_MS = 400;

/**
 * Props for ScannerInput component
 *
 * MCP: ARCH-001 - Clear props interface with TypeScript
 */
export interface ScannerInputProps {
  /**
   * Callback when a valid 24-digit serial is scanned
   * @param serial - The complete 24-digit serial number
   */
  onScan: (serial: string) => void;

  /**
   * Callback when scan validation fails (invalid length after timeout)
   * @param partialSerial - The incomplete input that triggered the error
   */
  onScanError?: (partialSerial: string) => void;

  /**
   * Whether the input is disabled
   */
  disabled?: boolean;

  /**
   * Whether to auto-focus on mount
   * @default true
   */
  autoFocus?: boolean;

  /**
   * Placeholder text
   * @default "Scan barcode..."
   */
  placeholder?: string;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Test ID for testing
   */
  'data-testid'?: string;
}

/**
 * Imperative handle for ScannerInput
 * Allows parent to programmatically control focus
 */
export interface ScannerInputHandle {
  /** Focus the input element */
  focus: () => void;
  /** Clear the input value */
  clear: () => void;
  /** Get current input value */
  getValue: () => string;
}

/**
 * ScannerInput component
 *
 * A specialized input for barcode scanner entry with auto-focus,
 * debounce validation, and error feedback.
 *
 * @example
 * ```tsx
 * const scannerRef = useRef<ScannerInputHandle>(null);
 *
 * <ScannerInput
 *   ref={scannerRef}
 *   onScan={(serial) => processSerial(serial)}
 *   onScanError={() => playErrorSound()}
 * />
 * ```
 */
export const ScannerInput = forwardRef<ScannerInputHandle, ScannerInputProps>(function ScannerInput(
  {
    onScan,
    onScanError,
    disabled = false,
    autoFocus = true,
    placeholder = 'Scan barcode...',
    className = '',
    'data-testid': testId = 'scanner-input',
  }: ScannerInputProps,
  ref: ForwardedRef<ScannerInputHandle>
) {
  // Refs
  const inputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<string>('');
  const validationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // State for display (refs can't be accessed during render)
  const [displayLength, setDisplayLength] = useState(0);

  // Expose imperative handle to parent
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        inputRef.current?.focus();
      },
      clear: () => {
        if (inputRef.current) {
          inputRef.current.value = '';
          valueRef.current = '';
          setDisplayLength(0);
        }
      },
      getValue: () => valueRef.current,
    }),
    []
  );

  /**
   * Clear input and refocus for next scan
   * MCP: FE-001 - Clean state transitions
   */
  const clearAndFocus = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.value = '';
      valueRef.current = '';
      setDisplayLength(0);
      // Small delay ensures React has processed any pending updates
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, []);

  /**
   * Handle input change with validation debounce
   *
   * MCP: SEC-014 INPUT_VALIDATION
   * - Only allows numeric digits (strict regex)
   * - Validates length after 400ms timeout
   * - Immediately processes 24-digit input
   */
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value;

      // SEC-014: Strip non-numeric characters (sanitize input)
      const cleanedValue = rawValue.replace(/\D/g, '');

      // Clear any pending validation timer
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current);
        validationTimerRef.current = null;
      }

      // Handle numeric input
      if (cleanedValue.length > 0) {
        // SEC-014: Reject if too long - immediate error
        if (cleanedValue.length > SERIAL_LENGTH) {
          onScanError?.(cleanedValue);
          clearAndFocus();
          return;
        }

        // Update value
        valueRef.current = cleanedValue;
        setDisplayLength(cleanedValue.length);
        if (inputRef.current) {
          inputRef.current.value = cleanedValue;
        }

        // If exactly 24 digits, process immediately
        if (cleanedValue.length === SERIAL_LENGTH) {
          // SEC-014: Final validation - must be exactly 24 digits
          if (/^\d{24}$/.test(cleanedValue)) {
            onScan(cleanedValue);
            clearAndFocus();
          } else {
            // Should not happen due to prior sanitization, but defense-in-depth
            onScanError?.(cleanedValue);
            clearAndFocus();
          }
          return;
        }

        // Start 400ms validation timer
        // If no more input comes and length != 24, show error
        const capturedLength = cleanedValue.length;
        validationTimerRef.current = setTimeout(() => {
          if (capturedLength !== SERIAL_LENGTH && capturedLength > 0) {
            onScanError?.(cleanedValue);
            clearAndFocus();
          }
        }, SCAN_VALIDATION_TIMEOUT_MS);
      } else {
        // Input was cleared
        valueRef.current = '';
        setDisplayLength(0);
        if (inputRef.current) {
          inputRef.current.value = '';
        }
      }
    },
    [onScan, onScanError, clearAndFocus]
  );

  // Auto-focus on mount
  useEffect(() => {
    if (autoFocus && !disabled) {
      const timeoutId = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [autoFocus, disabled]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (validationTimerRef.current) {
        clearTimeout(validationTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={SERIAL_LENGTH}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        className={`font-mono ${className}`}
        data-testid={testId}
        aria-label="Scan lottery serial number"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <span
        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono pointer-events-none"
        aria-hidden="true"
      >
        {displayLength}/{SERIAL_LENGTH}
      </span>
    </div>
  );
});
