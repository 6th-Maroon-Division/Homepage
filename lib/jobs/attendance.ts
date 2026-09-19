import type { Prisma } from '@/generated/prisma/client';
import { writeApiAudit, type ApiAuditContext } from '@/lib/api/audit';
import { calculateAttendanceStatus } from '@/lib/attendance';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { buildAttendanceNoteFlags } from '@/lib/attendance-note-flags';
export class CompilationError extends Error { constructor(public status: number, message: string) { super(message); } }
function compilationError(status: number, message: string): never { throw new CompilationError(status, message); }
function metrics(row: { id: number; userId: number; orbatId: number; status: string; totalMinutesPresent: number; minutesLate: number; minutesGoneEarly: number; totalMinutesMissed: number }) { return { id: row.id, userId: row.userId, orbatId: row.orbatId, status: row.status, totalMinutesPresent: row.totalMinutesPresent, minutesLate: row.minutesLate, minutesGoneEarly: row.minutesGoneEarly, totalMinutesMissed: row.totalMinutesMissed }; }
/** Preserve the raw-event compiler's original clamping and start-only semantics. */
export function compileEventMetrics(events: { isJoin: boolean; eventTime: Date }[], start: Date, end: Date) {
  const ordered = [...events].sort((a, b) => a.eventTime.getTime() - b.eventTime.getTime());
  const joins = ordered.filter(event => event.isJoin).map(event => event.eventTime); const leaves = ordered.filter(event => !event.isJoin).map(event => event.eventTime);
  let totalMinutesPresent = 0; let minutesLate = 0; let minutesGoneEarly = 0;
  if (joins.length && !leaves.length) totalMinutesPresent = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
  else if (joins.length) {
    let checkedInAt: Date | null = null;
    for (const event of ordered) {
      if (event.isJoin && !checkedInAt) checkedInAt = event.eventTime;
      else if (!event.isJoin && checkedInAt) { totalMinutesPresent += Math.max(0, Math.floor((Math.min(event.eventTime.getTime(), end.getTime()) - Math.max(checkedInAt.getTime(), start.getTime())) / 60000)); checkedInAt = null; }
    }
    if (checkedInAt) totalMinutesPresent += Math.max(0, Math.floor((end.getTime() - Math.max(checkedInAt.getTime(), start.getTime())) / 60000));
    if (joins[0] > start) minutesLate = Math.min(60, Math.ceil((joins[0].getTime() - start.getTime()) / 60000));
    if (leaves.at(-1)! < end) minutesGoneEarly = Math.min(60, Math.ceil((end.getTime() - leaves.at(-1)!.getTime()) / 60000));
  }
  const totalMinutesMissed = minutesLate + minutesGoneEarly;
  return { totalMinutesPresent, minutesLate, minutesGoneEarly, totalMinutesMissed, status: joins.length ? calculateAttendanceStatus(true, minutesLate, minutesGoneEarly, totalMinutesMissed) : 'no_show' as const, joinCount: joins.length, leaveCount: leaves.length };
}
export async function compileAttendanceInTransaction(tx: Prisma.TransactionClient, audit: ApiAuditContext, orbatId: number, authorize: (userId: number) => Promise<void>) {
  const orbat = await tx.orbat.findUnique({ where: { id: orbatId } }); if (!orbat) compilationError(404, 'Operation not found.'); if (orbat.isSideOp) compilationError(409, 'Attendance compilation is disabled for side operations.');
  const { startsAtUtc: start, endsAtUtc: end } = resolveOrbatScheduleWindow(orbat); if (!start || !end) compilationError(422, 'Operation start and end are required for compilation.');
  const signups = await tx.signup.findMany({ where: { slot: { orbatId } }, select: { id: true, userId: true }, orderBy: { id: 'asc' } });
  for (const signup of signups) await authorize(signup.userId);
  const events = await tx.attendanceEvent.findMany({ where: { eventTime: { gte: new Date(start.getTime() - 21600000), lte: new Date(end.getTime() + 21600000) } }, orderBy: [{ eventTime: 'asc' }, { id: 'asc' }] });
  const notes = await tx.orbatAttendanceNote.findMany({ where: { orbatId }, select: { userId: true, status: true, lateMinutes: true, leaveEarlyMinutes: true } });
  const attendance = [];
  for (const signup of signups) {
    const { joinCount, leaveCount, ...computed } = compileEventMetrics(events.filter(event => event.userId === signup.userId), start, end);
    const flags = buildAttendanceNoteFlags(notes.find(note => note.userId === signup.userId) ?? null);
    const existing = await tx.attendance.findFirst({ where: { orbatId, userId: signup.userId }, orderBy: { id: 'asc' } });
    const saved = existing ? await tx.attendance.update({ where: { id: existing.id }, data: { ...computed, ...flags, signupId: signup.id } }) : await tx.attendance.create({ data: { orbatId, userId: signup.userId, signupId: signup.id, ...computed, ...flags } });
    await tx.attendanceLog.create({ data: { attendanceId: saved.id, action: 'compiled', source: 'automation', changedById: audit.principal?.kind === 'user' ? audit.principal.userId : null } });
    await writeApiAudit(tx, audit, { action: 'attendance.compiled', resource: 'attendance', resourceId: String(saved.id), targetUserIds: [signup.userId], outcome: 'success', before: existing ? metrics(existing) : {}, after: metrics(saved) });
    attendance.push({ ...metrics(saved), ...flags, joinCount, leaveCount });
  }
  return { orbatId, compiledAt: new Date().toISOString(), compiledCount: attendance.length, totalEventsProcessed: events.length, attendance };
}
