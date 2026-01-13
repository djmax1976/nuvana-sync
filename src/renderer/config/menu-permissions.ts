/**
 * Menu Permission Configuration
 *
 * Defines the mapping between menu items and required permissions.
 * This configuration enables permission-based menu visibility in the client dashboard.
 *
 * Design Principles:
 * - Centralized configuration for maintainability
 * - Deny-by-default: menus without explicit permission mapping are hidden
 * - Support for multiple permission requirements (ANY or ALL)
 * - Type-safe permission codes matching backend constants
 *
 * @see backend/src/constants/permissions.ts for permission definitions
 */

/**
 * Permission requirement mode
 * - ANY: User needs at least one of the listed permissions
 * - ALL: User needs all listed permissions
 */
export type PermissionRequirementMode = "ANY" | "ALL";

/**
 * Menu permission configuration for a single menu item
 */
export interface MenuPermissionConfig {
  /** Unique identifier for the menu item (matches NavItem href path segment) */
  menuKey: string;
  /** Human-readable menu title for debugging/logging */
  menuTitle: string;
  /** Required permission codes */
  requiredPermissions: string[];
  /** How to evaluate multiple permissions (default: ANY) */
  mode?: PermissionRequirementMode;
  /** If true, menu is always visible regardless of permissions */
  alwaysVisible?: boolean;
  /** If true, requires re-authentication before navigating to this menu item */
  requiresAuth?: boolean;
}

/**
 * Permission codes - mirrored from backend for type safety
 * These MUST match the backend permission constants
 *
 * @see backend/src/constants/permissions.ts
 */
export const PERMISSION_CODES = {
  // Shift Operations
  SHIFT_OPEN: "SHIFT_OPEN",
  SHIFT_CLOSE: "SHIFT_CLOSE",
  SHIFT_READ: "SHIFT_READ",
  SHIFT_RECONCILE: "SHIFT_RECONCILE",
  SHIFT_REPORT_VIEW: "SHIFT_REPORT_VIEW",

  // Transactions
  TRANSACTION_CREATE: "TRANSACTION_CREATE",
  TRANSACTION_READ: "TRANSACTION_READ",

  // Inventory
  INVENTORY_READ: "INVENTORY_READ",
  INVENTORY_ADJUST: "INVENTORY_ADJUST",
  INVENTORY_ORDER: "INVENTORY_ORDER",

  // Lottery
  LOTTERY_PACK_RECEIVE: "LOTTERY_PACK_RECEIVE",
  LOTTERY_SHIFT_RECONCILE: "LOTTERY_SHIFT_RECONCILE",
  LOTTERY_REPORT: "LOTTERY_REPORT",

  // Reports
  REPORT_SHIFT: "REPORT_SHIFT",
  REPORT_DAILY: "REPORT_DAILY",
  REPORT_ANALYTICS: "REPORT_ANALYTICS",
  REPORT_EXPORT: "REPORT_EXPORT",

  // Client Employee Management
  CLIENT_EMPLOYEE_CREATE: "CLIENT_EMPLOYEE_CREATE",
  CLIENT_EMPLOYEE_READ: "CLIENT_EMPLOYEE_READ",
  CLIENT_EMPLOYEE_DELETE: "CLIENT_EMPLOYEE_DELETE",

  // Client Role Management
  CLIENT_ROLE_MANAGE: "CLIENT_ROLE_MANAGE",

  // Cashier Management
  CASHIER_CREATE: "CASHIER_CREATE",
  CASHIER_READ: "CASHIER_READ",
  CASHIER_UPDATE: "CASHIER_UPDATE",
  CASHIER_DELETE: "CASHIER_DELETE",

  // Store Management
  STORE_READ: "STORE_READ",
  STORE_UPDATE: "STORE_UPDATE",

  // Client Dashboard
  CLIENT_DASHBOARD_ACCESS: "CLIENT_DASHBOARD_ACCESS",

  // Configuration & Lookup Tables
  CONFIG_READ: "CONFIG_READ",
  CONFIG_MANAGE: "CONFIG_MANAGE",
  TENDER_TYPE_READ: "TENDER_TYPE_READ",
  TENDER_TYPE_MANAGE: "TENDER_TYPE_MANAGE",
  DEPARTMENT_READ: "DEPARTMENT_READ",
  DEPARTMENT_MANAGE: "DEPARTMENT_MANAGE",
  TAX_RATE_READ: "TAX_RATE_READ",
  TAX_RATE_MANAGE: "TAX_RATE_MANAGE",

  // POS Integration
  POS_SYNC_TRIGGER: "POS_SYNC_TRIGGER",
} as const;

