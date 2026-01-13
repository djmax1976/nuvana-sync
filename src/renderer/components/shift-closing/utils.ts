/**
 * Shift/Day Closing Utility Functions
 *
 * Shared utility functions for formatting and validation.
 *
 * @security
 * - SEC-014: INPUT_VALIDATION - Strict input sanitization
 * - FE-002: FORM_VALIDATION - Consistent validation patterns
 */

/**
 * Format number as USD currency
 *
 * @param amount - Numeric amount to format
 * @returns Formatted currency string (e.g., "$1,234.56")
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Sanitize numeric input value
 *
 * Removes all non-numeric characters except decimal point,
 * ensures only one decimal point, and returns parsed number.
 *
 * @security SEC-014: INPUT_VALIDATION - Strict allowlist for numeric input
 *
 * @param value - Raw input string
 * @returns Sanitized numeric value (defaults to 0 if invalid)
 */
export function sanitizeNumericInput(value: string): number {
  // Remove all characters except digits and decimal point
  let sanitized = value.replace(/[^0-9.]/g, "");

  // Ensure only one decimal point
  const parts = sanitized.split(".");
  if (parts.length > 2) {
    sanitized = parts[0] + "." + parts.slice(1).join("");
  }

  // Parse and return, defaulting to 0 for invalid values
  const parsed = parseFloat(sanitized);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Format date for display
 *
 * @param dateString - ISO date string (YYYY-MM-DD)
 * @returns Formatted date string (e.g., "Thursday, December 18, 2025")
 */
export function formatBusinessDate(dateString: string | undefined): string {
  if (!dateString) return "Today";

  try {
    // Add noon time to avoid timezone issues
    const date = new Date(dateString + "T12:00:00");
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "Today";
  }
}

/**
 * Truncate UUID for display
 *
 * @param uuid - Full UUID string
 * @param length - Number of characters to show (default 8)
 * @returns Truncated UUID with ellipsis
 */
export function truncateUuid(uuid: string, length = 8): string {
  if (!uuid || uuid.length <= length) return uuid;
  return `${uuid.slice(0, length)}...`;
}

/**
 * Validate that all required fields have values
 *
 * Uses Map for safe property lookup to avoid prototype pollution.
 *
 * @security SEC-014: INPUT_VALIDATION - Safe property access via Map
 *
 * @param values - Object with numeric values
 * @param requiredFields - Array of field names that must be > 0
 * @returns true if all required fields have positive values
 */
export function validateRequiredFields(
  values: Record<string, number>,
  requiredFields: string[],
): boolean {
  // Convert to Map for safe property access (avoids prototype pollution)
  const valuesMap = new Map(Object.entries(values));

  return requiredFields.every((field) => {
    const value = valuesMap.get(field);
    return typeof value === "number" && value > 0;
  });
}
