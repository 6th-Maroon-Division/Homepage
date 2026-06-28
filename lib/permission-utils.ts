import { prisma } from "./prisma";
import { PermissionKey, isValidPermissionKey } from "./permissions";

/**
 * Get a user's permission value for a specific permission
 * Returns 0 (no permission) if user doesn't have the permission set
 */
export async function getUserPermissionValue(
  userId: number,
  permissionKey: PermissionKey
): Promise<number> {
  // Find permission by key first
  const permission = await prisma.permission.findUnique({
    where: { key: permissionKey },
  });

  if (!permission) {
    return 0; // Permission doesn't exist yet
  }

  const perm = await prisma.userPermission.findUnique({
    where: {
      userId_permissionId: {
        userId,
        permissionId: permission.id,
      },
    },
  });

  return perm?.value ?? 0;
}

/**
 * Get all permissions for a user
 */
export async function getUserPermissions(
  userId: number
): Promise<Record<string, number>> {
  const userPermissions = await prisma.userPermission.findMany({
    where: { userId },
    include: { permission: true },
  });

  const result: Record<string, number> = {};
  for (const up of userPermissions) {
    result[up.permission.key] = up.value;
  }
  return result;
}

/**
 * Check if actor can perform an action on target
 * Hierarchy check: actor's permission value must be GREATER than target's
 *
 * Example: Can User A edit User B?
 * - Only if: A's "user:edit" value > B's "user:edit" value
 */
export async function canPerformAction(
  actorId: number,
  targetId: number,
  permissionKey: PermissionKey
): Promise<boolean> {
  // If same user, allow
  if (actorId === targetId) {
    return true;
  }

  // Get actor's permission value
  const actorValue = await getUserPermissionValue(actorId, permissionKey);

  // If actor has no permission, deny
  if (actorValue === 0) {
    return false;
  }

  // Get target's permission value for hierarchy comparison
  const targetValue = await getUserPermissionValue(targetId, permissionKey);

  // Actor must have higher value than target
  return actorValue > targetValue;
}

/**
 * Check if user simply has a permission (no hierarchy involved)
 * Just checks if value > 0
 */
export async function hasPermission(
  userId: number,
  permissionKey: PermissionKey
): Promise<boolean> {
  const value = await getUserPermissionValue(userId, permissionKey);
  return value > 0;
}

/**
 * Check if user is full admin (system:super_admin >= 255)
 */
export async function isFullAdmin(userId: number): Promise<boolean> {
  const value = await getUserPermissionValue(userId, "system:super_admin");
  return value >= 255;
}

/**
 * Set a user's permission to a specific value (0-255)
 */
export async function setUserPermission(
  userId: number,
  permissionKey: PermissionKey,
  value: number
): Promise<void> {
  if (value < 0 || value > 255) {
    throw new Error("Permission value must be between 0 and 255");
  }

  if (!isValidPermissionKey(permissionKey)) {
    throw new Error(`Invalid permission key: ${permissionKey}`);
  }

  // Get or create permission
  const permission = await prisma.permission.findUnique({
    where: { key: permissionKey },
  });

  if (!permission) {
    throw new Error(`Permission ${permissionKey} not found in database`);
  }

  // Upsert user permission
  if (value === 0) {
    // Delete if setting to 0
    await prisma.userPermission.deleteMany({
      where: {
        userId,
        permissionId: permission.id,
      },
    });
  } else {
    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId,
          permissionId: permission.id,
        },
      },
      update: { value },
      create: {
        userId,
        permissionId: permission.id,
        value,
      },
    });
  }
}

/**
 * Set multiple permissions for a user at once
 */
export async function setUserPermissions(
  userId: number,
  permissions: Record<PermissionKey, number>
): Promise<void> {
  const results = await Promise.allSettled(
    Object.entries(permissions).map(([key, value]) =>
      setUserPermission(userId, key as PermissionKey, value)
    )
  );

  const errors = results.filter((r) => r.status === "rejected");
  if (errors.length > 0) {
    throw new Error(
      `Failed to set some permissions: ${errors.map((e) => (e as PromiseRejectedResult).reason).join(", ")}`
    );
  }
}

/**
 * Grant a permission to a user (if they don't have it)
 * Sets to a default value like 50 (mid-range)
 */
export async function grantPermission(
  userId: number,
  permissionKey: PermissionKey,
  value: number = 50
): Promise<void> {
  const current = await getUserPermissionValue(userId, permissionKey);
  if (current === 0) {
    await setUserPermission(userId, permissionKey, value);
  }
}

/**
 * Revoke a permission from a user (set to 0)
 */
export async function revokePermission(
  userId: number,
  permissionKey: PermissionKey
): Promise<void> {
  await setUserPermission(userId, permissionKey, 0);
}

/**
 * Resolve user IDs that currently have super-admin access.
 */
export async function getSuperAdminUserIds(): Promise<number[]> {
  const entries = await prisma.userPermission.findMany({
    where: {
      value: { gt: 0 },
      permission: { key: 'system:super_admin' },
    },
    select: { userId: true },
  });

  return entries.map((entry) => entry.userId);
}