export type PermissionCode =
  (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES];

/**
 * Client Dashboard Menu Permission Configuration
 *
 * Maps each menu item to its required permissions.
 * Menu items are hidden unless the user has the required permissions.
 *
 * Security Note: This is UI-level filtering only. Backend APIs must independently
 * enforce authorization. This prevents UI clutter, not unauthorized access.
 */
export const CLIENT_MENU_PERMISSIONS: MenuPermissionConfig[] = [
  // Dashboard - Always visible to authenticated client users
  {
    menuKey: "dashboard",
    menuTitle: "Dashboard",
    requiredPermissions: [PERMISSION_CODES.CLIENT_DASHBOARD_ACCESS],
    alwaysVisible: true, // Core navigation, always shown
  },

  // Shift Management - Requires shift-related permissions
  {
    menuKey: "shifts",
    menuTitle: "Shift Management",
    requiredPermissions: [
      PERMISSION_CODES.SHIFT_READ,
      PERMISSION_CODES.SHIFT_OPEN,
      PERMISSION_CODES.SHIFT_CLOSE,
      PERMISSION_CODES.SHIFT_RECONCILE,
    ],
    mode: "ANY", // Show if user can do ANY shift operation
  },

  // Daily Summary - Requires shift or report viewing permissions
  {
    menuKey: "shift-and-day",
    menuTitle: "Daily Summary",
    requiredPermissions: [
      PERMISSION_CODES.SHIFT_READ,
      PERMISSION_CODES.SHIFT_REPORT_VIEW,
      PERMISSION_CODES.REPORT_DAILY,
      PERMISSION_CODES.REPORT_SHIFT,
    ],
    mode: "ANY",
  },

  // Inventory - Requires inventory permissions
  {
    menuKey: "inventory",
    menuTitle: "Inventory",
    requiredPermissions: [
      PERMISSION_CODES.INVENTORY_READ,
      PERMISSION_CODES.INVENTORY_ADJUST,
      PERMISSION_CODES.INVENTORY_ORDER,
    ],
    mode: "ANY",
  },

  // Lottery - Requires lottery permissions
  {
    menuKey: "lottery",
    menuTitle: "Lottery",
    requiredPermissions: [
      PERMISSION_CODES.LOTTERY_PACK_RECEIVE,
      PERMISSION_CODES.LOTTERY_SHIFT_RECONCILE,
      PERMISSION_CODES.LOTTERY_REPORT,
    ],
    mode: "ANY",
  },

  // Employees - Requires employee management permissions
  {
    menuKey: "employees",
    menuTitle: "Employees",
    requiredPermissions: [
      PERMISSION_CODES.CLIENT_EMPLOYEE_READ,
      PERMISSION_CODES.CLIENT_EMPLOYEE_CREATE,
      PERMISSION_CODES.CLIENT_EMPLOYEE_DELETE,
    ],
    mode: "ANY",
  },

  // Cashiers - Requires cashier management permissions
  {
    menuKey: "cashiers",
    menuTitle: "Cashiers",
    requiredPermissions: [
      PERMISSION_CODES.CASHIER_READ,
      PERMISSION_CODES.CASHIER_CREATE,
      PERMISSION_CODES.CASHIER_UPDATE,
      PERMISSION_CODES.CASHIER_DELETE,
    ],
    mode: "ANY",
  },

  // Roles & Permissions - Requires role management permission
  {
    menuKey: "roles",
    menuTitle: "Roles & Permissions",
    requiredPermissions: [PERMISSION_CODES.CLIENT_ROLE_MANAGE],
    mode: "ALL", // Requires explicit role management permission
  },

  // Reports - Requires report permissions
  {
    menuKey: "reports",
    menuTitle: "Reports",
    requiredPermissions: [
      PERMISSION_CODES.REPORT_SHIFT,
      PERMISSION_CODES.REPORT_DAILY,
      PERMISSION_CODES.REPORT_ANALYTICS,
      PERMISSION_CODES.REPORT_EXPORT,
    ],
    mode: "ANY",
  },

  // Configuration - Requires config or lookup table permissions
  {
    menuKey: "config",
    menuTitle: "Configuration",
    requiredPermissions: [
      PERMISSION_CODES.CONFIG_READ,
      PERMISSION_CODES.CONFIG_MANAGE,
      PERMISSION_CODES.TENDER_TYPE_READ,
      PERMISSION_CODES.TENDER_TYPE_MANAGE,
      PERMISSION_CODES.DEPARTMENT_READ,
      PERMISSION_CODES.DEPARTMENT_MANAGE,
      PERMISSION_CODES.TAX_RATE_READ,
      PERMISSION_CODES.TAX_RATE_MANAGE,
    ],
    mode: "ANY", // Show if user can read or manage any config
  },

  // POS Integration - Always visible, requires re-authentication before access
  // Any user can see the link, but must authenticate as someone with POS_SYNC_TRIGGER
  {
    menuKey: "pos_integration",
    menuTitle: "POS Integration",
    requiredPermissions: [], // No permission required for visibility
    alwaysVisible: true, // Link is always visible
    requiresAuth: true, // Flag for sidebar to show auth modal before navigation
  },

  // AI Assistant - Always visible (feature toggle, not permission-based)
  {
    menuKey: "ai",
    menuTitle: "AI Assistant",
    requiredPermissions: [],
    alwaysVisible: true,
  },

  // Settings - Always visible for account management
  {
    menuKey: "settings",
    menuTitle: "Settings",
    requiredPermissions: [],
    alwaysVisible: true,
  },
];

