/**
 * useMenuPermissions Hook
 *
 * Provides permission-based menu visibility logic for the client dashboard.
 * This hook centralizes the logic for determining which menu items a user can access
 * based on their assigned permissions.
 *
 * Design Principles:
 * - Single responsibility: Only handles menu permission logic
 * - Memoized computations to prevent unnecessary re-renders
 * - Type-safe with full TypeScript support
 * - Testable: Pure functions with dependency injection
 *
 * Security Note:
 * This hook provides UI-level filtering only. It improves UX by hiding
 * menu items users cannot access. Backend APIs must independently
 * enforce authorization - this is defense in depth, not the primary security layer.
 *
 * @see src/config/menu-permissions.ts for permission configuration
 */

import { useMemo, useCallback } from "react";
import {
  CLIENT_MENU_PERMISSIONS,
  hasMenuPermission,
  extractMenuKeyFromHref,
  getMenuPermissionConfig,
  type MenuPermissionConfig,
} from "@/config/menu-permissions";

/**
 * NavItem interface matching ClientSidebar navigation items
 */
export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
}

/**
 * Result of useMenuPermissions hook
 */
export interface UseMenuPermissionsResult {
  /**
   * Filter an array of nav items to only include those the user can access
   * @param items - Array of navigation items
   * @returns Filtered array containing only accessible items
   */
  filterNavItems: (items: NavItem[]) => NavItem[];

  /**
   * Check if user can access a specific menu item by href
   * @param href - Menu item href path
   * @returns true if user can access the menu
   */
  canAccessMenu: (href: string) => boolean;

  /**
   * Check if user can access a specific menu item by key
   * @param menuKey - Menu item key (e.g., "shifts", "inventory")
   * @returns true if user can access the menu
   */
  canAccessMenuByKey: (menuKey: string) => boolean;

  /**
   * Get the permission configuration for a menu key
   * @param menuKey - Menu item key
   * @returns Permission configuration or undefined
   */
  getMenuConfig: (menuKey: string) => MenuPermissionConfig | undefined;

  /**
   * Array of menu keys the user can access
   */
  accessibleMenuKeys: string[];

  /**
   * Check if a specific permission is granted to the user
   * @param permissionCode - Permission code to check
   * @returns true if user has the permission
   */
  hasPermission: (permissionCode: string) => boolean;
}

/**
 * Hook for permission-based menu visibility
 *
 * @param userPermissions - Array of permission codes assigned to the user
 * @returns Object with menu filtering utilities
 *
 * @example
 * ```tsx
 * const { permissions } = useClientAuth();
 * const { filterNavItems, canAccessMenu } = useMenuPermissions(permissions);
 *
 * // Filter nav items
 * const visibleItems = filterNavItems(allNavItems);
 *
 * // Check specific access
 * if (canAccessMenu("/client-dashboard/inventory")) {
 *   // Show inventory-related content
 * }
 * ```
 */
export function useMenuPermissions(
  userPermissions: string[],
): UseMenuPermissionsResult {
  // Defensive: ensure permissions is always an array (handles undefined/null)
  const safePermissions = useMemo(
    () => (Array.isArray(userPermissions) ? userPermissions : []),
    [userPermissions],
  );

  // Memoize the permissions set for O(1) lookups
  const permissionsSet = useMemo(
    () => new Set(safePermissions),
    [safePermissions],
  );

  // Compute accessible menu keys once
  const accessibleMenuKeys = useMemo(() => {
    return CLIENT_MENU_PERMISSIONS.filter((config) =>
      hasMenuPermission(safePermissions, config),
    ).map((config) => config.menuKey);
  }, [safePermissions]);

  // Memoize accessible keys set for O(1) lookups
  const accessibleKeysSet = useMemo(
    () => new Set(accessibleMenuKeys),
    [accessibleMenuKeys],
  );

  /**
   * Check if user has a specific permission
   */
  const hasPermission = useCallback(
    (permissionCode: string): boolean => {
      return permissionsSet.has(permissionCode);
    },
    [permissionsSet],
  );

  /**
   * Check if user can access a menu by its key
   */
  const canAccessMenuByKey = useCallback(
    (menuKey: string): boolean => {
      // Check if key is in accessible keys
      if (accessibleKeysSet.has(menuKey)) {
        return true;
      }

      // Fallback: check config directly (handles dynamic/unknown keys)
      const config = getMenuPermissionConfig(menuKey);
      if (!config) {
        // Unknown menu key - deny by default (secure default)
        return false;
      }

      return hasMenuPermission(safePermissions, config);
    },
    [accessibleKeysSet, safePermissions],
  );

  /**
   * Check if user can access a menu by its href path
   */
  const canAccessMenu = useCallback(
    (href: string): boolean => {
      const menuKey = extractMenuKeyFromHref(href);
      return canAccessMenuByKey(menuKey);
    },
    [canAccessMenuByKey],
  );

  /**
   * Filter nav items to only include accessible ones
   */
  const filterNavItems = useCallback(
    (items: NavItem[]): NavItem[] => {
      return items.filter((item) => canAccessMenu(item.href));
    },
    [canAccessMenu],
  );

  /**
   * Get menu configuration by key
   */
  const getMenuConfig = useCallback(
    (menuKey: string): MenuPermissionConfig | undefined => {
      return getMenuPermissionConfig(menuKey);
    },
    [],
  );

  return {
    filterNavItems,
    canAccessMenu,
    canAccessMenuByKey,
    getMenuConfig,
    accessibleMenuKeys,
    hasPermission,
  };
}

/**
 * Pure function version for testing without hooks
 * Useful for unit testing the filtering logic
 *
 * @param userPermissions - Array of permission codes
 * @param navItems - Array of navigation items
 * @returns Filtered array of accessible navigation items
 */
export function filterNavItemsByPermissions(
  userPermissions: string[],
  navItems: NavItem[],
): NavItem[] {
  return navItems.filter((item) => {
    const menuKey = extractMenuKeyFromHref(item.href);
    const config = getMenuPermissionConfig(menuKey);

    // No config found - deny by default
    if (!config) {
      return false;
    }

    return hasMenuPermission(userPermissions, config);
  });
}

/**
 * Check if a user can access a menu item (pure function for testing)
 *
 * @param userPermissions - Array of permission codes
 * @param href - Menu item href path
 * @returns true if user can access the menu
 */
export function canUserAccessMenu(
  userPermissions: string[],
  href: string,
): boolean {
  const menuKey = extractMenuKeyFromHref(href);
  const config = getMenuPermissionConfig(menuKey);

  if (!config) {
    return false;
  }

  return hasMenuPermission(userPermissions, config);
}
