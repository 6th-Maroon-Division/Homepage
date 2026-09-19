import { CompilationError, compileAttendanceInTransaction } from '@/lib/jobs/attendance';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { rejectAttendance as fail, requireAttendanceUser } from './attendance';
import type { ApiPrincipal } from './principal';
import { writeApiAudit, type ApiAuditContext } from './audit';
import { apiSuccess } from './response';
import { readJsonBody } from './request';
import { parseUtcTimestamp } from './utc';
import { calculateAttendanceStatus, calculateTimeDifferencesByWindow, calculateSessionOverlapByWindow, calculateTotalMinutesPresent } from '@/lib/attendance';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { buildAttendanceNoteFlags } from '@/lib/attendance-note-flags';
type DB = Prisma.TransactionClient;
function numeric(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647; }
function record(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(422, 'Invalid automation payload fields.'); return value as Record<string, unknown>; }
function noQuery(request: Request) { if ([...new URL(request.url).searchParams].length) fail(400, 'Query parameters are not supported.'); }
function date(value: unknown) { const parsed = parseUtcTimestamp(value); if (!parsed) fail(422, 'Timestamps must be valid ISO datetimes with explicit UTC offsets.'); return parsed; }
function metrics(row: { id: number; userId: number; orbatId: number; status: string; totalMinutesPresent: number; minutesLate: number; minutesGoneEarly: number; totalMinutesMissed: number }) { return { id: row.id, userId: row.userId, orbatId: row.orbatId, status: row.status, totalMinutesPresent: row.totalMinutesPresent, minutesLate: row.minutesLate, minutesGoneEarly: row.minutesGoneEarly, totalMinutesMissed: row.totalMinutesMissed }; }
async function getIdentityUser(db: DB, provider: 'steam' | 'discord', providerUserId: string) { return (await db.authAccount.findUnique({ where: { provider_providerUserId: { provider, providerUserId } }, select: { userId: true } }))?.userId ?? null; }
export async function ingestAttendanceEvent(request: Request, principal: ApiPrincipal, audit: ApiAuditContext) {
  noQuery(request); const input = record(await readJsonBody(request), ['userId', 'identity', 'isJoin', 'eventTime']);
  if (typeof input.isJoin !== 'boolean' || (input.userId !== undefined) === (input.identity !== undefined)) fail(422, 'Provide isJoin and exactly one userId or provider identity.');
  if (input.userId !== undefined && !numeric(input.userId)) fail(422, 'userId must be a positive numeric 32-bit ID.');
  const eventTime = date(input.eventTime);
  let identity: { provider: 'steam' | 'discord'; providerUserId: string } | undefined;
  if (input.identity !== undefined) { const parsed = record(input.identity, ['provider', 'providerUserId']); if (!['steam', 'discord'].includes(parsed.provider as string) || typeof parsed.providerUserId !== 'string' || !/^[1-9]\d{16,19}$/.test(parsed.providerUserId)) fail(422, 'Provide a steam or discord identity with a numeric 17–20 digit providerUserId.'); identity = parsed as typeof identity; }
  const result = await prisma.$transaction(async tx => {
    let userId: number | null;
    if (input.userId === undefined) {
      userId = await getIdentityUser(tx, identity!.provider, identity!.providerUserId);
    } else {
      userId = input.userId as number;
    }
    if (userId !== null) {
      await requireAttendanceUser(tx, principal, userId, 'attendance:edit');
    }
    const identityWhere = userId !== null ? { userId } : identity!.provider === 'steam' ? { steamId: identity!.providerUserId } : { discordId: identity!.providerUserId };
    const previous = await tx.attendanceEvent.findFirst({ where: identityWhere, orderBy: [{ eventTime: 'desc' }, { id: 'desc' }] });
    if (previous && previous.isJoin === input.isJoin && previous.eventTime <= eventTime) {
      if (previous.userId !== null && (principal.kind === 'bot' || principal.userId !== previous.userId)) await writeApiAudit(tx, audit, { action: 'user_data.read', resource: 'attendance_event', resourceId: String(previous.id), targetUserIds: [previous.userId], outcome: 'success' });
      return { data: { id: previous.id, userId: previous.userId, isJoin: previous.isJoin, eventTime: previous.eventTime.toISOString(), processed: previous.processed }, duplicate: true };
    }
    const created = await tx.attendanceEvent.create({ data: { userId, steamId: identity?.provider === 'steam' ? identity.providerUserId : null, discordId: identity?.provider === 'discord' ? identity.providerUserId : null, isJoin: input.isJoin as boolean, eventTime, processed: userId !== null } });
    await writeApiAudit(tx, audit, { action: 'attendance_event.created', resource: 'attendance_event', resourceId: String(created.id), targetUserIds: userId === null ? [] : [userId], outcome: 'success', after: { id: created.id, userId, isJoin: created.isJoin, eventTime: created.eventTime.toISOString(), processed: created.processed } });
    return { data: { id: created.id, userId, isJoin: created.isJoin, eventTime: created.eventTime.toISOString(), processed: created.processed }, duplicate: false };
  }, { isolationLevel: 'Serializable' });
  return apiSuccess(result.data, { status: result.duplicate ? 200 : 201, meta: { duplicate: result.duplicate } });
}
export async function backfillAttendanceEvents(request: Request, principal: ApiPrincipal, audit: ApiAuditContext) {
  noQuery(request); const input = record(await readJsonBody(request), ['cursor', 'limit']); const limit = input.limit === undefined ? 100 : input.limit;
  if (!numeric(limit) || limit > 1000 || input.cursor !== undefined && !numeric(input.cursor)) fail(422, 'limit must be 1–1000 and cursor a numeric positive 32-bit ID.');
  const result = await prisma.$transaction(async tx => {
    const rows = await tx.attendanceEvent.findMany({ where: { processed: false, ...(input.cursor ? { id: { gt: input.cursor as number } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1 });
    const visible = rows.slice(0, limit); const matches: { event: typeof rows[number]; userId: number }[] = [];
    for (const event of visible) {
      const steamUser = event.steamId ? await getIdentityUser(tx, 'steam', event.steamId) : null;
      const discordUser = event.discordId ? await getIdentityUser(tx, 'discord', event.discordId) : null;
      if (steamUser && discordUser && steamUser !== discordUser) fail(409, 'An event has conflicting linked identities. Resolve the mapping before retrying.');
      const userId = steamUser ?? discordUser ?? event.userId;
      if (userId !== null) { if (event.userId !== null && event.userId !== userId) fail(409, 'The stored user conflicts with the linked identity.'); await requireAttendanceUser(tx, principal, userId, 'attendance:edit'); matches.push({ event, userId }); }
    }
    for (const { event, userId } of matches) {
      await tx.attendanceEvent.update({ where: { id: event.id }, data: { userId, processed: true } });
      await writeApiAudit(tx, audit, { action: 'attendance_event.linked', resource: 'attendance_event', resourceId: String(event.id), targetUserIds: [userId], outcome: 'success', before: { userId: event.userId, processed: event.processed }, after: { userId, processed: true } });
    }
    return { data: { scannedCount: visible.length, linkedCount: matches.length }, meta: { limit, nextCursor: rows.length > limit ? String(visible.at(-1)!.id) : null } };
  }, { isolationLevel: 'Serializable' });
  return apiSuccess(result.data, { meta: result.meta });
}
export { compileEventMetrics } from '@/lib/jobs/attendance';
export async function compileAttendance(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, orbatId: number) {
  noQuery(request); record(await readJsonBody(request), []);
  try {
    const result = await prisma.$transaction(tx => compileAttendanceInTransaction(tx, audit, orbatId,
      userId => requireAttendanceUser(tx, principal, userId, 'attendance:edit')), { isolationLevel: 'Serializable', timeout: 30000 });
    return apiSuccess(result);
  } catch (error) { if (error instanceof CompilationError) fail(error.status, error.message); throw error; }
}
export async function recordAttendanceSession(request: Request, principal: ApiPrincipal, audit: ApiAuditContext) {
  noQuery(request); const input = record(await readJsonBody(request), ['userId', 'orbatId', 'checkinTime', 'checkoutTime']);
  if (!numeric(input.userId) || input.orbatId !== undefined && !numeric(input.orbatId)) fail(422, 'Numeric userId and optional orbatId are required.');
  const userId = input.userId; const checkin = input.checkinTime === undefined ? null : date(input.checkinTime); const checkout = input.checkoutTime === undefined ? null : date(input.checkoutTime);
  if (!checkin && !checkout || checkin && checkout && checkout <= checkin) fail(422, 'Provide checkin and/or a later checkout timestamp.');
  const result = await prisma.$transaction(async tx => {
    await requireAttendanceUser(tx, principal, userId, 'attendance:edit');
    const explicit = input.orbatId === undefined ? null : await tx.orbat.findUnique({ where: { id: input.orbatId as number } });
    if (input.orbatId !== undefined && !explicit) fail(404, 'Operation not found.'); if (explicit?.isSideOp) fail(409, 'Attendance is disabled for side operations.');
    let attached = explicit ? await tx.attendance.findFirst({ where: { userId, orbatId: explicit.id }, orderBy: { id: 'asc' } }) : null;
    const operationSignup = explicit ? await tx.signup.findFirst({ where: { userId, slot: { orbatId: explicit.id } }, select: { id: true } }) : null;
    if (explicit && !attached) attached = await tx.attendance.create({ data: { userId, orbatId: explicit.id, signupId: operationSignup?.id ?? null, status: 'no_show' } });
    let current = await tx.attendanceSession.findFirst({ where: { userId, attendanceId: attached?.id ?? null, checkedOutAt: null }, orderBy: { checkedInAt: 'desc' } });
    if (checkin) {
      if (current && current.checkedInAt.getTime() !== checkin.getTime()) fail(409, 'An open session already exists. Close it before opening another.');
      if (!current) current = await tx.attendanceSession.create({ data: { userId, attendanceId: attached?.id ?? null, checkedInAt: checkin, sessionDate: new Date(Date.UTC(checkin.getUTCFullYear(), checkin.getUTCMonth(), checkin.getUTCDate())) } });
    }
    if (!current) fail(409, 'No open session exists for checkout.');
    if (checkout) { if (checkout <= current.checkedInAt) fail(422, 'Checkout must follow the stored checkin.'); current = await tx.attendanceSession.update({ where: { id: current.id }, data: { checkedOutAt: checkout, durationMinutes: Math.ceil((checkout.getTime() - current.checkedInAt.getTime()) / 60000) } }); }
    const startDay = new Date(Date.UTC(current.checkedInAt.getUTCFullYear(), current.checkedInAt.getUTCMonth(), current.checkedInAt.getUTCDate())); const nextDay = new Date(startDay.getTime() + 86400000);
    const signups = explicit ? [] : await tx.signup.findMany({ where: { userId, slot: { orbat: { isSideOp: false, OR: [{ startsAtUtc: { gte: startDay, lt: nextDay } }, { startsAtUtc: null, eventDate: { gte: startDay, lt: nextDay } }, { startsAtUtc: { lt: startDay }, endsAtUtc: { gt: startDay } }] } } }, select: { id: true, slot: { select: { orbat: true } } } });
    const operations = explicit ? [{ orbat: explicit, signupId: operationSignup?.id ?? null }] : signups.map(signup => ({ orbat: signup.slot.orbat, signupId: signup.id }));
    const attendance = [];
    for (const { orbat, signupId } of operations) {
      const schedule = resolveOrbatScheduleWindow(orbat); if (!schedule.startsAtUtc || !schedule.endsAtUtc) { if (explicit) fail(422, 'Operation start and end are required.'); continue; }
      const sessions = await tx.attendanceSession.findMany({ where: { userId, attendanceId: attached?.id ?? null, checkedInAt: { lt: schedule.endsAtUtc }, OR: [{ checkedOutAt: { gte: schedule.startsAtUtc } }, { checkedOutAt: null }] }, orderBy: { checkedInAt: 'asc' } });
      const counted = sessions.map(session => calculateSessionOverlapByWindow(session.checkedInAt, session.checkedOutAt, schedule.startsAtUtc!, schedule.endsAtUtc!)).filter(overlap => overlap.isWithinWindow && overlap.countedCheckinAt).map(overlap => ({ countedCheckinAt: overlap.countedCheckinAt!, countedCheckoutAt: overlap.countedCheckoutAt }));
      const differences = calculateTimeDifferencesByWindow(schedule.startsAtUtc, schedule.endsAtUtc, counted[0]?.countedCheckinAt ?? null, counted.at(-1)?.countedCheckoutAt ?? null);
      const note = await tx.orbatAttendanceNote.findUnique({ where: { orbatId_userId: { orbatId: orbat.id, userId } }, select: { status: true, lateMinutes: true, leaveEarlyMinutes: true } });
      const data = { ...differences, totalMinutesPresent: calculateTotalMinutesPresent(counted), status: calculateAttendanceStatus(counted.length > 0, differences.minutesLate, differences.minutesGoneEarly, differences.totalMinutesMissed), ...buildAttendanceNoteFlags(note) };
      const before = await tx.attendance.findFirst({ where: { userId, orbatId: orbat.id }, orderBy: { id: 'asc' } });
      const saved = before ? await tx.attendance.update({ where: { id: before.id }, data }) : await tx.attendance.create({ data: { userId, orbatId: orbat.id, signupId, ...data } });
      await tx.attendanceLog.create({ data: { attendanceId: saved.id, action: 'time_updated', source: 'automation', changedById: principal.kind === 'user' ? principal.userId : null } });
      await writeApiAudit(tx, audit, { action: 'attendance.calculated', resource: 'attendance', resourceId: String(saved.id), targetUserIds: [userId], outcome: 'success', before: before ? metrics(before) : {}, after: metrics(saved) });
      attendance.push(metrics(saved));
    }
    await writeApiAudit(tx, audit, { action: 'attendance_session.recorded', resource: 'attendance_session', resourceId: String(current.id), targetUserIds: [userId], outcome: 'success', after: { id: current.id, attendanceId: current.attendanceId, checkedInAt: current.checkedInAt.toISOString(), checkedOutAt: current.checkedOutAt?.toISOString() ?? null, durationMinutes: current.durationMinutes } });
    return { session: { id: current.id, userId, attendanceId: current.attendanceId, checkedInAt: current.checkedInAt.toISOString(), checkedOutAt: current.checkedOutAt?.toISOString() ?? null, sessionDate: current.sessionDate.toISOString(), durationMinutes: current.durationMinutes }, attendance };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
  return apiSuccess(result);
}
