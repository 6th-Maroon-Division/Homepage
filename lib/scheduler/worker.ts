import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { compileAttendanceInTransaction } from '@/lib/jobs/attendance';
import { executeTrainingReminders } from '@/lib/jobs/training-reminders';
import { executeAutomaticPromotions } from '@/lib/jobs/promotions';
import { appendBotEvent } from '@/lib/bot-events';
import { writeApiAudit, type ApiAuditContext } from '@/lib/api/audit';

const FOUR_HOURS = 4 * 60 * 60 * 1000;
const SIX_HOURS = 6 * 60 * 60 * 1000;
const STATE_ID = 'scheduler';
export const attendanceJobKey = (id: number) => `attendance:${id}`;
export function promotionSlot(now: Date) { return new Date(Math.floor(now.getTime() / SIX_HOURS) * SIX_HOURS); }
export function attendanceDueAt(orbat: Parameters<typeof resolveOrbatScheduleWindow>[0]) {
  const window = resolveOrbatScheduleWindow(orbat);
  return window.startsAtUtc && window.endsAtUtc ? new Date(window.endsAtUtc.getTime() + FOUR_HOURS) : null;
}
export function retryAt(now: Date, attempts: number) {
  return new Date(now.getTime() + Math.min(3600000, 30000 * 2 ** Math.min(attempts - 1, 7)));
}
async function enqueue(tx: Pick<Prisma.TransactionClient, 'schedulerJob'>, key: string, kind: string, dueAt: Date, orbatId?: number) {
  await tx.schedulerJob.createMany({ data: [{ key, kind, dueAt, orbatId, nextAttemptAt: new Date(0) }], skipDuplicates: true });
}

/** Discovery is repeatable. Completed job keys remain permanent finalization receipts. */
export async function discoverJobs(now = new Date()) {
  const state = await prisma.schedulerState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, activatedAt: now }, update: {} });
  const slot = promotionSlot(now);
  await enqueue(prisma, `promotions:${slot.toISOString()}`, 'promotions', slot);
  const reminderSlot = new Date(Math.floor(now.getTime() / 300000) * 300000);
  await enqueue(prisma, `reminders:${reminderSlot.toISOString()}`, 'reminders', reminderSlot);
  let cursor = 0;
  for (;;) {
    const orbats = await prisma.orbat.findMany({ where: { id: { gt: cursor }, isMainOp: true, isSideOp: false }, orderBy: { id: 'asc' }, take: 100 });
    if (!orbats.length) break;
    for (const orbat of orbats) {
      const dueAt = attendanceDueAt(orbat);
      if (!dueAt) continue;
      const key = attendanceJobKey(orbat.id);
      if (dueAt >= state.activatedAt) await enqueue(prisma, key, 'attendance', dueAt, orbat.id);
      // Preserve retry backoff and permanent completion, even after end-time edits.
      await prisma.schedulerJob.updateMany({ where: { key, completedAt: null, NOT: { dueAt } }, data: { dueAt } });
    }
    cursor = orbats.at(-1)!.id;
  }
}

/** A transaction-held database lock is the claim: crashes release it immediately.
 * Completion, domain writes, dependent jobs and bot events commit together. */
