import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateOrbatTrainingAccess,
  formatOrbatTrainingAccessError,
  formatOrbatTrainingAccessWarnings,
  type OrbatTrainingRequirement,
  type UserTrainingStatusRecord,
} from '@/lib/orbat-training-access';

const practical: OrbatTrainingRequirement = {
  id: 1,
  name: 'Medic',
  requiresOrbatQualification: true,
};

const theoretical: OrbatTrainingRequirement = {
  id: 2,
  name: 'Basic Combat',
  requiresOrbatQualification: false,
};

function evaluate(
  requirements: OrbatTrainingRequirement[],
  records: UserTrainingStatusRecord[]
) {
  return evaluateOrbatTrainingAccess(requirements, records);
}

test('slots without training requirements are allowed', () => {
  const access = evaluate([], []);

  assert.equal(access.allowed, true);
  assert.equal(access.hasTemporaryAccess, false);
  assert.deepEqual(access.requirements, []);
});

test('qualified training grants permanent ORBAT access', () => {
  const access = evaluate([practical], [{ trainingId: practical.id, status: 'qualified' }]);

  assert.equal(access.allowed, true);
  assert.equal(access.hasTemporaryAccess, false);
  assert.equal(access.requirements[0].access, 'permanent');
});

test('needs_qualify grants temporary ORBAT access', () => {
  const access = evaluate([practical], [
    { trainingId: practical.id, status: 'needs_qualify' },
  ]);

  assert.equal(access.allowed, true);
  assert.equal(access.hasTemporaryAccess, true);
  assert.equal(access.requirements[0].access, 'temporary');
  assert.equal(access.temporaryRequirements[0].name, 'Medic');
});

test('invalid needs_qualify state cannot grant temporary access to a theoretical training', () => {
  const access = evaluate([theoretical], [
    { trainingId: theoretical.id, status: 'needs_qualify' },
  ]);

  assert.equal(access.allowed, false);
  assert.equal(access.hasTemporaryAccess, false);
  assert.equal(access.requirements[0].blockReason, 'training_incomplete');
});

test('finished theoretical-only training grants permanent access', () => {
  const access = evaluate([theoretical], [
    { trainingId: theoretical.id, status: 'finished' },
  ]);

  assert.equal(access.allowed, true);
  assert.equal(access.requirements[0].access, 'permanent');
});

test('finished practical training still requires trainer-controlled qualification access', () => {
  const access = evaluate([practical], [{ trainingId: practical.id, status: 'finished' }]);

  assert.equal(access.allowed, false);
  assert.equal(access.requirements[0].blockReason, 'qualification_required');
  assert.deepEqual(formatOrbatTrainingAccessError(access), {
    code: 'TRAINING_QUALIFICATION_REQUIRED',
    error: 'You need Medic qualification. Contact a trainer.',
  });
});

test('approved and in-training records do not grant ORBAT access', () => {
  for (const status of ['approved', 'in_training'] as const) {
    const access = evaluate([practical], [{ trainingId: practical.id, status }]);

    assert.equal(access.allowed, false);
    assert.equal(access.requirements[0].blockReason, 'training_incomplete');
    assert.equal(formatOrbatTrainingAccessError(access)?.code, 'TRAINING_INCOMPLETE');
  }
});

test('failed and missing records return distinct qualification guidance', () => {
  const failed = evaluate([practical], [{ trainingId: practical.id, status: 'failed' }]);
  const missing = evaluate([practical], []);

  assert.deepEqual(formatOrbatTrainingAccessError(failed), {
    code: 'TRAINING_QUALIFICATION_REQUIRED',
    error: 'You need Medic qualification. Contact a trainer.',
  });
  assert.deepEqual(formatOrbatTrainingAccessError(missing), {
    code: 'TRAINING_NOT_STARTED',
    error: 'This slot requires Medic. Request training first.',
  });
});

test('all required trainings must allow access and temporary access is retained', () => {
  const access = evaluate(
    [practical, theoretical],
    [
      { trainingId: practical.id, status: 'needs_qualify' },
      { trainingId: theoretical.id, status: 'finished' },
    ]
  );

  assert.equal(access.allowed, true);
  assert.equal(access.hasTemporaryAccess, true);
  assert.equal(access.blockedRequirements.length, 0);
});

test('admin move warnings ignore temporary access and describe every blocker category', () => {
  const access = evaluate(
    [
      practical,
      theoretical,
      { id: 3, name: 'Heavy Weapons', requiresOrbatQualification: true },
      { id: 4, name: 'Signals', requiresOrbatQualification: false },
    ],
    [
      { trainingId: practical.id, status: 'needs_qualify' },
      { trainingId: theoretical.id, status: 'failed' },
      { trainingId: 3, status: 'in_training' },
    ]
  );

  assert.deepEqual(formatOrbatTrainingAccessWarnings(access), [
    'User needs qualification for required trainings: Basic Combat',
    'User has not completed required trainings: Heavy Weapons',
    'User is missing required trainings: Signals',
  ]);
});
