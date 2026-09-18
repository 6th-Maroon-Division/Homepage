import type { Prisma } from '@/generated/prisma/client';
import type { PermissionKey } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { handleApiRequest, handlePublicApiRequest } from './handler';
import { apiError, apiSuccess } from './response';
import { canAccessApiUser } from './auth';
import type { ApiPrincipal } from './principal';
import { writeApiAudit, type ApiAuditContext } from './audit';
import { readJsonBody } from './request';
import { parsePositiveId, parseCursorPagination } from './validation';
import { isDateOnly, parseUtcTimestamp } from './utc';
import { buildAttendanceNoteFlags } from '@/lib/attendance-note-flags';
import { calculateAttendanceStatus, calculateTimeDifferencesByWindow } from '@/lib/attendance';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import type { AttendanceStatus } from '@/generated/prisma/client';
class Failure { constructor(readonly response: Response) {} }
function fail(status: number, message: string): never { throw new Failure(apiError(status, status === 400 ? 'invalid_request' : status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 409 ? 'conflict' : 'validation_failed', message)); }
export function attendanceId(value: unknown): number { const id = parsePositiveId(value); if (id === null || id > 2147483647) fail(400, 'A positive 32-bit ID is required.'); return id; }
function errorResponse(error: unknown): Response {
  if (error instanceof Failure) return error.response;
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2025') return apiError(404, 'not_found', 'Attendance resource not found.');
    if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return apiError(409, 'conflict', 'Attendance changed concurrently. Reload and retry.');
  }
  throw error;
}
export function attendanceRoute(request: Request, permission: PermissionKey | undefined, callback: (principal: ApiPrincipal, audit: ApiAuditContext) => Promise<Response>) {
  return handleApiRequest(request, permission, async (principal, audit) => { try { return await callback(principal, audit); } catch (error) { return errorResponse(error); } });
}
export function publicAttendanceRoute(request: Request, callback: (principal: ApiPrincipal | null, audit: ApiAuditContext) => Promise<Response>) {
  return handlePublicApiRequest(request, async (principal, audit) => { try { return await callback(principal, audit); } catch (error) { return errorResponse(error); } });
}
function query(request: Request, allowed: string[]) { const params = new URL(request.url).searchParams; for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) fail(400, 'Invalid or repeated query argument.'); return params; }
async function access(db: Prisma.TransactionClient, principal: ApiPrincipal, userId: number, permission: 'attendance:view' | 'attendance:edit') {
  if (!await canAccessApiUser(principal, userId, permission, db)) fail(403, 'Cannot access this user’s attendance.');
  if (!await db.user.findUnique({ where: { id: userId }, select: { id: true } })) fail(404, 'User not found.');
}
const userSelect = { id: true, username: true } as const;
const projection = { user: { select: userSelect }, orbat: { select: { id: true, name: true, startsAtUtc: true, eventDate: true, isSideOp: true } }, signup: { select: { id: true, slotId: true, user: { select: userSelect }, slot: { select: { id: true, squadRole: { select: { name: true } } } } } }, sessions: { orderBy: { checkedInAt: 'asc' }, select: { id: true, userId: true, attendanceId: true, checkedInAt: true, checkedOutAt: true, durationMinutes: true, sessionDate: true, timestamp: true } }, logs: { orderBy: { timestamp: 'desc' }, select: { id: true, action: true, source: true, timestamp: true, changedBy: { select: userSelect } } } } as const;
type Row = Prisma.AttendanceGetPayload<{ include: typeof projection }>;
function dto(row: Row) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), orbat: { id: row.orbat.id, name: row.orbat.name, startsAtUtc: row.orbat.startsAtUtc?.toISOString() ?? null, eventDate: row.orbat.eventDate?.toISOString() ?? null }, signup: row.signup ? { ...row.signup, slot: { id: row.signup.slot.id, name: row.signup.slot.squadRole?.name ?? 'Unassigned Role' } } : null, sessions: row.sessions.map(session => ({ ...session, checkedInAt: session.checkedInAt.toISOString(), checkedOutAt: session.checkedOutAt?.toISOString() ?? null, sessionDate: session.sessionDate.toISOString(), timestamp: session.timestamp.toISOString() })), logs: row.logs.map(log => ({ ...log, timestamp: log.timestamp.toISOString() })) };
}
function snapshot(row: Row) { return { id: row.id, userId: row.userId, signupId: row.signupId, orbatId: row.orbatId, status: row.status, notes: row.notes === null ? null : '[REDACTED]', minutesLate: row.minutesLate, minutesGoneEarly: row.minutesGoneEarly, totalMinutesMissed: row.totalMinutesMissed, totalMinutesPresent: row.totalMinutesPresent, notedAbsent: row.notedAbsent, notedUnsure: row.notedUnsure, notedLateEarly: row.notedLateEarly, sessionIds: row.sessions.map(session => session.id), logIds: row.logs.map(log => log.id) }; }
async function auditRead(audit: ApiAuditContext, principal: ApiPrincipal, resourceId: string, rows: Row[], explicitUserId?: number) {
  const users = [...new Set([...(explicitUserId === undefined ? [] : [explicitUserId]), ...rows.flatMap(row => [row.userId, ...row.logs.flatMap(log => log.changedBy ? [log.changedBy.id] : [])])])].filter(id => principal.kind === 'bot' || principal.userId !== id);
  if (users.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'attendance', resourceId, targetUserIds: users, outcome: 'success' });
}
export async function getAttendance(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, id: number) {
  query(request, []);
  const row = await prisma.attendance.findUnique({ where: { id }, include: projection });
  if (!row) fail(404, 'Attendance not found.');
  await access(prisma, principal, row.userId, 'attendance:view');
  await auditRead(audit, principal, String(id), [row]);
  return apiSuccess(dto(row));
}
export async function listAttendance(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, scope: { orbatId: number }) {
  const params = query(request, ['date', 'userId', 'cursor', 'limit']);
  const parsed = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 }); if (parsed.error !== undefined) fail(400, parsed.error);
  const { cursor, limit } = parsed.data;
  let userId: number | undefined;
  const where: Prisma.AttendanceWhereInput = { orbatId: scope.orbatId, ...(cursor ? { id: { lt: cursor } } : {}) };
  const orbat = await prisma.orbat.findUnique({ where: { id: scope.orbatId }, select: { isSideOp: true } });
  if (!orbat) fail(404, 'Operation not found.'); if (orbat.isSideOp) fail(409, 'Attendance is disabled for side operations.');
  if (params.has('userId')) { userId = attendanceId(params.get('userId')); await access(prisma, principal, userId, 'attendance:view'); where.userId = userId; }
  if (params.has('date')) { const date = params.get('date'); if (!isDateOnly(date)) fail(400, 'date must be a valid UTC calendar date.'); const start = new Date(`${date}T00:00:00Z`); where.createdAt = { gte: start, lt: new Date(start.getTime() + 86400000) }; }
  const rows = await prisma.attendance.findMany({ where, include: projection, orderBy: { id: 'desc' }, take: limit + 1 });
  const data = rows.slice(0, limit); await auditRead(audit, principal, String(scope.orbatId), data, userId);
  return apiSuccess(data.map(dto), { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
}
async function publicTarget(principal: ApiPrincipal | null, targetId: string) {
  const userId = targetId === 'me' ? principal?.kind === 'user' ? principal.userId : fail(400, 'me requires a valid user session.') : attendanceId(targetId);
  if (!await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) fail(404, 'User not found.');
  return userId;
}
async function publicReadAudit(principal: ApiPrincipal | null, audit: ApiAuditContext, userId: number) {
  if (principal?.kind !== 'user' || principal.userId !== userId) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'user_attendance', resourceId: String(userId), targetUserIds: [userId], outcome: 'success' });
}
export async function publicAttendance(request: Request, principal: ApiPrincipal | null, audit: ApiAuditContext, targetId: string) {
  const params = query(request, ['days', 'cursor', 'limit']); const days = parseDays(params);
  const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 }); if (pagination.error !== undefined) fail(400, pagination.error);
  const { cursor, limit } = pagination.data; const userId = await publicTarget(principal, targetId);
  const rows = await prisma.attendance.findMany({ where: { userId, createdAt: { gte: new Date(Date.now() - days * 86400000) }, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: limit + 1, select: { id: true, userId: true, orbatId: true, status: true, minutesLate: true, minutesGoneEarly: true, totalMinutesMissed: true, totalMinutesPresent: true, createdAt: true, updatedAt: true, orbat: { select: { id: true, name: true, eventDate: true, startsAtUtc: true } } } });
  await publicReadAudit(principal, audit, userId);
  return apiSuccess(rows.slice(0, limit).map(row => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), orbat: { ...row.orbat, eventDate: row.orbat.eventDate?.toISOString() ?? null, startsAtUtc: row.orbat.startsAtUtc?.toISOString() ?? null } })), { meta: { limit, nextCursor: rows.length > limit ? String(rows[limit - 1].id) : null } });
}
function parseDays(params: URLSearchParams) { const days = params.has('days') ? parsePositiveId(params.get('days')) : 30; if (days === null || days > 3650) fail(400, 'days must be an integer between 1 and 3650.'); return days; }
export async function attendanceStats(request: Request, principal: ApiPrincipal | null, audit: ApiAuditContext, targetId: string) {
  const params = query(request, ['days']); const days = parseDays(params);
  const userId = await publicTarget(principal, targetId);
  const rows = await prisma.attendance.findMany({ where: { userId, createdAt: { gte: new Date(Date.now() - days * 86400000) } }, select: { status: true, minutesLate: true, minutesGoneEarly: true, totalMinutesMissed: true } });
  const count = (status: AttendanceStatus) => rows.filter(row => row.status === status).length;
  const totalEvents = rows.length; const arrivedLateCount = rows.filter(row => row.minutesLate > 0).length; const leftEarlyCount = rows.filter(row => row.minutesGoneEarly > 0).length; const periodMonths = Math.max(1, Math.ceil(days / 30));
  const data = { totalEvents, presentCount: count('present'), lateCount: count('late'), goneEarlyCount: count('gone_early'), arrivedLateCount, leftEarlyCount, partialCount: count('partial'), absentCount: count('absent'), noShowCount: count('no_show'), attendancePercentage: totalEvents ? Math.round((count('present') + count('late') + count('gone_early') + count('partial')) / totalEvents * 100) : 0, avgMinutesMissed: totalEvents ? Math.round(rows.reduce((sum, row) => sum + row.totalMinutesMissed, 0) / totalEvents) : 0, avgArrivedLatePerMonth: Number((arrivedLateCount / periodMonths).toFixed(2)), avgLeftEarlyPerMonth: Number((leftEarlyCount / periodMonths).toFixed(2)) };
  await publicReadAudit(principal, audit, userId); return apiSuccess(data);
}
type Input = { signupId?: number | null; userId?: number | null; status?: AttendanceStatus; notes?: string | null; checkinTime?: Date | null; checkoutTime?: Date | null };
async function payload(request: Request, create: boolean): Promise<Input> {
  const body: unknown = await readJsonBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) fail(422, 'A nonempty attendance object is required.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !(create ? ['signupId', 'userId', 'status', 'notes', 'checkinTime', 'checkoutTime'] : ['signupId', 'userId', 'status', 'notes']).includes(key))) fail(422, 'Unknown attendance field.');
  for (const key of ['signupId', 'userId']) if (input[key] !== undefined && input[key] !== null && (typeof input[key] !== 'number' || !Number.isInteger(input[key]) || (input[key] as number) < 1 || (input[key] as number) > 2147483647)) fail(422, 'IDs must be positive numeric 32-bit integers or null.');
  if (input.status !== undefined && !['present', 'absent', 'late', 'gone_early', 'partial', 'no_show'].includes(input.status as string)) fail(422, 'Invalid attendance status.');
  if (input.notes !== undefined && input.notes !== null && typeof input.notes !== 'string') fail(422, 'notes must be text or null.');
  const parsed: Input = { ...(input as Input), ...(typeof input.notes === 'string' ? { notes: input.notes.trim() || null } : {}) };
  for (const key of ['checkinTime', 'checkoutTime'] as const) if (input[key] !== undefined) { parsed[key] = input[key] === null ? null : parseUtcTimestamp(input[key]); if (input[key] !== null && !parsed[key]) fail(422, 'Check-in/out timestamps require explicit UTC offsets.'); }
  if (parsed.checkoutTime && (!parsed.checkinTime || parsed.checkoutTime <= parsed.checkinTime)) fail(422, 'Checkout must follow checkin.');
  if (create && !parsed.signupId && !parsed.userId) fail(422, 'signupId or userId is required.');
  return parsed;
}
export async function mutateAttendance(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, method: 'POST' | 'PATCH' | 'DELETE', id: number) {
  query(request, []); const body = method === 'DELETE' ? null : await payload(request, method === 'POST');
  const result = await prisma.$transaction(async tx => {
    const existing = method === 'POST' ? null : await tx.attendance.findUnique({ where: { id }, include: projection });
    if (method !== 'POST' && !existing) fail(404, 'Attendance not found.');
    if (existing) await access(tx, principal, existing.userId, 'attendance:edit');
    const orbatId = existing?.orbatId ?? id;
    const orbat = await tx.orbat.findUnique({ where: { id: orbatId } }); if (!orbat) fail(404, 'Operation not found.');
    if (method !== 'DELETE' && orbat.isSideOp) fail(409, 'Attendance is disabled for side operations.');
    if (method === 'DELETE') {
      await tx.attendance.delete({ where: { id } });
      await writeApiAudit(tx, audit, { action: 'attendance.deleted', resource: 'attendance', resourceId: String(id), targetUserIds: [existing!.userId], outcome: 'success', before: snapshot(existing!), after: { deleted: true } });
      return null;
    }
    const signupId = body!.signupId === undefined ? existing?.signupId ?? null : body!.signupId;
    const signup = signupId ? await tx.signup.findUnique({ where: { id: signupId }, select: { id: true, userId: true, slot: { select: { orbatId: true } } } }) : null;
    if (signupId && (!signup || signup.slot.orbatId !== orbatId)) fail(404, 'Signup does not belong to this operation.');
    if (signup && body!.userId && body!.userId !== signup.userId) fail(422, 'signupId and userId must identify the same user.');
    const userId = signup?.userId ?? body!.userId ?? existing?.userId; if (!userId) fail(422, 'A user must be selected.');
    await access(tx, principal, userId, 'attendance:edit');
    const duplicate = await tx.attendance.findFirst({ where: { orbatId, userId, ...(existing ? { id: { not: existing.id } } : {}) }, select: { id: true } }); if (duplicate) fail(409, 'Attendance already exists for this user and operation.');
    const note = await tx.orbatAttendanceNote.findUnique({ where: { orbatId_userId: { orbatId, userId } }, select: { status: true, lateMinutes: true, leaveEarlyMinutes: true } });
    const flags = buildAttendanceNoteFlags(note);
    const data = { userId, signupId, ...flags, ...(body!.status !== undefined ? { status: body!.status } : {}), ...(body!.notes !== undefined ? { notes: body!.notes } : {}) };
    const saved = existing ? await tx.attendance.update({ where: { id }, data }) : await tx.attendance.create({ data: { ...data, orbatId, status: body!.status ?? 'absent' } });
    if (existing && existing.userId !== userId) await tx.attendanceSession.updateMany({ where: { attendanceId: id }, data: { userId } });
    if (body!.checkinTime) {
      const checkin = body!.checkinTime; const checkout = body!.checkoutTime ?? null; const durationMinutes = checkout ? Math.ceil((checkout.getTime() - checkin.getTime()) / 60000) : null;
      await tx.attendanceSession.create({ data: { attendanceId: saved.id, userId, checkedInAt: checkin, checkedOutAt: checkout, durationMinutes, sessionDate: new Date(Date.UTC(checkin.getUTCFullYear(), checkin.getUTCMonth(), checkin.getUTCDate())) } });
      const schedule = resolveOrbatScheduleWindow(orbat); const differences = calculateTimeDifferencesByWindow(schedule.startsAtUtc, schedule.endsAtUtc, checkin, checkout);
      await tx.attendance.update({ where: { id: saved.id }, data: { status: calculateAttendanceStatus(true, differences.minutesLate, differences.minutesGoneEarly, differences.totalMinutesMissed, body!.status === 'absent'), ...differences, totalMinutesPresent: durationMinutes ?? 0 } });
    }
    await tx.attendanceLog.create({ data: { attendanceId: saved.id, action: existing ? 'updated' : 'created', source: 'manual', changedById: principal.kind === 'user' ? principal.userId : null } });
    const after = await tx.attendance.findUniqueOrThrow({ where: { id: saved.id }, include: projection });
    await writeApiAudit(tx, audit, { action: existing ? 'attendance.updated' : 'attendance.created', resource: 'attendance', resourceId: String(saved.id), targetUserIds: [...new Set([userId, ...(existing ? [existing.userId] : [])])], outcome: 'success', before: existing ? snapshot(existing) : {}, after: snapshot(after) });
    return dto(after);
  }, { isolationLevel: 'Serializable' });
  return apiSuccess(result, { status: method === 'POST' ? 201 : 200 });
}
