import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { discoverJobs, runNextJob, attendanceJobKey, attendanceDueAt, promotionSlot, retryAt, pruneCompletedJobs } from '@/lib/scheduler/worker';

const start = new Date('2080-01-01T10:00:00Z');
const end = new Date('2080-01-01T12:00:00Z');
const due = new Date('2080-01-01T16:00:00Z');
let userId: number;
async function operation(options: { isMainOp?: boolean; isSideOp?: boolean; startsAtUtc?: Date; endsAtUtc?: Date } = {}) {
  const orbat = await prisma.orbat.create({ data: { name: 'Scheduler test', isMainOp: true, startsAtUtc: start, endsAtUtc: end, ...options,
    squads: { create: { name: 'Scheduler squad', orderIndex: 0 } } }, include: { squads: true } });
  const slot = await prisma.slot.create({ data: { orbatId: orbat.id, squadId: orbat.squads[0].id, orderIndex: 0 } });
  await prisma.signup.create({ data: { slotId: slot.id, userId } });
  return orbat;
}
async function drain(now: Date) { for (let i = 0; i < 500; i++) if (!await runNextJob(now)) return; throw new Error('Queue did not drain'); }
beforeAll(async () => {
  userId = (await prisma.user.create({ data: { username: 'Scheduler member' } })).id;
  await prisma.attendanceEvent.create({ data: { userId, isJoin: true, eventTime: start, processed: true } });
});
beforeEach(async () => {
  await prisma.schedulerJob.deleteMany();
  await prisma.schedulerState.deleteMany();
  await prisma.orbat.deleteMany({ where: { name: 'Scheduler test' } });
});
afterAll(async () => { await prisma.$disconnect(); });

test('only main ops finalize at end plus four hours, atomically emitting one event and dependent promotion job', async () => {
  const main = await operation();
  const side = await operation({ isSideOp: true });
  const other = await operation({ isMainOp: false });
  await discoverJobs(start);
  await drain(new Date(due.getTime() - 1));
  expect(await prisma.attendance.count({ where: { orbatId: main.id } })).toBe(0);
  await discoverJobs(due);
  await drain(due);
  expect(await prisma.attendance.findFirst({ where: { orbatId: main.id } })).toMatchObject({ userId, status: 'present' });
  expect(await prisma.attendance.count({ where: { orbatId: { in: [side.id, other.id] } } })).toBe(0);
  expect(await prisma.schedulerJob.findUnique({ where: { key: attendanceJobKey(main.id) } })).toMatchObject({ completedAt: due, attempts: 1 });
  expect(await prisma.schedulerJob.findUnique({ where: { key: `promotions:attendance:${main.id}` } })).toMatchObject({ completedAt: due });
  expect(await prisma.botEvent.count({ where: { type: 'attendance.finalized', aggregateId: String(main.id) } })).toBe(1);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { action: 'attendance.finalized', resourceId: String(main.id) } });
  expect(audit).toMatchObject({ actorType: 'scheduler', actorUserId: null, actorTokenId: null });
  await prisma.orbat.update({ where: { id: main.id }, data: { endsAtUtc: new Date('2080-01-01T13:00:00Z') } });
  await discoverJobs(new Date('2080-01-02T00:00:00Z'));
  await drain(new Date('2080-01-02T00:00:00Z'));
  expect(await prisma.attendanceLog.count({ where: { attendance: { orbatId: main.id } } })).toBe(1);
  expect(await prisma.botEvent.count({ where: { type: 'attendance.finalized', aggregateId: String(main.id) } })).toBe(1);
});

test('end-time changes move deadlines both ways, including an already due edit; execution rechecks without discovery', async () => {
  const main = await operation();
  await discoverJobs(start);
  await drain(start);
  await prisma.orbat.update({ where: { id: main.id }, data: { endsAtUtc: new Date('2080-01-01T14:00:00Z') } });
  await drain(due);
  expect(await prisma.attendance.count({ where: { orbatId: main.id } })).toBe(0);
  expect((await prisma.schedulerJob.findUniqueOrThrow({ where: { key: attendanceJobKey(main.id) } })).dueAt.toISOString()).toBe('2080-01-01T18:00:00.000Z');
  await prisma.orbat.update({ where: { id: main.id }, data: { endsAtUtc: new Date('2080-01-01T11:00:00Z') } });
  await discoverJobs(due);
  await drain(due);
  expect(await prisma.attendance.count({ where: { orbatId: main.id } })).toBe(1);
});

