import assert from 'node:assert/strict';
import test from 'node:test';
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
