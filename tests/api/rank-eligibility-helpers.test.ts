import { beforeEach, expect, test, vi } from 'vitest';
const db = vi.hoisted(() => { const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() }); return { userRank: model(), rank: model(), rankTransitionRequirement: model(), userTraining: model(), promotionProposal: model(), attendance: model(), legacyAttendanceData: model(), legacyUserData: model() }; });
vi.mock('@/lib/prisma', () => ({ prisma: db }));
import { checkRankupEligibility, getCurrentAttendance, getTotalAttendanceWithLegacy } from '@/lib/rank-eligibility';
const currentRank = { id: 1, name: 'Recruit', abbreviation: 'Rct', orderIndex: 0, autoRankupEnabled: false, attendanceRequiredSinceLastRank: null };
const nextRank = { id: 2, name: 'Private', abbreviation: 'Pvt', orderIndex: 1, autoRankupEnabled: false, attendanceRequiredSinceLastRank: 2 };
beforeEach(() => {
  vi.resetAllMocks();
  db.userRank.findUnique.mockResolvedValue({ currentRank, interviewDone: true, retired: false, attendanceSinceLastRank: 2 });
  db.rank.findFirst.mockResolvedValue(nextRank); db.attendance.count.mockResolvedValue(3); db.legacyAttendanceData.count.mockResolvedValue(1); db.legacyUserData.findMany.mockResolvedValue([{ oldData: 2 }]);
  db.rankTransitionRequirement.findUnique.mockResolvedValue(null); db.promotionProposal.findFirst.mockResolvedValue(null);
});

test('attendance totals count live operations and applied legacy history', async () => {
  expect(await getCurrentAttendance(7)).toBe(6); expect(await getTotalAttendanceWithLegacy(7)).toBe(6);
  expect(db.attendance.count.mock.calls[0][0].where).toEqual({ userId: 7, orbat: { isMainOp: true }, status: { in: ['present', 'late', 'gone_early', 'partial'] } });
  expect(db.attendance.count.mock.calls[1][0].where).toEqual({ userId: 7 });
});

test.each([null, { currentRank: null }])('unranked users have no eligibility %#', async state => {
  db.userRank.findUnique.mockResolvedValue(state);
  expect(await checkRankupEligibility(7)).toMatchObject({ eligible: false, reason: 'ineligible_no_current_rank', currentRank: null, nextRank: null });
  expect(db.attendance.count).not.toHaveBeenCalled();
});

test.each([['retired', true, 'ineligible_retired'], ['interviewDone', false, 'ineligible_interview']] as const)('profile prerequisite %s blocks promotion', async (key, value, reason) => {
  db.userRank.findUnique.mockResolvedValue({ currentRank, retired: false, interviewDone: true, attendanceSinceLastRank: 2, [key]: value });
  expect(await checkRankupEligibility(7)).toMatchObject({ eligible: false, reason, currentRank, nextRank: null });
});

test('highest rank cannot promote and unmet attendance exposes the required delta', async () => {
  db.rank.findFirst.mockResolvedValueOnce(null);
  expect(await checkRankupEligibility(7)).toMatchObject({ reason: 'ineligible_no_next_rank', nextRank: null });
  db.rank.findFirst.mockResolvedValue({ ...nextRank, attendanceRequiredSinceLastRank: 5 });
  expect(await checkRankupEligibility(7)).toMatchObject({ reason: 'ineligible_attendance', attendance: { currentAttendance: 6, attendanceSinceLastRank: 2, delta: 4, requiredAttendance: 5 } });
});

test('training completion requires qualification only for trainings configured to require it', async () => {
  db.rankTransitionRequirement.findUnique.mockResolvedValue({ requiredTrainings: [{ id: 10 }, { id: 11 }, { id: 12 }, { id: 13 }] });
  db.userTraining.findMany.mockResolvedValue([
    { trainingId: 10, status: 'qualified', training: { requiresOrbatQualification: true } },
    { trainingId: 11, status: 'finished', training: { requiresOrbatQualification: false } },
    { trainingId: 12, status: 'finished', training: { requiresOrbatQualification: true } },
    { trainingId: 13, status: 'in_progress', training: { requiresOrbatQualification: false } },
  ]);
  expect(await checkRankupEligibility(7)).toMatchObject({ eligible: false, reason: 'ineligible_training', missingTrainingIds: [12, 13] });
  db.rankTransitionRequirement.findUnique.mockResolvedValue({ requiredTrainings: [{ id: 10 }, { id: 11 }] });
  db.promotionProposal.findFirst.mockResolvedValue({ id: 42 });
  expect(await checkRankupEligibility(7)).toMatchObject({ eligible: true, reason: 'eligible_manual', missingTrainingIds: [], proposalId: 42 });
});

test('automatic lane permits null attendance requirement and empty training requirement', async () => {
  db.rank.findFirst.mockResolvedValue({ ...nextRank, attendanceRequiredSinceLastRank: null, autoRankupEnabled: true });
  db.rankTransitionRequirement.findUnique.mockResolvedValue({ requiredTrainings: [] });
  expect(await checkRankupEligibility(7)).toMatchObject({ eligible: true, reason: 'eligible_auto', attendance: { requiredAttendance: 0 }, proposalId: null });
});
