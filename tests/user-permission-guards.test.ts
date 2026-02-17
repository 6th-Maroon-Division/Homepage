import assert from 'node:assert/strict';
import test from 'node:test';
import { canModifyUserPermissions } from '@/lib/user-permission-guards';

test('prevents users from modifying their own permissions', () => {
  const actorUserId = 42;
  const targetUserId = 42;

  const result = canModifyUserPermissions(actorUserId, targetUserId);

  assert.equal(result, false);
});

test('allows users to modify another user permissions', () => {
  const actorUserId = 42;
  const targetUserId = 99;

  const result = canModifyUserPermissions(actorUserId, targetUserId);

  assert.equal(result, true);
});