test('first startup excludes historical deadlines; later downtime catches up and restarts retain completion', async () => {
  const old = await operation({ startsAtUtc: new Date('2079-12-31T10:00:00Z'), endsAtUtc: new Date('2079-12-31T12:00:00Z') });
  const main = await operation();
  await discoverJobs(start);
  expect(await prisma.schedulerJob.findUnique({ where: { key: attendanceJobKey(old.id) } })).toBeNull();
  await discoverJobs(new Date('2080-01-03T18:00:00Z'));
  await drain(new Date('2080-01-03T18:00:00Z'));
  expect(await prisma.attendance.count({ where: { orbatId: main.id } })).toBe(1);
  await discoverJobs(new Date('2080-01-04T18:00:00Z'));
  expect((await prisma.schedulerState.findUniqueOrThrow({ where: { id: 'scheduler' } })).activatedAt).toEqual(start);
  expect(await prisma.attendanceLog.count({ where: { attendance: { orbatId: main.id } } })).toBe(1);
});

test('changed operation types are excluded at execution; missing schedules are not enqueued', async () => {
  const main = await operation();
  const missing = await operation();
  await prisma.orbat.update({ where: { id: missing.id }, data: { endsAtUtc: null } });
  await discoverJobs(start);
  await drain(start);
  await prisma.orbat.update({ where: { id: main.id }, data: { isMainOp: false } });
  await drain(due);
  expect(await prisma.attendance.count({ where: { orbatId: { in: [main.id, missing.id] } } })).toBe(0);
});

test('failed finalization rolls back attendance, outbox and completion; retry backoff survives restart', async () => {
  const main = await operation();
  await discoverJobs(start);
  await drain(start);
  const create = vi.spyOn(prisma, '$transaction');
  const original = prisma.$transaction.bind(prisma);
  create.mockImplementationOnce(((callback: (tx: never) => Promise<unknown>, options: never) => original(async tx => {
    const eventCreate = tx.botEvent.create;
    tx.botEvent.create = (() => { throw new Error('private error'); }) as typeof eventCreate;
    try { return await callback(tx as never); } finally { tx.botEvent.create = eventCreate; }
  }, options)) as unknown as typeof prisma.$transaction);
  await expect(runNextJob(due)).rejects.toThrow('Scheduler job failed');
  create.mockRestore();
  expect(await prisma.attendance.count({ where: { orbatId: main.id } })).toBe(0);
  expect(await prisma.botEvent.count({ where: { type: 'attendance.finalized', aggregateId: String(main.id) } })).toBe(0);
  const job = await prisma.schedulerJob.findUniqueOrThrow({ where: { key: attendanceJobKey(main.id) } });
  expect(job).toMatchObject({ completedAt: null, attempts: 1, lastError: 'job_failed', nextAttemptAt: new Date(due.getTime() + 30000) });
  await discoverJobs(due);
  expect((await prisma.schedulerJob.findUniqueOrThrow({ where: { key: job.key } })).nextAttemptAt).toEqual(job.nextAttemptAt);
  await drain(job.nextAttemptAt);
  expect(await prisma.attendance.count({ where: { orbatId: main.id } })).toBe(1);
});

test('six-hour checks apply a real promotion and durable bot event once per job', async () => {
  const low = await prisma.rank.create({ data: { name: 'Scheduler low', abbreviation: 'SLOW', orderIndex: 9000000 } });
  const high = await prisma.rank.create({ data: { name: 'Scheduler high', abbreviation: 'SHIGH', orderIndex: 9000001, autoRankupEnabled: true, attendanceRequiredSinceLastRank: 1 } });
  const main = await operation();
  await prisma.attendance.create({ data: { orbatId: main.id, userId, status: 'present' } });
  await prisma.userRank.create({ data: { userId, currentRankId: low.id, interviewDone: true } });
  await discoverJobs(start);
  await drain(start);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId } })).currentRankId).toBe(high.id);
  expect(await prisma.rankHistory.count({ where: { userId } })).toBe(1);
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId } });
  expect(await prisma.botEvent.findFirst({ where: { type: 'user.rank_changed', aggregateId: String(history.id) } })).toMatchObject({ payload: expect.objectContaining({ source: 'automatic', newRankId: high.id }) });
  await discoverJobs(start);
  await drain(start);
  expect(await prisma.rankHistory.count({ where: { userId } })).toBe(1);
});

test('UTC slots and overnight schedules have stable boundaries and capped backoff', () => {
  expect(promotionSlot(new Date('2080-03-31T07:59:59+02:00')).toISOString()).toBe('2080-03-31T00:00:00.000Z');
  expect(promotionSlot(new Date('2080-03-31T08:00:00+02:00')).toISOString()).toBe('2080-03-31T06:00:00.000Z');
  expect(attendanceDueAt({ eventDate: start, startTime: '22:00', endTime: '01:00' })?.toISOString()).toBe('2080-01-02T05:00:00.000Z');
  expect(retryAt(start, 50).getTime() - start.getTime()).toBe(3600000);
});

