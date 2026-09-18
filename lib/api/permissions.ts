import { PERMISSIONS, isValidPermissionValue, type PermissionKey } from '@/lib/permissions';

export type PermissionGrants = Partial<Record<PermissionKey, number>>;

export function parsePermissionGrants(value: unknown): PermissionGrants | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const grants: PermissionGrants = {};
  for (const [key, level] of Object.entries(value)) {
    if (!Object.hasOwn(PERMISSIONS, key) || !isValidPermissionValue(level)) return null;
    grants[key as PermissionKey] = level;
  }
  return grants;
}

export function hasApiPermission(grants: PermissionGrants, permission: PermissionKey): boolean {
  return (grants['system:super_admin'] ?? 0) > 0 || (grants[permission] ?? 0) > 0;
}

export function hasApiHierarchyPermission(actor: PermissionGrants, target: PermissionGrants, permission: PermissionKey): boolean {
  if ((actor['system:super_admin'] ?? 0) > 0) return true;
  if ((target['system:super_admin'] ?? 0) > 0) return false;
  return (actor[permission] ?? 0) > (target[permission] ?? 0);
}
