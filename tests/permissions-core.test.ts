import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERMISSIONS,
  getAllPermissionKeys,
  getPermissionMetadata,
  isValidPermissionKey,
  isValidPermissionValue,
} from '@/lib/permissions';

test('registers exactly 22 permissions', () => {
  const keys = getAllPermissionKeys();
  assert.equal(keys.length, 22);
  assert.equal(new Set(keys).size, 22);
});

test('includes all expected template permissions', () => {
  const keys = getAllPermissionKeys();
  assert.equal(keys.includes('template:create'), true);
  assert.equal(keys.includes('template:edit'), true);
  assert.equal(keys.includes('template:delete'), true);
});

test('permission metadata is available for known keys', () => {
  const metadata = getPermissionMetadata('user:manage_permissions');

  assert.ok(metadata);
  assert.equal(metadata?.defaultValue, 0);
  assert.equal(metadata?.maxValue, 255);
  assert.equal(typeof metadata?.description, 'string');
  assert.equal(metadata?.description.length > 0, true);
});

test('all registered permissions use 0-255 defaults', () => {
  for (const key of getAllPermissionKeys()) {
    const metadata = getPermissionMetadata(key);
    assert.ok(metadata, `missing metadata for ${key}`);
    assert.equal(metadata?.defaultValue, 0);
    assert.equal(metadata?.maxValue, 255);
  }
});

test('isValidPermissionKey accepts known keys and rejects unknown keys', () => {
  assert.equal(isValidPermissionKey('orbat:edit'), true);
  assert.equal(isValidPermissionKey('template:create'), true);
  assert.equal(isValidPermissionKey('not:a:permission'), false);
  assert.equal(isValidPermissionKey(''), false);
});

test('isValidPermissionValue enforces numeric range and type', () => {
  assert.equal(isValidPermissionValue(0), true);
  assert.equal(isValidPermissionValue(1), true);
  assert.equal(isValidPermissionValue(255), true);

  assert.equal(isValidPermissionValue(-1), false);
  assert.equal(isValidPermissionValue(256), false);
  assert.equal(isValidPermissionValue('255'), false);
  assert.equal(isValidPermissionValue(null), false);
  assert.equal(isValidPermissionValue(undefined), false);
  assert.equal(isValidPermissionValue(NaN), false);
  assert.equal(isValidPermissionValue(Infinity), false);
});

test('PERMISSIONS object and getAllPermissionKeys stay in sync', () => {
  const fromObject = Object.keys(PERMISSIONS).sort();
  const fromHelper = getAllPermissionKeys().slice().sort();
  assert.deepEqual(fromHelper, fromObject);
});