test('scheduled reminders persist inbox and bot event once across subsequent checks', async () => {
  const training = await prisma.training.create({ data: { name: 'Scheduler reminder training' } });
  const session = await prisma.trainingSession.create({ data: { trainingId: training.id, startsAt: new Date(start.getTime() + 3600000), status: 'scheduled' } });
  const attendee = await prisma.trainingSessionAttendee.create({ data: { sessionId: session.id, userId } });
  await discoverJobs(start);
  await drain(start);
  expect((await prisma.trainingSessionAttendee.findUniqueOrThrow({ where: { id: attendee.id } })).reminder24hSentAt).toEqual(start);
  expect(await prisma.botEvent.count({ where: { type: 'training.reminder_due', aggregateId: String(session.id) } })).toBe(1);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { resource: 'training_reminder', resourceId: String(attendee.id) } });
  expect(audit.actorType).toBe('scheduler');
  await discoverJobs(new Date(start.getTime() + 300000));
  await drain(new Date(start.getTime() + 300000));
  expect(await prisma.botEvent.count({ where: { type: 'training.reminder_due', aggregateId: String(session.id) } })).toBe(1);
});

test('promotion jobs skip a rank changed by another action rather than advancing twice', async () => {
  const current = await prisma.userRank.findUniqueOrThrow({ where: { userId } });
  const next = await prisma.rank.create({ data: { name: 'Scheduler extra', abbreviation: 'SEXTRA', orderIndex: 9000002, autoRankupEnabled: true, attendanceRequiredSinceLastRank: 0 } });
  await discoverJobs(start);
  await prisma.schedulerJob.deleteMany();
  const previous = await prisma.rank.findUniqueOrThrow({ where: { name: 'Scheduler low' } });
  await prisma.schedulerJob.create({ data: { key: 'stale-user-job', kind: 'promotion-user', userId, expectedRankId: previous.id, dueAt: start, nextAttemptAt: start } });
  await drain(start);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId } })).currentRankId).toBe(current.currentRankId);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId } })).currentRankId).not.toBe(next.id);
});

test('standalone npm entrypoint runs against the isolated database without a website server', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'scripts/scheduler.ts', '--once'], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test' }, timeout: 20000,
  });
  expect(result.stdout).toContain('scheduler.job_committed');
  expect(await prisma.schedulerState.count()).toBe(1);
});

test('retention bounds periodic history without removing receipts, pending work or recent jobs', async () => {
  const old = new Date('2079-01-01T00:00:00Z');
  const data = Array.from({ length: 501 }, (_, i) => ({ key: `retention-old:${i}`, kind: ['promotions', 'promotion-user', 'reminders'][i % 3], dueAt: old, nextAttemptAt: old, completedAt: old }));
  await prisma.schedulerJob.createMany({ data: [
    ...data,
    { key: 'retention-receipt', kind: 'attendance', dueAt: old, nextAttemptAt: old, completedAt: old },
    { key: 'retention-pending', kind: 'reminders', dueAt: old, nextAttemptAt: old, completedAt: null },
    { key: 'retention-recent', kind: 'reminders', dueAt: start, nextAttemptAt: start, completedAt: start },
    { key: 'retention-future', kind: 'reminders', dueAt: new Date('2081-01-01'), nextAttemptAt: old, completedAt: old },
  ] });
  await pruneCompletedJobs(start);
  expect(await prisma.schedulerJob.count({ where: { key: { startsWith: 'retention-old:' } } })).toBe(1);
  await pruneCompletedJobs(start);
  expect((await prisma.schedulerJob.findMany({ orderBy: { key: 'asc' }, select: { key: true } })).map(row => row.key)).toEqual(['retention-future', 'retention-pending', 'retention-receipt', 'retention-recent']);
});

test('discovery leaves unchanged and finalized operations unwritten and permanent receipts survive retention', async () => {
  const main = await operation();
  await discoverJobs(start);
  const update = vi.spyOn(prisma.schedulerJob, 'updateMany');
  const insert = vi.spyOn(prisma.schedulerJob, 'createMany');
  try {
    await discoverJobs(start);
    expect(update).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(2); // Only the periodic slot upserts.
    await drain(due);
    update.mockClear(); insert.mockClear();
    const later = new Date('2080-03-01T16:00:00Z');
    await discoverJobs(later);
    expect(update).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(2);
    await drain(later);
    expect((await prisma.schedulerJob.findUniqueOrThrow({ where: { key: attendanceJobKey(main.id) } })).completedAt).toEqual(due);
    expect(await prisma.attendanceLog.count({ where: { attendance: { orbatId: main.id } } })).toBe(1);
  } finally { update.mockRestore(); insert.mockRestore(); }
});
