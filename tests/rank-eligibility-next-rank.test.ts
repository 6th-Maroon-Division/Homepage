import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getEligibilityReasonForRankupLane,
  getRequiredAttendanceForRankup,
} from '@/lib/rank-eligibility';

test('required attendance is derived from next rank requirement', () => {
  assert.equal(getRequiredAttendanceForRankup(12), 12);
  assert.equal(getRequiredAttendanceForRankup(0), 0);
  assert.equal(getRequiredAttendanceForRankup(null), 0);
});

test('eligibility lane is derived from next rank auto-rankup setting', () => {
  assert.equal(getEligibilityReasonForRankupLane(true), 'eligible_auto');
  assert.equal(getEligibilityReasonForRankupLane(false), 'eligible_manual');
});