export async function runNextJob(now = new Date()): Promise<boolean> {
  let attemptedKey: string | undefined;
  try {
    const ran = await prisma.$transaction(async tx => {
      const owners = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SchedulerState" WHERE id = ${STATE_ID} FOR UPDATE SKIP LOCKED`;
      if (!owners.length) return false;
      const job = await tx.schedulerJob.findFirst({ where: { completedAt: null, dueAt: { lte: now }, nextAttemptAt: { lte: now } }, orderBy: [{ dueAt: 'asc' }, { key: 'asc' }] });
      if (!job) return false;
      attemptedKey = job.key;
      const audit: ApiAuditContext = { principal: null, actorType: 'scheduler', correlationId: randomUUID(), method: 'JOB', path: `/scheduler/${job.key}` };
      if (job.kind === 'attendance' && job.orbatId !== null) {
        // Serialize finalization against end-time/type edits in the website.
        await tx.$queryRaw`SELECT id FROM "Orbat" WHERE id = ${job.orbatId} FOR UPDATE`;
        const orbat = await tx.orbat.findUnique({ where: { id: job.orbatId } });
        const dueAt = orbat && attendanceDueAt(orbat);
        if (!orbat || !orbat.isMainOp || orbat.isSideOp || !dueAt) {
          // Re-discovery can recreate this job if an operation becomes valid again.
          await tx.schedulerJob.delete({ where: { key: job.key } });
          return true;
        }
        if (dueAt > now) {
          await tx.schedulerJob.update({ where: { key: job.key }, data: { dueAt } });
          return true;
        }
        const result = await compileAttendanceInTransaction(tx, audit, orbat.id, async () => {});
        const window = resolveOrbatScheduleWindow(orbat);
        await appendBotEvent({ type: 'attendance.finalized', aggregate: 'orbat', aggregateId: orbat.id,
          payload: { orbatId: orbat.id, status: 'finalized', startsAt: window.startsAtUtc!.toISOString(), endsAt: window.endsAtUtc!.toISOString(), version: now.toISOString() } }, tx);
        await enqueue(tx, `promotions:attendance:${orbat.id}`, 'promotions', now);
        await writeApiAudit(tx, audit, { action: 'attendance.finalized', resource: 'orbat', resourceId: String(orbat.id), outcome: 'success', after: { compiledCount: result.compiledCount, endsAt: window.endsAtUtc!.toISOString() } });
      } else if (job.kind === 'promotions') {
        // Freeze the candidate rank for this pass. If another trigger/manual action
        // changes it first, the user job skips rather than climbing another rank.
        const candidates = await tx.userRank.findMany({ where: { currentRankId: { not: null }, interviewDone: true, retired: false }, select: { userId: true, currentRankId: true } });
        if (candidates.length) await tx.schedulerJob.createMany({ data: candidates.map(candidate => ({
          key: `${job.key}:user:${candidate.userId}`, kind: 'promotion-user', userId: candidate.userId,
          expectedRankId: candidate.currentRankId!, dueAt: now, nextAttemptAt: new Date(0),
        })), skipDuplicates: true });
      } else if (job.kind === 'promotion-user' && job.userId !== null && job.expectedRankId !== null) {
        await executeAutomaticPromotions(audit, { tx, userFilter: { id: job.userId }, expectedRankId: job.expectedRankId, authorize: async () => true });
      } else if (job.kind === 'reminders') {
        await executeTrainingReminders(tx, audit, now);
      } else {
        throw new Error('Unknown scheduler job kind');
      }
      await tx.schedulerJob.update({ where: { key: job.key }, data: { completedAt: now, attempts: { increment: 1 }, lastError: null } });
      return true;
    }, { isolationLevel: 'Serializable', timeout: 60000, maxWait: 5000 });
    if (ran) console.info(JSON.stringify({ event: 'scheduler.job_committed', key: attemptedKey }));
    return ran;
  } catch (error) {
    // Save only a safe error code; provider/database messages can contain private data.
    const code = error && typeof error === 'object' && 'code' in error && /^P\d{4}$/.test(String(error.code)) ? String(error.code) : 'job_failed';
    if (attemptedKey) {
      await prisma.$transaction(async tx => {
        const job = await tx.schedulerJob.findUnique({ where: { key: attemptedKey! } });
        if (!job || job.completedAt) return;
        await tx.schedulerJob.updateMany({ where: { key: job.key, completedAt: null }, data: { attempts: { increment: 1 }, lastError: code, nextAttemptAt: retryAt(now, job.attempts + 1) } });
      });
    }
    console.error(JSON.stringify({ event: 'scheduler.job_failed', key: attemptedKey, code }));
    throw new Error(`Scheduler job failed (${code})`);
  }
}
