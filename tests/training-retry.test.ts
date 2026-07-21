import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRetryFailedTraining,
  getFailedTrainingRetryAt,
} from '../lib/training-retry';

test('failed training can be requested again after one hour', () => {
  const failedAt = new Date('2026-07-21T10:00:00.000Z');
  assert.equal(
    canRetryFailedTraining(failedAt, failedAt, new Date('2026-07-21T10:59:59.999Z')),
    false,
  );
  assert.equal(
    canRetryFailedTraining(failedAt, failedAt, new Date('2026-07-21T11:00:00.000Z')),
    true,
  );
});

test('failed retry falls back to status update time for legacy records', () => {
  const statusUpdatedAt = new Date('2026-07-21T10:00:00.000Z');
  assert.equal(
    getFailedTrainingRetryAt(null, statusUpdatedAt).toISOString(),
    '2026-07-21T11:00:00.000Z',
  );
});
