/**
 * Employee Avatar Component for Reports
 *
 * Displays employee initials in a circular gradient-background avatar.
 * Supports multiple sizes and follows accessibility best practices.
 *
 * @module renderer/components/reports/EmployeeAvatar
 * @security SEC-004: XSS prevention via React's automatic escaping
 * @security FE-001: No dangerouslySetInnerHTML, all content is text
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Available avatar sizes
 */
export type AvatarSize = 'sm' | 'md' | 'lg';

export interface EmployeeAvatarProps {
  /** Full name of the employee */
  name: string;
  /** Size of the avatar */
  size?: AvatarSize;
  /** Additional CSS classes */
  className?: string;
  /** Test ID for testing purposes */
  'data-testid'?: string;
}

/**
 * Size configuration mapping
 * Maps semantic size names to Tailwind classes
 */
const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

/**
 * Extract initials from a name
 *
 * Rules:
 * - Single name: Returns first letter (e.g., "John" → "J")
 * - Two+ names: Returns first letter of first and last name (e.g., "John Smith" → "JS")
 * - Empty/whitespace: Returns empty string
 * - Handles extra whitespace gracefully
 *
 * @param name - The full name to extract initials from
 * @returns The initials (1-2 characters) or empty string
 */
export function getInitials(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  // Trim and split by whitespace, filtering out empty strings
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  if (parts.length === 1) {
    // Single name - return first letter
    return parts[0].charAt(0).toUpperCase();
  }

  // Multiple names - return first letter of first and last name
  const firstInitial = parts[0].charAt(0);
  const lastInitial = parts[parts.length - 1].charAt(0);

  return (firstInitial + lastInitial).toUpperCase();
}

/**
 * EmployeeAvatar Component
 *
 * Renders a circular avatar with the employee's initials on a gradient background.
 * The gradient provides visual distinction between avatars.
 *
 * Security Compliance:
 * - SEC-004: XSS prevention via React's automatic escaping
 * - FE-001: No use of dangerouslySetInnerHTML
 *
 * Accessibility:
 * - Uses aria-label to provide the full name for screen readers
 * - Visual initials are decorative (aria-hidden could be applied if needed)
 *
 * @example
 * <EmployeeAvatar name="John Smith" size="md" />
 * <EmployeeAvatar name="Jane" size="sm" />
 */
export const EmployeeAvatar = React.memo(function EmployeeAvatar({
  name,
  size = 'md',
  className,
  'data-testid': testId,
}: EmployeeAvatarProps) {
  const initials = getInitials(name);
  const sizeClasses = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        'bg-gradient-to-br from-primary to-chart-4',
        sizeClasses,
        className
      )}
      aria-label={name || 'Unknown employee'}
      data-testid={testId ?? 'employee-avatar'}
    >
      {initials}
    </span>
  );
});

EmployeeAvatar.displayName = 'EmployeeAvatar';
