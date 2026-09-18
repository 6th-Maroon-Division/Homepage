import { prisma } from '@/lib/prisma';
import type { ApiPrincipal } from './principal';
import { writeApiAudit, type ApiAuditContext } from './audit';
import { readJsonBody } from './request';
import { apiSuccess } from './response';
import { isDateOnly } from './utc';
import { rejectAttendance as fail, requireAttendanceUser } from './attendance';

const statuses = ['P', 'A', 'NA', 'LOA', 'NO', 'EO'] as const;
type ImportRecord = { username: string; date: string; status: typeof statuses[number] };
export function parseAttendanceImport(value: unknown): ImportRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'records')) fail(422, 'Expected only records.');
  const records = (value as { records?: unknown }).records;
  if (!Array.isArray(records) || records.length < 1 || records.length > 100) fail(422, 'records must contain between 1 and 100 rows.');
  const seen = new Set<string>();
  return records.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['username', 'date', 'status'].includes(key))) fail(422, 'Invalid import row.');
    const { username, date, status } = row as Record<string, unknown>;
    if (typeof username !== 'string' || !username.trim() || typeof date !== 'string' || !isDateOnly(date) || typeof status !== 'string' || !statuses.includes(status as ImportRecord['status'])) fail(422, 'Each row requires username, a valid UTC date (YYYY-MM-DD), and a supported status.');
    if (seen.has(username.trim())) fail(422, 'A user may occur only once per import.');
    seen.add(username.trim());
    return { username: username.trim(), date, status: status as ImportRecord['status'] };
  });
}
export async function importAttendance(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, orbatId: number) {
  if (new URL(request.url).searchParams.size) fail(400, 'Query arguments are not supported.');
  const records = parseAttendanceImport(await readJsonBody(request));
  const data = await prisma.$transaction(async tx => {
    const operation = await tx.orbat.findUnique({ where: { id: orbatId }, select: { isSideOp: true, startsAtUtc: true, eventDate: true } });
    if (!operation) fail(404, 'Operation not found.');
    if (operation.isSideOp) fail(409, 'Attendance is disabled for side operations.');
    const eventDate = operation.startsAtUtc ?? operation.eventDate;
    if (!eventDate) fail(409, 'Operation has no event date.');
    const date = eventDate.toISOString().slice(0, 10);
    const pending: { userId: number; signupId: number; oldStatus: string; status: 'present' | 'absent' }[] = [];
    for (const row of records) {
      if (row.date !== date) fail(422, 'Every row must match the operation’s UTC event date.');
      if (row.status === 'NO' || row.status === 'EO') continue;
      const users = await tx.user.findMany({ where: { username: row.username }, select: { id: true }, take: 2 });
      if (!users.length) fail(404, 'An import user was not found.');
      if (users.length !== 1) fail(409, 'An import username is ambiguous.');
      const userId = users[0].id;
      await requireAttendanceUser(tx, principal, userId, 'attendance:edit');
      const signup = await tx.signup.findFirst({ where: { userId, slot: { orbatId } }, select: { id: true }, orderBy: { id: 'asc' } });
      if (!signup) fail(404, 'An import user has no signup for this operation.');
      if (await tx.attendance.findFirst({ where: { userId, orbatId }, select: { id: true } })) fail(409, 'Attendance already exists for an import user.');
      pending.push({ userId, signupId: signup.id, oldStatus: row.status, status: row.status === 'P' ? 'present' : 'absent' });
    }
    for (const row of pending) {
      const attendance = await tx.attendance.create({ data: { userId: row.userId, signupId: row.signupId, orbatId, status: row.status, minutesLate: 0, minutesGoneEarly: 0, totalMinutesMissed: 0, totalMinutesPresent: 0, notes: `Imported from legacy system - original status: ${row.oldStatus}` }, select: { id: true } });
      await tx.attendanceLog.create({ data: { attendanceId: attendance.id, action: 'imported', source: 'legacy_import', changedById: principal.kind === 'user' ? principal.userId : null, previousValue: {}, newValue: { oldStatus: row.oldStatus, mappedStatus: row.status } } });
      await writeApiAudit(tx, audit, { action: 'attendance.imported', resource: 'attendance', resourceId: String(attendance.id), targetUserIds: [row.userId], outcome: 'success', before: {}, after: { id: attendance.id, userId: row.userId, signupId: row.signupId, orbatId, status: row.status, originalStatus: row.oldStatus } });
    }
    return { imported: pending.length, skipped: records.length - pending.length, total: records.length };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
  return apiSuccess(data);
}
