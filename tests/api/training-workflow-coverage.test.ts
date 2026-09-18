import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  getAllowedTrainingTransitions,
  requestStatusToUserTrainingStatus,
  validateTrainingTransition,
} from '@/lib/training-workflow';

test('pending requests remain the first workflow step', () => {
  assert.deepEqual(
    getAllowedTrainingTransitions('pending', {
      requiresTrainingSession: true,
      requiresOrbatQualification: false,
    }),
    ['approved', 'rejected', 'cancelled'],
  );
});

test('theoretical training follows approval, session, and finish', () => {
  const configuration = {
    requiresTrainingSession: true,
    requiresOrbatQualification: false,
  };

  assert.deepEqual(validateTrainingTransition('approved', 'in_training', configuration), { valid: true });
  assert.deepEqual(validateTrainingTransition('in_training', 'finished', configuration), { valid: true });
  assert.equal(validateTrainingTransition('in_training', 'needs_qualify', configuration).valid, false);
});

test('practical training must enter needs_qualify after its session', () => {
  const configuration = {
    requiresTrainingSession: true,
    requiresOrbatQualification: true,
  };

  assert.equal(validateTrainingTransition('in_training', 'finished', configuration).valid, false);
  assert.deepEqual(validateTrainingTransition('in_training', 'needs_qualify', configuration), { valid: true });
  assert.deepEqual(validateTrainingTransition('needs_qualify', 'qualified', configuration), { valid: true });
});

test('trainers can reopen qualification without an attempt limit', () => {
  const configuration = {
    requiresTrainingSession: true,
    requiresOrbatQualification: true,
  };

  assert.deepEqual(validateTrainingTransition('failed', 'needs_qualify', configuration), { valid: true });
  assert.deepEqual(validateTrainingTransition('qualified', 'needs_qualify', configuration), { valid: true });
});

test('only workflow states with a credential map to UserTraining', () => {
  assert.equal(requestStatusToUserTrainingStatus('pending'), null);
  assert.equal(requestStatusToUserTrainingStatus('rejected'), null);
  assert.equal(requestStatusToUserTrainingStatus('approved'), 'approved');
  assert.equal(requestStatusToUserTrainingStatus('completed'), 'qualified');
});

test('approval and completion honor theoretical and practical requirements', async () => {
  const { isFullTrainingCompletion, isTrainingRequestStatus, isUserTrainingStatus } = await import('@/lib/training-workflow');
  const none = { requiresTrainingSession: false, requiresOrbatQualification: false };
  const practical = { requiresTrainingSession: false, requiresOrbatQualification: true };
  assert.deepEqual(getAllowedTrainingTransitions('approved', none), ['finished', 'qualified', 'failed']);
  assert.deepEqual(getAllowedTrainingTransitions('approved', practical), ['needs_qualify', 'failed']);
  assert.deepEqual(validateTrainingTransition('approved', 'approved', none), { valid: true });
  assert.equal(validateTrainingTransition('completed', 'approved', none).valid, false);
  assert.equal(validateTrainingTransition('pending', 'finished', none).valid, false);
  for (const candidate of [null, 1, {}, 'invalid']) {
    assert.equal(isTrainingRequestStatus(candidate), false);
    assert.equal(isUserTrainingStatus(candidate), false);
  }
  assert.equal(isTrainingRequestStatus('pending'), true);
  assert.equal(isUserTrainingStatus('qualified'), true);
  assert.equal(isFullTrainingCompletion('qualified', practical), true);
  assert.equal(isFullTrainingCompletion('finished', practical), false);
  assert.equal(isFullTrainingCompletion('finished', none), true);
  assert.equal(isFullTrainingCompletion('approved', none), false);
});
