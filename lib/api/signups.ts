import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { apiError, apiSuccess, type ApiErrorCode } from './response';
import { handleApiRequest, handlePublicApiRequest } from './handler';
import { canAccessApiUser } from './auth';
import { hasApiPermission } from './permissions';
import type { ApiPrincipal } from './principal';
import { writeApiAudit, type ApiAuditContext } from './audit';
import { readJsonBody } from './request';
import { parsePositiveId, parseCursorPagination } from './validation';
import { evaluateOrbatTrainingAccess, formatOrbatTrainingAccessError } from '@/lib/orbat-training-access';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { appendBotEvent } from '@/lib/bot-events';
import { publishOrbatEvent } from '@/lib/realtime/orbat-events';
import type { PermissionKey } from '@/lib/permissions';
type DB = Prisma.TransactionClient;
class Failure { constructor(readonly response: Response) {} }
function fail(status: number, code: ApiErrorCode, message: string): never { throw new Failure(apiError(status, code, message)); }
export function signupId(value: unknown): number { const id = parsePositiveId(value); if (id === null || id > 2147483647) fail(400, 'invalid_request', 'A positive 32-bit ID is required.'); return id; }
function numeric(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647; }
function object(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail(422, 'validation_failed', 'Invalid payload fields.'); return value as Record<string, unknown>; }
function query(request: Request, keys: string[]) { const params = new URL(request.url).searchParams; for (const key of params.keys()) if (!keys.includes(key) || params.getAll(key).length !== 1) fail(400, 'invalid_request', 'Invalid or duplicate query parameter.'); return params; }
function page(params: URLSearchParams) { const parsed = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 }); if (parsed.error !== undefined) fail(400, 'invalid_request', parsed.error); return parsed.data; }
export function signupRoute(request: Request, permission: PermissionKey | undefined, callback: (principal: ApiPrincipal, context: ApiAuditContext) => Promise<Response>) {
  return handleApiRequest(request, permission, async (principal, context) => { try { return await callback(principal, context); } catch (error) { return catchFailure(error); } });
}
function catchFailure(error: unknown): Response {
  if (error instanceof Failure) return error.response;
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2025') return apiError(404, 'not_found', 'Resource no longer exists.');
    if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return apiError(409, 'conflict', 'Signup state changed concurrently. Reload and retry.');
  }
  throw error;
}
async function target(principal: ApiPrincipal, value: unknown, db: DB) {
  const id = value === 'me' || value === undefined ? principal.kind === 'user' ? principal.userId : fail(400, 'invalid_request', 'Bots must specify a numeric user ID.') : signupId(value);
  if (!await canAccessApiUser(principal, id, 'orbat:edit', db)) fail(403, 'forbidden', 'Cannot manage this user.');
  if (!await db.user.findUnique({ where: { id }, select: { id: true } })) fail(404, 'not_found', 'User not found.');
  return id;
}
const slotInclude = { orbat: true, squad: { select: { id: true, name: true } }, squadRole: { select: { name: true, requiredTrainingIds: true, requiredRankIds: true } }, _count: { select: { signups: true } } } as const;
type Slot = Prisma.SlotGetPayload<{ include: typeof slotInclude }>;
async function access(db: DB, userId: number, slot: Slot) {
  const trainingIds = slot.orbat.isSideOp ? [] : slot.squadRole?.requiredTrainingIds ?? [];
  const rankIds = slot.orbat.isSideOp ? [] : slot.squadRole?.requiredRankIds ?? [];
  const [trainings, userTrainings, rank, ranks, note] = await Promise.all([
    trainingIds.length ? db.training.findMany({ where: { id: { in: trainingIds } }, select: { id: true, name: true, requiresOrbatQualification: true } }) : [],
    trainingIds.length ? db.userTraining.findMany({ where: { userId, trainingId: { in: trainingIds } }, select: { trainingId: true, status: true } }) : [],
    rankIds.length ? db.userRank.findUnique({ where: { userId }, select: { currentRank: { select: { orderIndex: true } } } }) : null,
    rankIds.length ? db.rank.findMany({ where: { id: { in: rankIds } }, select: { id: true, orderIndex: true } }) : [],
    db.orbatAttendanceNote.findUnique({ where: { orbatId_userId: { orbatId: slot.orbatId, userId } }, select: { status: true } }),
  ]);
  const training = evaluateOrbatTrainingAccess(trainingIds.map(id => trainings.find(row => row.id === id) ?? { id, name: `Training #${id}`, requiresOrbatQualification: true }), userTrainings);
  const rankAllowed = ranks.length === rankIds.length && ranks.every(required => typeof rank?.currentRank?.orderIndex === 'number' && rank.currentRank.orderIndex >= required.orderIndex);
  const cutoff = resolveOrbatScheduleWindow(slot.orbat).cutoff;
  return { training, rankAllowed, absent: note?.status === 'absent', closed: !!cutoff && cutoff < new Date() };
}
function signupDto(row: { id: number; slotId: number; userId: number; createdAt: Date }, orbatId: number) { return { id: row.id, slotId: row.slotId, userId: row.userId, orbatId, createdAt: row.createdAt.toISOString() }; }
function notify(principal: ApiPrincipal, audit: ApiAuditContext, orbatId: number, type: 'signup.created' | 'signup.moved' | 'signup.deleted', payload: Record<string, unknown>) { try { publishOrbatEvent({ type, orbatId, actorUserId: principal.kind === 'user' ? principal.userId : null, payload }); } catch { console.error('Signup notification failed', { correlationId: audit.correlationId, timestamp: new Date().toISOString() }); } }
export async function mutateSignup(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, method: 'POST' | 'PATCH' | 'DELETE', id?: number) {
  query(request, []);
  const body = method === 'DELETE' ? {} : object(await readJsonBody(request), method === 'POST' ? ['slotId', 'userId'] : ['slotId', 'overrideRequirements']);
  if (method !== 'DELETE' && !numeric(body.slotId)) fail(422, 'validation_failed', 'slotId must be a numeric positive 32-bit ID.');
  if (body.userId !== undefined && body.userId !== 'me' && !numeric(body.userId)) fail(422, 'validation_failed', 'userId must be a numeric positive 32-bit ID or me.');
  if (body.overrideRequirements !== undefined && typeof body.overrideRequirements !== 'boolean') fail(422, 'validation_failed', 'overrideRequirements must be boolean.');
  if (method === 'PATCH' && !hasApiPermission(principal.permissions, 'orbat:edit')) fail(403, 'forbidden', 'Moving signups requires orbat:edit.');
  const key = request.headers.get('idempotency-key');
  if (key !== null && (!key.trim() || key.length > 200)) fail(400, 'invalid_request', 'Idempotency-Key must contain 1–200 characters.');
  const receiptKey = key === null ? null : createHash('sha256').update(`${principal.kind}:${principal.kind === 'user' ? principal.userId : principal.tokenId}:${key}`).digest('hex');
  const hash = createHash('sha256').update(JSON.stringify({ method, id, slotId: body.slotId, userId: body.userId ?? 'me', overrideRequirements: body.overrideRequirements ?? false })).digest('hex');
  const result = await prisma.$transaction(async tx => {
    if (receiptKey) {
      const receipt = await tx.botIdempotencyReceipt.findUnique({ where: { idempotencyKey: receiptKey } });
      if (receipt && receipt.expiresAt > new Date()) {
        if (receipt.requestHash !== hash || receipt.operation !== `canonical.signup.${method}`) fail(409, 'idempotency_conflict', 'Idempotency key was used for a different request.');
        const saved = receipt.responseBody as { data: Prisma.JsonValue; meta: { warnings: string[] }; targetUserId: number };
        await target(principal, saved.targetUserId, tx);
        return { data: saved.data, meta: saved.meta, status: receipt.responseStatus, replay: true, orbatId: 0, payload: {} };
      }
      if (receipt) await tx.botIdempotencyReceipt.delete({ where: { idempotencyKey: receiptKey } });
    }
    const old = method === 'POST' ? null : await tx.signup.findUnique({ where: { id }, include: { slot: { select: { orbatId: true } }, attendance: { select: { id: true, sessions: { select: { id: true } }, logs: { select: { id: true } } } } } });
    if (method !== 'POST' && !old) fail(404, 'not_found', 'Signup not found.');
    const userId = await target(principal, old?.userId ?? body.userId, tx);
    const slotId = method === 'DELETE' ? old!.slotId : body.slotId as number;
    const slot = await tx.slot.findUnique({ where: { id: slotId }, include: slotInclude });
    if (!slot) fail(404, 'not_found', 'Slot not found.');
    if (old && old.slot.orbatId !== slot.orbatId) fail(409, 'conflict', 'Signups cannot move between operations.');
    const warnings: string[] = [];
    if (method === 'DELETE') {
      const cutoff = resolveOrbatScheduleWindow(slot.orbat).cutoff;
      if (cutoff && cutoff < new Date() && !hasApiPermission(principal.permissions, 'orbat:edit')) fail(409, 'signup_closed', 'Signups are closed.');
    } else {
      const eligible = await access(tx, userId, slot);
      if (eligible.closed) fail(409, 'signup_closed', 'Signups are closed.');
      if (eligible.absent) fail(409, 'marked_absent', 'Remove the absence note before signing up.');
      if (slot.maxSignups !== null && slot._count.signups - (old?.slotId === slotId ? 1 : 0) >= slot.maxSignups) fail(409, 'slot_full', 'The slot is full.');
      const another = await tx.signup.findFirst({ where: { userId, slot: { orbatId: slot.orbatId }, ...(old ? { id: { not: old.id } } : {}) }, select: { id: true } });
      if (another) fail(409, 'already_signed_up', 'The user is already signed up for this operation.');
      if (!eligible.rankAllowed) warnings.push('The required rank has not been met.');
      if (!eligible.training.allowed) warnings.push(formatOrbatTrainingAccessError(eligible.training)?.error ?? 'Required training has not been met.');
      if (!body.overrideRequirements) {
        if (!eligible.rankAllowed) fail(409, 'rank_required', warnings[0]);
        if (!eligible.training.allowed) fail(409, 'training_required', warnings.at(-1)!);
      }
    }
    const row = method === 'DELETE' ? null : method === 'POST' ? await tx.signup.create({ data: { slotId, userId } }) : await tx.signup.update({ where: { id: old!.id }, data: { slotId } });
    if (method === 'DELETE') await tx.signup.delete({ where: { id: old!.id } });
    const signupId = row?.id ?? old!.id;
    const payload = { orbatId: slot.orbatId, signupId, userId, oldSlotId: old?.slotId ?? null, slotId: method === 'DELETE' ? null : slotId };
    await appendBotEvent({ type: 'orbat.signup_changed', aggregate: 'orbat', aggregateId: slot.orbatId, payload }, tx);
    await writeApiAudit(tx, audit, { action: method === 'POST' ? 'signup.created' : method === 'PATCH' ? 'signup.moved' : 'signup.deleted', resource: 'signup', resourceId: String(signupId), targetUserIds: [userId], outcome: 'success', before: old ? { id: old.id, slotId: old.slotId, attendanceId: old.attendance?.id ?? null, attendanceSessionIds: old.attendance?.sessions.map(session => session.id) ?? [], attendanceLogIds: old.attendance?.logs.map(log => log.id) ?? [] } : {}, after: row ? { id: row.id, slotId: row.slotId, overrideRequirements: body.overrideRequirements === true } : { deleted: true } });
    const data = row ? signupDto(row, slot.orbatId) : null; const meta = { warnings }; const status = method === 'POST' ? 201 : 200;
    if (receiptKey) await tx.botIdempotencyReceipt.create({ data: { idempotencyKey: receiptKey, operation: `canonical.signup.${method}`, requestHash: hash, responseStatus: status, responseBody: { data, meta, targetUserId: userId }, expiresAt: new Date(Date.now() + 86400000) } });
    return { data, meta, status, replay: false, orbatId: slot.orbatId, payload };
  }, { isolationLevel: 'Serializable' });
  if (!result.replay) {
    const payload = result.payload as Record<string, unknown>;
    notify(principal, audit, result.orbatId, method === 'POST' ? 'signup.created' : method === 'PATCH' ? 'signup.moved' : 'signup.deleted', { slotId: payload.slotId, fromSlotId: payload.oldSlotId });
  }
  return apiSuccess(result.data, { status: result.status, meta: result.meta });
}
const listSelect = { id: true, userId: true, slotId: true, createdAt: true, user: { select: { id: true, username: true } }, slot: { select: { id: true, orderIndex: true, orbatId: true, squadRole: { select: { name: true } }, squad: { select: { id: true, name: true } }, orbat: { select: { name: true, startsAtUtc: true, endsAtUtc: true, eventDate: true, startTime: true, endTime: true } } } } } as const;
export async function listSignups(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, scope: { orbatId: number } | { userId: string }) {
  const pagination = page(query(request, ['cursor', 'limit']));
  let userId: number | undefined;
  if ('userId' in scope) userId = await target(principal, scope.userId, prisma);
  else {
    if (!hasApiPermission(principal.permissions, 'orbat:edit') && !hasApiPermission(principal.permissions, 'attendance:view')) fail(403, 'forbidden', 'Signup lists require orbat:edit or attendance:view.');
    if (!await prisma.orbat.findUnique({ where: { id: scope.orbatId }, select: { id: true } })) fail(404, 'not_found', 'Operation not found.');
  }
  const rows = await prisma.signup.findMany({ where: { ...(userId === undefined ? { slot: { orbatId: (scope as { orbatId: number }).orbatId } } : { userId }), ...(pagination.cursor ? { id: { lt: pagination.cursor } } : {}) }, select: listSelect, orderBy: { id: 'desc' }, take: pagination.limit + 1 });
  const visible = rows.slice(0, pagination.limit);
  const targets = userId !== undefined ? [userId] : visible.map(row => row.userId);
  const other = targets.filter(id => principal.kind === 'bot' || id !== principal.userId);
  if (other.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'signup', targetUserIds: other, outcome: 'success' });
  const data = visible.map(row => ({ ...signupDto(row, row.slot.orbatId), user: row.user, slot: { id: row.slot.id, orderIndex: row.slot.orderIndex, squadRole: row.slot.squadRole, squad: row.slot.squad }, orbat: { id: row.slot.orbatId, name: row.slot.orbat.name, startsAtUtc: resolveOrbatScheduleWindow(row.slot.orbat).startsAtUtc?.toISOString() ?? null, endsAtUtc: resolveOrbatScheduleWindow(row.slot.orbat).endsAtUtc?.toISOString() ?? null } }));
  return apiSuccess(data, { meta: { limit: pagination.limit, nextCursor: rows.length > pagination.limit ? String(visible.at(-1)!.id) : null } });
}
export function availableSlots(request: Request, orbatId: string) {
  return handlePublicApiRequest(request, async () => { try { return await slotPage(request, signupId(orbatId)); } catch (error) { return catchFailure(error); } });
}
export async function slotPage(request: Request, orbatId: number, principal?: ApiPrincipal, audit?: ApiAuditContext) {
  const params = query(request, principal ? ['cursor', 'limit', 'userId'] : ['cursor', 'limit']); const pagination = page(params);
  const userId = principal ? await target(principal, params.get('userId') ?? 'me', prisma) : undefined;
  if (!await prisma.orbat.findUnique({ where: { id: orbatId }, select: { id: true } })) fail(404, 'not_found', 'Operation not found.');
  const rows = await prisma.slot.findMany({ where: { orbatId, ...(pagination.cursor ? { id: { gt: pagination.cursor } } : {}) }, include: slotInclude, orderBy: { id: 'asc' }, take: pagination.limit + 1 });
  const current = userId === undefined ? null : await prisma.signup.findFirst({ where: { userId, slot: { orbatId } }, select: { id: true, slotId: true } });
  const data = [];
  for (const slot of rows.slice(0, pagination.limit)) {
    const base = { slotId: slot.id, slotName: slot.squadRole?.name ?? 'Unassigned Role', squadId: slot.squadId, squadName: slot.squad.name, capacity: slot.maxSignups, signupCount: slot._count.signups, available: slot.maxSignups === null || slot._count.signups < slot.maxSignups };
    if (userId === undefined) data.push(base);
    else {
      const eligibility = await access(prisma, userId, slot); const reasons: { code: string; message: string }[] = [];
      if (eligibility.closed) reasons.push({ code: 'signup_closed', message: 'Signups are closed.' });
      if (eligibility.absent) reasons.push({ code: 'marked_absent', message: 'The user is marked absent.' });
      if (!base.available && current?.slotId !== slot.id) reasons.push({ code: 'slot_full', message: 'The slot is full.' });
      if (!eligibility.rankAllowed) reasons.push({ code: 'rank_required', message: 'The required rank has not been met.' });
      if (!eligibility.training.allowed) reasons.push({ code: 'training_required', message: formatOrbatTrainingAccessError(eligibility.training)?.error ?? 'Training is required.' });
      data.push({ ...base, allowed: reasons.length === 0, temporary: eligibility.training.hasTemporaryAccess, temporaryTrainings: eligibility.training.temporaryRequirements.map(row => ({ id: row.id, name: row.name })), error: reasons[0]?.message ?? null, code: reasons[0]?.code ?? null, reasons, currentSignup: current ? { id: current.id, slotId: current.slotId } : null });
    }
  }
  if (principal && audit && userId !== undefined && (principal.kind === 'bot' || principal.userId !== userId)) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'orbat_eligibility', resourceId: String(orbatId), targetUserIds: [userId], outcome: 'success' });
  return apiSuccess(data, { meta: { limit: pagination.limit, nextCursor: rows.length > pagination.limit ? String(rows[pagination.limit - 1].id) : null } });
}
export async function availability(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, orbatId: number, targetId: string, method: 'GET' | 'PATCH' | 'DELETE') {
  query(request, []);
  const body = method === 'PATCH' ? object(await readJsonBody(request), ['status', 'reason', 'lateMinutes', 'leaveEarlyMinutes']) : {};
  if (method === 'PATCH') {
    if (!['absent', 'unsure', 'late_unsure'].includes(body.status as string)) fail(422, 'validation_failed', 'A valid availability status is required.');
    if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== 'string' || body.reason.trim().length > 500)) fail(422, 'validation_failed', 'Reason must be null or at most 500 characters.');
    for (const key of ['lateMinutes', 'leaveEarlyMinutes']) if (body[key] !== undefined && body[key] !== null && (typeof body[key] !== 'number' || !Number.isInteger(body[key]) || (body[key] as number) < 0 || (body[key] as number) > 2147483647)) fail(422, 'validation_failed', 'Minute estimates must be nonnegative numeric integers.');
    if (body.status === 'late_unsure' && body.lateMinutes == null && body.leaveEarlyMinutes == null) fail(422, 'validation_failed', 'Provide a late or early minute estimate.');
  }
  const result = await prisma.$transaction(async tx => {
    const userId = await target(principal, targetId, tx);
    const orbat = await tx.orbat.findUnique({ where: { id: orbatId }, select: { id: true, startsAtUtc: true, endsAtUtc: true, eventDate: true, startTime: true, endTime: true } });
    if (!orbat) fail(404, 'not_found', 'Operation not found.');
    const existing = await tx.orbatAttendanceNote.findUnique({ where: { orbatId_userId: { orbatId, userId } } });
    if (method === 'GET') {
      if (principal.kind === 'bot' || userId !== principal.userId) await writeApiAudit(tx, audit, { action: 'user_data.read', resource: 'orbat_availability', resourceId: String(orbatId), targetUserIds: [userId], outcome: 'success' });
      return { data: existing ? { ...existing, createdAt: existing.createdAt.toISOString(), updatedAt: existing.updatedAt.toISOString() } : null, userId };
    }
    const cutoff = resolveOrbatScheduleWindow(orbat).cutoff;
    if (cutoff && cutoff < new Date() && !hasApiPermission(principal.permissions, 'orbat:edit')) fail(409, 'signup_closed', 'Availability changes are closed.');
    if (method === 'DELETE' && !existing) fail(404, 'not_found', 'Availability note not found.');
    const fields = { status: body.status as 'absent' | 'unsure' | 'late_unsure', reason: typeof body.reason === 'string' ? body.reason.trim() || null : null, lateMinutes: body.status === 'late_unsure' ? body.lateMinutes as number ?? null : null, leaveEarlyMinutes: body.status === 'late_unsure' ? body.leaveEarlyMinutes as number ?? null : null };
    const saved = method === 'DELETE' ? null : await tx.orbatAttendanceNote.upsert({ where: { orbatId_userId: { orbatId, userId } }, create: { orbatId, userId, ...fields }, update: fields });
    if (method === 'DELETE') await tx.orbatAttendanceNote.delete({ where: { id: existing!.id } });
    await appendBotEvent({ type: 'orbat.availability_changed', aggregate: 'orbat', aggregateId: orbatId, payload: { orbatId, userId, status: saved?.status ?? null } }, tx);
    await writeApiAudit(tx, audit, { action: method === 'DELETE' ? 'orbat_availability.deleted' : 'orbat_availability.updated', resource: 'orbat_availability', resourceId: String(orbatId), targetUserIds: [userId], outcome: 'success', before: existing ? { id: existing.id, status: existing.status, reason: existing.reason, lateMinutes: existing.lateMinutes, leaveEarlyMinutes: existing.leaveEarlyMinutes } : {}, after: saved ? { id: saved.id, status: saved.status, reason: saved.reason, lateMinutes: saved.lateMinutes, leaveEarlyMinutes: saved.leaveEarlyMinutes } : { deleted: true } });
    return { data: saved ? { ...saved, createdAt: saved.createdAt.toISOString(), updatedAt: saved.updatedAt.toISOString() } : null, userId };
  }, { isolationLevel: 'Serializable' });
  if (method !== 'GET') { try { publishOrbatEvent({ type: 'orbat.updated', orbatId, actorUserId: principal.kind === 'user' ? principal.userId : null }); } catch { console.error('Availability notification failed', { correlationId: audit.correlationId, timestamp: new Date().toISOString() }); } }
  return apiSuccess(result.data);
}
