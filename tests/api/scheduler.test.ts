import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => {
  const model = () => ({ upsert: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), delete: vi.fn() });
  return { compile: vi.fn(), promote: vi.fn(), remind: vi.fn(), event: vi.fn(), audit: vi.fn(), db: { schedulerState: model(), schedulerJob: model(), orbat: model(), userRank: model(), $queryRaw: vi.fn(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: m.db }));
vi.mock('@/lib/jobs/attendance', () => ({ compileAttendanceInTransaction: m.compile }));
vi.mock('@/lib/jobs/promotions', () => ({ executeAutomaticPromotions: m.promote }));
vi.mock('@/lib/jobs/training-reminders', () => ({ executeTrainingReminders: m.remind }));
vi.mock('@/lib/bot-events', () => ({ appendBotEvent: m.event }));
vi.mock('@/lib/api/audit', () => ({ writeApiAudit: m.audit }));
import { discoverJobs, runNextJob, attendanceDueAt } from '@/lib/scheduler/worker';
const now = new Date('2091-01-01T16:00:00Z');
const op = { id: 4, isMainOp: true, isSideOp: false, startsAtUtc: new Date('2091-01-01T10:00:00Z'), endsAtUtc: new Date('2091-01-01T12:00:00Z') };
const job = { key: 'attendance:4', kind: 'attendance', orbatId: 4, userId: null, expectedRankId: null, completedAt: null, attempts: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.db.$transaction.mockImplementation(async cb => cb(m.db));
  m.db.$queryRaw.mockResolvedValue([{ id: 'scheduler' }]);
  m.db.schedulerState.upsert.mockResolvedValue({ activatedAt: now });
  m.db.schedulerJob.findFirst.mockResolvedValue(job);
  m.db.schedulerJob.findUnique.mockResolvedValue(job);
  m.db.orbat.findUnique.mockResolvedValue(op);
  m.db.orbat.findMany.mockResolvedValue([]);
  m.db.userRank.findMany.mockResolvedValue([]);
  m.compile.mockResolvedValue({ compiledCount: 1 });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test('discovery handles empty and incomplete schedules and preserves retry backoff when deadlines change', async () => {
  expect(attendanceDueAt({})).toBeNull();
  m.db.orbat.findMany.mockResolvedValueOnce([{ ...op, endsAtUtc: null }, op, { ...op, id: 5, endsAtUtc: new Date('2091-01-01T11:00:00Z') }]);
  await discoverJobs();
  expect(m.db.schedulerJob.createMany).toHaveBeenCalledTimes(3); // periodic promotions, reminders and the due operation
  expect(m.db.schedulerJob.updateMany).toHaveBeenCalledTimes(2);
  for (const [args] of m.db.schedulerJob.updateMany.mock.calls) expect(args.data).not.toHaveProperty('nextAttemptAt');
});
test('another worker owning the lock or an empty queue executes no work', async () => {
  m.db.$queryRaw.mockResolvedValueOnce([]);
  expect(await runNextJob()).toBe(false);
  m.db.schedulerJob.findFirst.mockResolvedValueOnce(null);
  expect(await runNextJob()).toBe(false);
  expect(m.compile).not.toHaveBeenCalled();
});
test.each([null, { ...op, isMainOp: false }, { ...op, isSideOp: true }, { ...op, endsAtUtc: null }])('invalid or removed operations cannot finalize: %j', async operation => {
  m.db.orbat.findUnique.mockResolvedValue(operation);
  expect(await runNextJob()).toBe(true);
  expect(m.db.schedulerJob.delete).toHaveBeenCalledWith({ where: { key: job.key } });
  expect(m.compile).not.toHaveBeenCalled();
});
test('end-time extension postpones execution without recording completion', async () => {
  m.db.orbat.findUnique.mockResolvedValue({ ...op, endsAtUtc: now });
  expect(await runNextJob()).toBe(true);
  expect(m.db.schedulerJob.update).toHaveBeenCalledWith({ where: { key: job.key }, data: { dueAt: new Date('2091-01-01T20:00:00Z') } });
  expect(m.compile).not.toHaveBeenCalled();
});
test('finalization records dependent work and uses an internal authorizer', async () => {
  await runNextJob();
  await m.compile.mock.calls[0][3](22);
  expect(m.event).toHaveBeenCalledWith(expect.objectContaining({ type: 'attendance.finalized' }), m.db);
  expect(m.db.schedulerJob.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ key: 'promotions:attendance:4' })] }));
});
test('promotion passes create bounded user work and skip empty rosters', async () => {
  m.db.schedulerJob.findFirst.mockResolvedValue({ ...job, kind: 'promotions' });
  await runNextJob();
  expect(m.db.schedulerJob.createMany).not.toHaveBeenCalled();
  m.db.userRank.findMany.mockResolvedValue([{ userId: 22, currentRankId: 3 }]);
  await runNextJob();
  expect(m.db.schedulerJob.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: [expect.objectContaining({ userId: 22, expectedRankId: 3 })] }));
  m.db.schedulerJob.findFirst.mockResolvedValue({ ...job, kind: 'promotion-user', userId: 22, expectedRankId: 3 });
  await runNextJob();
  expect(await m.promote.mock.calls[0][1].authorize()).toBe(true);
});
test.each([{ kind: 'unexpected' }, { kind: 'attendance', orbatId: null }, { kind: 'promotion-user', userId: null }, { kind: 'promotion-user', userId: 22, expectedRankId: null }])('invalid stored jobs fail safely with durable retry state: %j', async changes => {
  m.db.schedulerJob.findFirst.mockResolvedValue({ ...job, ...changes });
  await expect(runNextJob()).rejects.toThrow('job_failed');
  expect(m.db.schedulerJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { key: job.key, completedAt: null }, data: expect.objectContaining({ lastError: 'job_failed', nextAttemptAt: new Date(now.getTime() + 30000) }) }));
});
test.each([null, { ...job, completedAt: now }])('failure recovery does not alter removed or completed jobs: %j', async stored => {
  m.compile.mockRejectedValue(new Error('Private details'));
  m.db.schedulerJob.findUnique.mockResolvedValue(stored);
  await expect(runNextJob()).rejects.toThrow('job_failed');
  expect(m.db.schedulerJob.updateMany).not.toHaveBeenCalled();
});
test.each([{ code: 'P2034' }, { code: 'private' }, 'private', null])('failure logs retain only safe database codes: %j', async error => {
  m.compile.mockRejectedValue(error);
  await expect(runNextJob()).rejects.toThrow('Scheduler job failed');
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private');
});
test('failure before a claim never alters another job', async () => {
  m.db.$queryRaw.mockRejectedValue(new Error('Unavailable'));
  await expect(runNextJob()).rejects.toThrow('job_failed');
  expect(m.db.schedulerJob.findUnique).not.toHaveBeenCalled();
});
test('reminders use the job transaction and execution clock', async () => {
  m.db.schedulerJob.findFirst.mockResolvedValue({ ...job, kind: 'reminders' });
  await runNextJob();
  expect(m.remind).toHaveBeenCalledWith(m.db, expect.objectContaining({ actorType: 'scheduler' }), now);
});