/**
 * Get menu permission configuration by menu key
 * @param menuKey - The menu item key (path segment)
 * @returns The permission configuration or undefined if not found
 */
export function getMenuPermissionConfig(
  menuKey: string,
): MenuPermissionConfig | undefined {
  return CLIENT_MENU_PERMISSIONS.find((config) => config.menuKey === menuKey);
}

/**
 * Extract menu key from href path
 * @param href - Full href path (e.g., "/client-dashboard/shifts")
 * @returns The menu key (e.g., "shifts") or "dashboard" for root
 */
export function extractMenuKeyFromHref(href: string): string {
  // Remove leading slash and split by path segments
  const segments = href.replace(/^\//, "").split("/");

  // For /client-dashboard, return "dashboard"
  if (segments.length === 1 && segments[0] === "client-dashboard") {
    return "dashboard";
  }

  // For /client-dashboard/xxx, return "xxx"
  if (segments.length >= 2 && segments[0] === "client-dashboard") {
    return segments[1];
  }

  // Fallback: return last segment
  return segments[segments.length - 1] || "dashboard";
}

/**
 * Check if user has required permissions for a menu item
 *
 * @param userPermissions - Array of permission codes the user has
 * @param config - Menu permission configuration
 * @returns true if user can access the menu item
 */
export function hasMenuPermission(
  userPermissions: string[],
  config: MenuPermissionConfig,
): boolean {
  // Always visible items bypass permission check
  if (config.alwaysVisible) {
    return true;
  }

  // No required permissions means visible (backward compatibility)
  if (config.requiredPermissions.length === 0) {
    return true;
  }

  const mode = config.mode || "ANY";

  if (mode === "ALL") {
    // User must have ALL required permissions
    return config.requiredPermissions.every((perm) =>
      userPermissions.includes(perm),
    );
  }

  // mode === "ANY": User must have at least one permission
  return config.requiredPermissions.some((perm) =>
    userPermissions.includes(perm),
  );
}

/**
 * Filter menu items based on user permissions
 *
 * @param userPermissions - Array of permission codes the user has
 * @returns Array of menu keys the user can access
 */
export function getAccessibleMenuKeys(userPermissions: string[]): string[] {
  return CLIENT_MENU_PERMISSIONS.filter((config) =>
    hasMenuPermission(userPermissions, config),
  ).map((config) => config.menuKey);
}
