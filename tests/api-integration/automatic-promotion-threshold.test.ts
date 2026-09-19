import { afterAll, beforeEach, expect, test } from 'vitest';
import { prisma } from '@/lib/prisma';
import { checkRankupEligibility } from '@/lib/rank-eligibility';
import { discoverJobs, runNextJob } from '@/lib/scheduler/worker';

const start = new Date('2090-06-01T10:00:00Z');
const end = new Date('2090-06-01T12:00:00Z');
const finalizedAt = new Date('2090-06-01T16:00:00Z');
let sequence = 0;

beforeEach(async () => {
  await prisma.schedulerJob.deleteMany();
  await prisma.schedulerState.deleteMany();
});
afterAll(async () => { await prisma.$disconnect(); });

async function fixture({ total = 3, baseline = 0, automatic = true, retired = false, interviewDone = true } = {}) {
  const label = `Threshold ${++sequence}`;
  // Other suites include Int32 boundary ranks; reserve a free consecutive range.
  let order = 1000000000 + sequence * 10;
  while (await prisma.rank.count({ where: { orderIndex: { gte: order, lte: order + 2 } } })) order += 10;
  // The source flag deliberately differs: promotion settings belong to the destination rank.
  const low = await prisma.rank.create({ data: { name: `${label} low`, abbreviation: `TL${sequence}`, orderIndex: order, autoRankupEnabled: !automatic } });
  const high = await prisma.rank.create({ data: { name: `${label} high`, abbreviation: `TH${sequence}`, orderIndex: order + 1, autoRankupEnabled: automatic, attendanceRequiredSinceLastRank: 3 } });
  await prisma.rank.create({ data: { name: `${label} manual ceiling`, abbreviation: `TC${sequence}`, orderIndex: order + 2, autoRankupEnabled: false } });
  const user = await prisma.user.create({ data: { username: label, userRank: { create: { currentRankId: low.id, attendanceSinceLastRank: baseline, retired, interviewDone } } } });
  for (let i = 0; i < total; i++) {
    await prisma.orbat.create({ data: { name: `${label} attendance ${i}`, isMainOp: true, attendances: { create: { userId: user.id, status: 'present' } } } });
  }
  return { user, low, high };
}

async function tick(now: Date) {
  await discoverJobs(now);
  for (let i = 0; i < 500; i++) if (!await runNextJob(now)) return;
  throw new Error('Scheduler queue failed to drain');
}

async function promotionCount(userId: number) {
  return prisma.rankHistory.count({ where: { userId, triggeredBy: 'auto', outcome: 'approved' } });
}

test('main-op finalization crosses the exact attendance-since-last-rank threshold and automatically promotes once', async () => {
  const { user, low, high } = await fixture({ total: 7, baseline: 5 });
  // Neither non-main attendance nor a main-op no-show contributes to the threshold.
  await prisma.orbat.create({ data: { name: 'Threshold side operation', isSideOp: true, attendances: { create: { userId: user.id, status: 'present' } } } });
  await prisma.orbat.create({ data: { name: 'Threshold no-show', isMainOp: true, attendances: { create: { userId: user.id, status: 'no_show' } } } });
  const op = await prisma.orbat.create({ data: { name: 'Threshold final operation', isMainOp: true, startsAtUtc: start, endsAtUtc: end, squads: { create: { name: 'Alpha', orderIndex: 0 } } }, include: { squads: true } });
  const slot = await prisma.slot.create({ data: { orbatId: op.id, squadId: op.squads[0].id, orderIndex: 0 } });
  await prisma.signup.create({ data: { userId: user.id, slotId: slot.id } });
  await prisma.attendanceEvent.createMany({ data: [
    { userId: user.id, isJoin: true, eventTime: start, processed: true },
    { userId: user.id, isJoin: false, eventTime: end, processed: true },
  ] });
  expect(await checkRankupEligibility(user.id)).toMatchObject({ eligible: false, reason: 'ineligible_attendance', attendance: { currentAttendance: 7, attendanceSinceLastRank: 5, delta: 2, requiredAttendance: 3 } });
  await tick(start);
  await tick(new Date(finalizedAt.getTime() - 1));
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(low.id);
  expect(await promotionCount(user.id)).toBe(0);

  await tick(finalizedAt);
  expect(await prisma.attendance.findFirst({ where: { orbatId: op.id, userId: user.id } })).toMatchObject({ status: 'present', totalMinutesPresent: 120 });
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: user.id } })).toMatchObject({ currentRankId: high.id, attendanceSinceLastRank: 8 });
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId: user.id } });
  expect(history).toMatchObject({ previousRankName: low.name, newRankName: high.name, attendanceTotalAtChange: 8, attendanceDeltaSinceLastRank: 3, triggeredBy: 'auto', outcome: 'approved' });
  expect(await prisma.botEvent.count({ where: { type: 'user.rank_changed', aggregateId: String(history.id) } })).toBe(1);
  expect(await prisma.messageRecipient.count({ where: { userId: user.id, message: { type: 'rankup' } } })).toBe(1);
  await tick(finalizedAt);
  await tick(new Date('2090-06-01T18:00:00Z'));
  expect(await promotionCount(user.id)).toBe(1);
});

test.each([3, 4])('periodic check promotes with %i qualifying attendances against a requirement of 3', async total => {
  const { user, high } = await fixture({ total });
  expect(await checkRankupEligibility(user.id)).toMatchObject({ eligible: true, reason: 'eligible_auto' });
  await tick(start);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(high.id);
  expect(await promotionCount(user.id)).toBe(1);
});

test('destination rank automatic setting controls promotion, and enabling it is picked up by the next six-hour check', async () => {
  const { user, low, high } = await fixture({ automatic: false });
  expect(await checkRankupEligibility(user.id)).toMatchObject({ eligible: true, reason: 'eligible_manual' });
  await tick(start);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(low.id);
  expect(await promotionCount(user.id)).toBe(0);
  await prisma.rank.update({ where: { id: high.id }, data: { autoRankupEnabled: true } });
  await tick(new Date('2090-06-01T12:00:00Z'));
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(high.id);
  expect(await promotionCount(user.id)).toBe(1);
});

test.each([
  { retired: true, interviewDone: true, reason: 'ineligible_retired' },
  { retired: false, interviewDone: false, reason: 'ineligible_interview' },
])('attendance does not bypass $reason', async ({ retired, interviewDone, reason }) => {
  const { user, low } = await fixture({ retired, interviewDone });
  expect(await checkRankupEligibility(user.id)).toMatchObject({ eligible: false, reason });
  await tick(start);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(low.id);
  expect(await promotionCount(user.id)).toBe(0);
});

test('required training still blocks an attendance-qualified user until completed', async () => {
  const { user, low, high } = await fixture();
  const training = await prisma.training.create({ data: { name: 'Threshold required training' } });
  await prisma.rankTransitionRequirement.create({ data: { targetRankId: high.id, requiredTrainings: { connect: { id: training.id } } } });
  expect(await checkRankupEligibility(user.id)).toMatchObject({ eligible: false, reason: 'ineligible_training' });
  await tick(start);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(low.id);
  await prisma.userTraining.create({ data: { userId: user.id, trainingId: training.id, status: 'qualified' } });
  await tick(new Date('2090-06-01T12:00:00Z'));
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: user.id } })).currentRankId).toBe(high.id);
  expect(await promotionCount(user.id)).toBe(1);
});
