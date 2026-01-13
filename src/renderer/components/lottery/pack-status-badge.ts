/**
 * Pack Status Badge Utility
 * Provides color mapping for lottery pack status badges
 *
 * Story: 6.10 - Lottery Management UI
 * AC #1: Pack status is displayed with appropriate visual badges/indicators
 */

export type PackStatus = "RECEIVED" | "ACTIVE" | "DEPLETED" | "RETURNED";

export type BadgeVariant =
  | "secondary"
  | "success"
  | "destructive"
  | "warning"
  | "outline";

/**
 * Get badge variant for pack status
 * RECEIVED: Blue/Gray (secondary)
 * ACTIVE: Green (success)
 * DEPLETED: Red/Orange (destructive)
 * RETURNED: Yellow/Amber (warning)
 *
 * @param status - Pack status
 * @returns Badge variant for shadcn/ui Badge component
 */
export function getPackStatusBadgeVariant(status: PackStatus): BadgeVariant {
  switch (status) {
    case "RECEIVED":
      return "secondary"; // Blue/Gray
    case "ACTIVE":
      return "success"; // Green
    case "DEPLETED":
      return "destructive"; // Red/Orange
    case "RETURNED":
      return "warning"; // Yellow/Amber
    default:
      return "outline";
  }
}

/**
 * Get display text for pack status
 * @param status - Pack status
 * @returns Human-readable status text
 */
export function getPackStatusText(status: PackStatus): string {
  return status;
}
