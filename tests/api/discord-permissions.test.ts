import { expect, test } from 'vitest';
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import { hasApiPermission, parsePermissionGrants } from '@/lib/api/permissions';

const discordKeys = [
  'discord:view', 'discord:configure', 'discord:announce', 'discord:retry',
  'discord:moderation_view', 'discord:timeout_release', 'discord:evidence_view',
  'discord:evidence_delete', 'discord:evidence_restore', 'discord:evidence_retention',
] as const satisfies readonly PermissionKey[];

test.each(discordKeys)('%s denies absent/zero grants and accepts explicit delegation', key => {
  expect(PERMISSIONS[key].defaultValue).toBe(0);
  expect(PERMISSIONS[key].maxValue).toBe(255);
  expect(hasApiPermission({}, key)).toBe(false);
  expect(hasApiPermission({ [key]: 0, 'system:super_admin': 0 }, key)).toBe(false);
  for (const value of [1, 255]) {
    const grants = parsePermissionGrants({ [key]: value });
    expect(grants).toEqual({ [key]: value });
    expect(hasApiPermission(grants!, key)).toBe(true);
  }
  expect(parsePermissionGrants({ [key]: 256 })).toBeNull();
});

test.each(discordKeys)('superadmin overrides an explicit zero for %s', key => {
  expect(hasApiPermission({ [key]: 0, 'system:super_admin': 1 }, key)).toBe(true);
  expect(hasApiPermission({ 'system:super_admin': 255 }, key)).toBe(true);
});

test('Discord permissions remain independent and cannot confer delegation authority', () => {
  for (const granted of discordKeys) {
    for (const requested of discordKeys) {
      expect(hasApiPermission({ [granted]: 255 }, requested)).toBe(granted === requested);
    }
    expect(hasApiPermission({ [granted]: 255 }, 'user:manage_permissions')).toBe(false);
    expect(hasApiPermission({ [granted]: 255 }, 'system:super_admin')).toBe(false);
  }
});
