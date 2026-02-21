"use client";

import { useSession } from 'next-auth/react';
import { PermissionKey } from '@/lib/permissions';

/**
 * Hook to check if current user has a specific permission
 * Returns true if permission value > 0
 */
export function usePermission(permission: PermissionKey): boolean {
  const { data: session } = useSession();
  
  if (!session?.user?.permissions) {
    return false;
  }

  const value = session.user.permissions[permission] ?? 0;
  return value > 0;
}

/**
 * Hook to get a user's permission value
 * Returns 0 if permission not found
 */
export function usePermissionValue(permission: PermissionKey): number {
  const { data: session } = useSession();
  
  if (!session?.user?.permissions) {
    return 0;
  }

  return session.user.permissions[permission] ?? 0;
}

/**
 * Hook to check if user can perform an action on another user
 * Returns true if current user's permission value > target user's value
 *
 * Note: For hierarchy checks, target user's permission value must be fetched from API
 */
export function useCanPerformAction(
  permission: PermissionKey,
  targetPermissionValue?: number
): boolean {
  const { data: session } = useSession();
  
  if (!session?.user?.permissions) {
    return false;
  }

  const actorValue = session.user.permissions[permission] ?? 0;
  const targetValue = targetPermissionValue ?? 0;

  // Can perform if has any permission and target value is lower
  return actorValue > targetValue;
}

/**
 * Hook to check if user is admin (has system:admin permission = 255)
 */
export function useIsAdmin(): boolean {
  const adminValue = usePermissionValue('admin:system');
  return adminValue >= 255;
}

/**
 * Hook to get all user permissions as object
 */
export function usePermissions(): Record<string, number> {
  const { data: session } = useSession();
  return session?.user?.permissions ?? {};
}

/**
 * Hook to check multiple permissions (AND logic)
 * Returns true only if user has ALL permissions
 */
export function useAllPermissions(...permissions: PermissionKey[]): boolean {
  const userPerms = usePermissions();
  return permissions.every((perm) => (userPerms[perm] ?? 0) > 0);
}

/**
 * Hook to check multiple permissions (OR logic)
 * Returns true if user has ANY of the permissions
 */
export function useAnyPermission(...permissions: PermissionKey[]): boolean {
  const userPerms = usePermissions();
  return permissions.some((perm) => (userPerms[perm] ?? 0) > 0);
}

/**
 * Hook to check if user is loading session
 */
export function usePermissionLoading(): boolean {
  const { status } = useSession();
  return status === 'loading';
}
