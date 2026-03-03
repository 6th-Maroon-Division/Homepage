import { isValidPermissionValue } from '@/lib/permissions';

export interface TemplateReadAccessContext {
  hasSuperAdmin: boolean;
  canCreateTemplate: boolean;
  canEditTemplate: boolean;
  canDeleteTemplate: boolean;
  canCreateOrbat: boolean;
  canEditOrbat: boolean;
}

export function canAccessTemplateReadApi(context: TemplateReadAccessContext): boolean {
  const canManageTemplates =
    context.canCreateTemplate || context.canEditTemplate || context.canDeleteTemplate;

  return context.hasSuperAdmin || canManageTemplates || context.canCreateOrbat || context.canEditOrbat;
}

export interface SubslotReadAccessContext {
  hasSuperAdmin: boolean;
  canViewSubslot: boolean;
  canCreateSubslot: boolean;
  canEditSubslot: boolean;
  canDeleteSubslot: boolean;
  canCreateTemplate: boolean;
  canEditTemplate: boolean;
  canDeleteTemplate: boolean;
  canCreateOrbat: boolean;
  canEditOrbat: boolean;
}

export function canAccessSubslotReadApi(context: SubslotReadAccessContext): boolean {
  const canManageSubslots =
    context.canCreateSubslot || context.canEditSubslot || context.canDeleteSubslot;

  const canManageTemplates =
    context.canCreateTemplate || context.canEditTemplate || context.canDeleteTemplate;

  return (
    context.hasSuperAdmin ||
    context.canViewSubslot ||
    canManageSubslots ||
    canManageTemplates ||
    context.canCreateOrbat ||
    context.canEditOrbat
  );
}

export interface PermissionUpdateEntry {
  permissionId: number;
  value: number;
}

export function isPermissionUpdateEntry(value: unknown): value is PermissionUpdateEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return typeof entry.permissionId === 'number' && typeof entry.value === 'number';
}

export function validatePermissionUpdateEntries(
  permissions: unknown
): { valid: true } | { valid: false; error: string } {
  if (!Array.isArray(permissions)) {
    return { valid: false, error: 'Invalid permissions format' };
  }

  for (const entry of permissions) {
    if (!isPermissionUpdateEntry(entry)) {
      return { valid: false, error: 'Invalid permission data' };
    }

    if (!isValidPermissionValue(entry.value)) {
      return { valid: false, error: 'Permission value must be between 0 and 255' };
    }
  }

  return { valid: true };
}
