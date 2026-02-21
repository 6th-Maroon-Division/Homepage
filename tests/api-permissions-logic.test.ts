import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessSubslotReadApi,
  canAccessTemplateReadApi,
  isPermissionUpdateEntry,
  validatePermissionUpdateEntries,
} from '@/lib/permission-api-logic';

test('template read access allows admin without other permissions', () => {
  const allowed = canAccessTemplateReadApi({
    isAdmin: true,
    canCreateTemplate: false,
    canEditTemplate: false,
    canDeleteTemplate: false,
    canCreateOrbat: false,
    canEditOrbat: false,
  });

  assert.equal(allowed, true);
});

test('template read access allows template managers', () => {
  assert.equal(
    canAccessTemplateReadApi({
      isAdmin: false,
      canCreateTemplate: true,
      canEditTemplate: false,
      canDeleteTemplate: false,
      canCreateOrbat: false,
      canEditOrbat: false,
    }),
    true
  );

  assert.equal(
    canAccessTemplateReadApi({
      isAdmin: false,
      canCreateTemplate: false,
      canEditTemplate: true,
      canDeleteTemplate: false,
      canCreateOrbat: false,
      canEditOrbat: false,
    }),
    true
  );

  assert.equal(
    canAccessTemplateReadApi({
      isAdmin: false,
      canCreateTemplate: false,
      canEditTemplate: false,
      canDeleteTemplate: true,
      canCreateOrbat: false,
      canEditOrbat: false,
    }),
    true
  );
});

test('template read access allows ORBAT create/edit users in read-only scenarios', () => {
  assert.equal(
    canAccessTemplateReadApi({
      isAdmin: false,
      canCreateTemplate: false,
      canEditTemplate: false,
      canDeleteTemplate: false,
      canCreateOrbat: true,
      canEditOrbat: false,
    }),
    true
  );

  assert.equal(
    canAccessTemplateReadApi({
      isAdmin: false,
      canCreateTemplate: false,
      canEditTemplate: false,
      canDeleteTemplate: false,
      canCreateOrbat: false,
      canEditOrbat: true,
    }),
    true
  );
});

test('template read access denies users with no relevant permissions', () => {
  const allowed = canAccessTemplateReadApi({
    isAdmin: false,
    canCreateTemplate: false,
    canEditTemplate: false,
    canDeleteTemplate: false,
    canCreateOrbat: false,
    canEditOrbat: false,
  });

  assert.equal(allowed, false);
});

test('subslot read access allows explicit subslot permissions', () => {
  const allowed = canAccessSubslotReadApi({
    isAdmin: false,
    canViewSubslot: true,
    canCreateSubslot: false,
    canEditSubslot: false,
    canDeleteSubslot: false,
    canCreateTemplate: false,
    canEditTemplate: false,
    canDeleteTemplate: false,
    canCreateOrbat: false,
    canEditOrbat: false,
  });

  assert.equal(allowed, true);
});

test('subslot read access allows ORBAT/template users in read-only scenarios', () => {
  assert.equal(
    canAccessSubslotReadApi({
      isAdmin: false,
      canViewSubslot: false,
      canCreateSubslot: false,
      canEditSubslot: false,
      canDeleteSubslot: false,
      canCreateTemplate: true,
      canEditTemplate: false,
      canDeleteTemplate: false,
      canCreateOrbat: false,
      canEditOrbat: false,
    }),
    true
  );

  assert.equal(
    canAccessSubslotReadApi({
      isAdmin: false,
      canViewSubslot: false,
      canCreateSubslot: false,
      canEditSubslot: false,
      canDeleteSubslot: false,
      canCreateTemplate: false,
      canEditTemplate: false,
      canDeleteTemplate: false,
      canCreateOrbat: true,
      canEditOrbat: false,
    }),
    true
  );
});

test('subslot read access denies users with no relevant permissions', () => {
  const allowed = canAccessSubslotReadApi({
    isAdmin: false,
    canViewSubslot: false,
    canCreateSubslot: false,
    canEditSubslot: false,
    canDeleteSubslot: false,
    canCreateTemplate: false,
    canEditTemplate: false,
    canDeleteTemplate: false,
    canCreateOrbat: false,
    canEditOrbat: false,
  });

  assert.equal(allowed, false);
});

test('isPermissionUpdateEntry validates shape and types', () => {
  assert.equal(isPermissionUpdateEntry({ permissionId: 1, value: 100 }), true);
  assert.equal(isPermissionUpdateEntry({ permissionId: '1', value: 100 }), false);
  assert.equal(isPermissionUpdateEntry({ permissionId: 1, value: '100' }), false);
  assert.equal(isPermissionUpdateEntry(null), false);
  assert.equal(isPermissionUpdateEntry(undefined), false);
});

test('validatePermissionUpdateEntries accepts valid payloads', () => {
  const result = validatePermissionUpdateEntries([
    { permissionId: 1, value: 0 },
    { permissionId: 2, value: 255 },
  ]);

  assert.deepEqual(result, { valid: true });
});

test('validatePermissionUpdateEntries rejects non-array payload', () => {
  const result = validatePermissionUpdateEntries({ permissionId: 1, value: 1 });

  assert.deepEqual(result, {
    valid: false,
    error: 'Invalid permissions format',
  });
});

test('validatePermissionUpdateEntries rejects malformed entries', () => {
  const result = validatePermissionUpdateEntries([
    { permissionId: 1, value: 100 },
    { permissionId: '2', value: 200 },
  ]);

  assert.deepEqual(result, {
    valid: false,
    error: 'Invalid permission data',
  });
});

test('validatePermissionUpdateEntries rejects out-of-range values', () => {
  const low = validatePermissionUpdateEntries([{ permissionId: 1, value: -1 }]);
  const high = validatePermissionUpdateEntries([{ permissionId: 1, value: 256 }]);

  assert.deepEqual(low, {
    valid: false,
    error: 'Permission value must be between 0 and 255',
  });
  assert.deepEqual(high, {
    valid: false,
    error: 'Permission value must be between 0 and 255',
  });
});

test('validatePermissionUpdateEntries rejects non-integer and NaN values', () => {
  const decimal = validatePermissionUpdateEntries([{ permissionId: 1, value: 0.5 }]);
  const nanValue = validatePermissionUpdateEntries([{ permissionId: 1, value: Number.NaN }]);

  assert.deepEqual(decimal, {
    valid: false,
    error: 'Permission value must be between 0 and 255',
  });
  assert.deepEqual(nanValue, {
    valid: false,
    error: 'Permission value must be between 0 and 255',
  });
});
