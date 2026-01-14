import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Currency formatter cache
 * Keyed by locale and currency to reuse Intl.NumberFormat instances
 */
const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Get cache key for currency formatter
 */
function getFormatterKey(locale: string, currency: string): string {
  return `${locale}-${currency}`;
}

/**
 * Get or create a memoized currency formatter
 * @param locale - Locale string (e.g., "en-US", "en-GB")
 * @param currency - ISO 4217 currency code (e.g., "USD", "EUR", "GBP")
 * @returns Intl.NumberFormat instance
 */
function getCurrencyFormatter(
  locale: string = 'en-US',
  currency: string = 'USD'
): Intl.NumberFormat {
  const key = getFormatterKey(locale, currency);

  if (!currencyFormatterCache.has(key)) {
    currencyFormatterCache.set(
      key,
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
      })
    );
  }

  return currencyFormatterCache.get(key)!;
}

/**
 * Format a number as currency
 * Uses a memoized Intl.NumberFormat instance for performance
 *
 * @param value - The numeric value to format
 * @param currency - Optional ISO 4217 currency code (default: "USD")
 * @param locale - Optional locale string (default: "en-US")
 * @returns Formatted currency string
 *
 * @example
 * formatCurrency(1234.56) // "$1,234.56"
 * formatCurrency(1234.56, "EUR") // "€1,234.56"
 * formatCurrency(1234.56, "GBP", "en-GB") // "£1,234.56"
 */
export function formatCurrency(value: number, currency?: string, locale?: string): string {
  const formatter = getCurrencyFormatter(locale ?? 'en-US', currency ?? 'USD');
  return formatter.format(value);
}

/**
 * Sanitize a string for safe display in the UI
 * Prevents XSS by escaping HTML special characters
 */
export function sanitizeForDisplay(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitize a string for use as an ID attribute
 * Removes special characters and spaces
 */
export function sanitizeId(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value)
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Mask an employee name for privacy
 * Shows first name and first letter of last name
 */
export function maskEmployeeName(name: string | null | undefined): string {
  if (!name) return 'Unknown';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1]?.[0] ?? '';
  return `${firstName} ${lastInitial}.`;
}

/**
 * Mask sensitive data by showing only last N characters
 * E.g., maskSensitiveData("PKG-004821", 4) => "***4821"
 */
export function maskSensitiveData(
  value: string | null | undefined,
  visibleChars: number = 4
): string {
  if (!value) return '';
  if (value.length <= visibleChars) return value;
  const visible = value.slice(-visibleChars);
  return `***${visible}`;
}

/**
 * Mask transaction ID for display
 * Shows only the last 4 characters
 */
export function maskTransactionId(txnId: string | null | undefined): string {
  return maskSensitiveData(txnId, 4);
}
