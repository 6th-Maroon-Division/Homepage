/**
 * Permission system using 0-255 unsigned integer hierarchy
 * Higher value = more permissions
 * User can perform action if: actorValue > targetValue
 */

export const PERMISSIONS = {
  // User management permissions
  "user:edit": {
    description: "Edit user details",
    defaultValue: 0,
    maxValue: 255,
  },
  "user:promote": {
    description: "Promote users to higher ranks",
    defaultValue: 0,
    maxValue: 255,
  },
  "user:manage": {
    description: "Full user management",
    defaultValue: 0,
    maxValue: 255,
  },
  "user:manage_permissions": {
    description: "Manage user permissions (grant/revoke)",
    defaultValue: 0,
    maxValue: 255,
  },

  // Training permissions
  "training:create": {
    description: "Create new trainings",
    defaultValue: 0,
    maxValue: 255,
  },
  "training:edit": {
    description: "Edit trainings",
    defaultValue: 0,
    maxValue: 255,
  },
  "training:delete": {
    description: "Delete trainings",
    defaultValue: 0,
    maxValue: 255,
  },
  "training:mark": {
    description: "Mark trainings as completed for users",
    defaultValue: 0,
    maxValue: 255,
  },
  "training:approve_request": {
    description: "Approve training requests",
    defaultValue: 0,
    maxValue: 255,
  },

  // ORBAT permissions
  "orbat:create": {
    description: "Create ORBATs",
    defaultValue: 0,
    maxValue: 255,
  },
  "orbat:edit": {
    description: "Edit ORBATs",
    defaultValue: 0,
    maxValue: 255,
  },
  "orbat:delete": {
    description: "Delete ORBATs",
    defaultValue: 0,
    maxValue: 255,
  },

  // Template permissions
  "template:create": {
    description: "Create ORBAT templates",
    defaultValue: 0,
    maxValue: 255,
  },
  "template:edit": {
    description: "Edit ORBAT templates",
    defaultValue: 0,
    maxValue: 255,
  },
  "template:delete": {
    description: "Delete ORBAT templates",
    defaultValue: 0,
    maxValue: 255,
  },

  // Subslot definition permissions
  "subslot:view": {
    description: "View reusable ORBAT subslot definitions",
    defaultValue: 0,
    maxValue: 255,
  },
  "subslot:create": {
    description: "Create reusable ORBAT subslot definitions",
    defaultValue: 0,
    maxValue: 255,
  },
  "subslot:edit": {
    description: "Edit reusable ORBAT subslot definitions",
    defaultValue: 0,
    maxValue: 255,
  },
  "subslot:delete": {
    description: "Delete reusable ORBAT subslot definitions",
    defaultValue: 0,
    maxValue: 255,
  },

  // Attendance permissions
  "attendance:edit": {
    description: "Edit attendance records",
    defaultValue: 0,
    maxValue: 255,
  },
  "attendance:view": {
    description: "View detailed attendance data",
    defaultValue: 0,
    maxValue: 255,
  },

  // Rank permissions
  "rank:create": {
    description: "Create ranks",
    defaultValue: 0,
    maxValue: 255,
  },
  "rank:edit": {
    description: "Edit ranks",
    defaultValue: 0,
    maxValue: 255,
  },
  "rank:delete": {
    description: "Delete ranks",
    defaultValue: 0,
    maxValue: 255,
  },
  "rank:manage_promotions": {
    description: "Handle promotion proposals and auto-rankup settings",
    defaultValue: 0,
    maxValue: 255,
  },

  // Admin permissions
  "system:super_admin": {
    description: "Global super admin override across all admin features",
    defaultValue: 0,
    maxValue: 255,
  },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export interface PermissionValue {
  description: string;
  defaultValue: number;
  maxValue: number;
}

/**
 * Get all permission keys
 */
export function getAllPermissionKeys(): PermissionKey[] {
  return Object.keys(PERMISSIONS) as PermissionKey[];
}

/**
 * Get permission metadata
 */
export function getPermissionMetadata(
  key: PermissionKey
): PermissionValue | undefined {
  return PERMISSIONS[key];
}

/**
 * Validate permission key exists
 */
export function isValidPermissionKey(key: string): key is PermissionKey {
  return key in PERMISSIONS;
}

/**
 * Validate permission value (0-255)
 */
export function isValidPermissionValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 255
  );
}
