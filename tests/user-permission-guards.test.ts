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

test('prevents self-modification for id 0', () => {
  const actorUserId = 0;
  const targetUserId = 0;

  const result = canModifyUserPermissions(actorUserId, targetUserId);

  assert.equal(result, false);
});

test('allows modification when ids differ by sign', () => {
  const actorUserId = -1;
  const targetUserId = 1;

  const result = canModifyUserPermissions(actorUserId, targetUserId);

  assert.equal(result, true);
});

test('is symmetric for distinct users', () => {
  const forward = canModifyUserPermissions(10, 20);
  const reverse = canModifyUserPermissions(20, 10);

  assert.equal(forward, true);
  assert.equal(reverse, true);
});

test('regression matrix for self/non-self combinations', () => {
  const cases = [
    { actor: 1, target: 1, expected: false },
    { actor: 1, target: 2, expected: true },
    { actor: 255, target: 255, expected: false },
    { actor: 255, target: 1, expected: true },
    { actor: Number.MAX_SAFE_INTEGER, target: Number.MAX_SAFE_INTEGER, expected: false },
    { actor: Number.MAX_SAFE_INTEGER, target: Number.MAX_SAFE_INTEGER - 1, expected: true },
  ];

  for (const testCase of cases) {
    const result = canModifyUserPermissions(testCase.actor, testCase.target);
    assert.equal(
      result,
      testCase.expected,
      `actor=${testCase.actor}, target=${testCase.target}`
    );
  }
});
