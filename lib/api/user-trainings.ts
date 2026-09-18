import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from './handler';
import { apiError, apiSuccess } from './response';
import { readJsonBody } from './request';
import { writeApiAudit, type ApiAuditContext } from './audit';
import type { ApiPrincipal } from './principal';
import { isRequestStaff, canManageTrainingRequest, requestActor, requestId, requestDatabaseError, publishRequestEvent, requestUserSelect } from './training-requests';
import { createSessionNotification, publishSessionNotifications, type SessionNotifications } from './training-session-notifications';
import { isUserTrainingStatus, validateTrainingTransition, type TrainingRequestWorkflowStatus } from '@/lib/training-workflow';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';

class CredentialError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function fail(status: number, message: string): never { throw new CredentialError(status, message); }
const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2147483647;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
type Input = { userId?: number; trainingId?: number; status?: import('@/generated/prisma/client').UserTrainingStatus; notes?: string | null; isHidden?: boolean; trainingSessionId?: number | null; orbatId?: number | null };
export function parseCredentialInput(value: unknown, create: boolean): Input {
  const fields = create ? ['userId', 'trainingId', 'status', 'notes', 'isHidden'] : ['status', 'notes', 'isHidden', 'trainingSessionId', 'orbatId'];
  if (!object(value) || !Object.keys(value).length || Object.keys(value).some(key => !fields.includes(key))) fail(422, 'Provide canonical credential fields.');
  if (create && (!numeric(value.userId) || !numeric(value.trainingId))) fail(422, 'Numeric userId and trainingId are required.');
  if ('status' in value && !isUserTrainingStatus(value.status)) fail(422, 'Invalid training status.');
  if ('isHidden' in value && typeof value.isHidden !== 'boolean') fail(422, 'isHidden must be boolean.');
  for (const key of ['trainingSessionId', 'orbatId']) if (key in value && value[key] !== null && !numeric(value[key])) fail(422, `${key} must be a numeric ID or null.`);
  if ('notes' in value && value.notes !== null && (typeof value.notes !== 'string' || value.notes.trim().length > 4000)) fail(422, 'Notes must contain at most 4000 characters.');
  return { ...value, ...('notes' in value ? { notes: typeof value.notes === 'string' ? value.notes.trim() || null : null } : {}) } as Input;
}
const include = { training: true, trainer: { select: requestUserSelect }, user: { select: requestUserSelect }, statusHistory: { include: { changedBy: { select: requestUserSelect } }, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }] } } satisfies Prisma.UserTrainingInclude;
type Row = Prisma.UserTrainingGetPayload<{ include: typeof include }>;
function serialize(row: Row, staff: boolean, relatedRequestId: number | null) {
  const reveal = staff || ['finished', 'needs_qualify', 'qualified', 'failed'].includes(row.status);
  return { ...row, trainerId: reveal ? row.trainerId : null, trainer: reveal ? row.trainer : null, relatedRequestId,
    statusHistory: row.statusHistory.map(history => ({ ...history, changedById: staff ? history.changedById : null, changedBy: staff ? history.changedBy : null })) };
}
export function credentialRoute(request: Request, work: (principal: ApiPrincipal, audit: ApiAuditContext) => Promise<Response>) {
  return handleApiRequest(request, undefined, async (principal, audit) => { try { return await work(principal, audit); } catch (error) { if (error instanceof CredentialError) return apiError(error.status, error.status === 422 ? 'validation_failed' : error.status === 403 ? 'forbidden' : error.status === 404 ? 'not_found' : error.status === 400 ? 'invalid_request' : 'conflict', error.message); return requestDatabaseError(error); } });
}
export function credentialId(value: string) { const id = requestId(value); if (!id) fail(400, 'Invalid credential ID.'); return id; }
function noQuery(request: Request) { if (new URL(request.url).searchParams.size) fail(400, 'Query parameters are not accepted.'); }
async function authorize(principal: ApiPrincipal, userId: number, db: Prisma.TransactionClient) {
  if (!isRequestStaff(principal) || !await canManageTrainingRequest(principal, userId, db)) fail(403, 'Training staff rights and target hierarchy are required.');
  if (!await db.user.findUnique({ where: { id: userId }, select: { id: true } })) fail(404, 'User not found.');
}
export async function listCredentials(request: Request, principal: ApiPrincipal, audit: ApiAuditContext) {
  const query = new URL(request.url).searchParams;
  for (const key of query.keys()) if (!['userId', 'trainingId', 'status', 'cursor', 'limit'].includes(key) || query.getAll(key).length !== 1) fail(400, 'Invalid or repeated query field.');
  const staff = isRequestStaff(principal);
  const userValue = query.get('userId');
  const userId = userValue === 'me' ? principal.kind === 'user' ? principal.userId : fail(400, 'Bots must use numeric users.') : userValue === null ? staff ? undefined : principal.kind === 'user' ? principal.userId : undefined : credentialId(userValue);
  if (!staff && userId !== (principal.kind === 'user' ? principal.userId : null)) fail(403, 'Only your own credentials are visible.');
  const trainingId = query.has('trainingId') ? credentialId(query.get('trainingId')!) : undefined;
  const status = query.get('status'); if (status !== null && !isUserTrainingStatus(status)) fail(400, 'Invalid status.');
  const limit = query.has('limit') ? credentialId(query.get('limit')!) : 50; if (limit > 100) fail(400, 'limit must be at most 100.');
  const cursor = query.has('cursor') ? credentialId(query.get('cursor')!) : undefined;
  const rows = await prisma.userTraining.findMany({ where: { ...(userId === undefined ? {} : { userId }), ...(trainingId ? { trainingId } : {}), ...(status ? { status } : {}), ...(!staff ? { isHidden: false } : {}), ...(cursor ? { id: { lt: cursor } } : {}) }, include, orderBy: { id: 'desc' }, take: limit + 1 });
  const page = rows.slice(0, limit);
  const requests = page.length ? await prisma.trainingRequest.findMany({ where: { OR: page.map(row => ({ userId: row.userId, trainingId: row.trainingId })) }, select: { id: true, userId: true, trainingId: true }, orderBy: { id: 'desc' } }) : [];
  const data = page.map(row => serialize(row, staff, requests.find(request => request.userId === row.userId && request.trainingId === row.trainingId)?.id ?? null));
  const targetUserIds = [...new Set(data.flatMap(row => [row.userId, row.trainer?.id, ...row.statusHistory.map(history => history.changedBy?.id)]).filter((id): id is number => typeof id === 'number'))].filter(id => principal.kind === 'bot' || principal.userId !== id);
  if (targetUserIds.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'user_training', targetUserIds, outcome: 'success' });
  return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(page.at(-1)!.id) : null } });
}
const snapshot = (row: { id: number; userId: number; trainingId: number; status: string; isHidden: boolean }) => ({ id: row.id, userId: row.userId, trainingId: row.trainingId, status: row.status, isHidden: row.isHidden });
type Events = { userId: number; trainingId: number; status: string; requestId: number | null; requestChanged: boolean }[];
async function writeCredential(db: Prisma.TransactionClient, principal: ApiPrincipal, audit: ApiAuditContext, input: Input, id: number | undefined, upsert: boolean, notifications: SessionNotifications, events: Events) {
  const existing = id ? await db.userTraining.findUnique({ where: { id }, include: { training: true } }) : await db.userTraining.findUnique({ where: { userId_trainingId: { userId: input.userId!, trainingId: input.trainingId! } }, include: { training: true } });
  if (id && !existing) fail(404, 'Credential not found.');
  if (!id && existing && !upsert) fail(409, 'Training already assigned.');
  const userId = existing?.userId ?? input.userId!; const trainingId = existing?.trainingId ?? input.trainingId!;
  await authorize(principal, userId, db);
  const training = existing?.training ?? await db.training.findUnique({ where: { id: trainingId } }); if (!training) fail(404, 'Training not found.');
  const status = input.status ?? existing?.status ?? 'qualified';
  if (status === 'in_training' && !training.requiresTrainingSession || status === 'needs_qualify' && !training.requiresOrbatQualification || status === 'finished' && training.requiresOrbatQualification) fail(409, 'Status does not match the training workflow configuration.');
  if (existing && status !== existing.status) { const transition = validateTrainingTransition(existing.status as TrainingRequestWorkflowStatus, status as TrainingRequestWorkflowStatus, training); if (!transition.valid) fail(409, transition.reason || 'Invalid transition.'); }
  if (input.trainingSessionId && !await db.trainingSessionAttendee.count({ where: { userId, sessionId: input.trainingSessionId, session: { trainingId } } })) fail(409, 'Training session does not belong to this user and training.');
  if (input.orbatId) {
    const orbat = await db.orbat.findUnique({ where: { id: input.orbatId }, select: { isSideOp: true } }); if (!orbat) fail(404, 'Operation not found.');
    if (orbat.isSideOp || !training.requiresOrbatQualification || !existing || existing.status !== 'needs_qualify' || !['qualified', 'failed'].includes(status)) fail(409, 'Only pending ORBAT qualifications can be decided.');
    const signup = await db.signup.findFirst({ where: { userId, slot: { orbatId: input.orbatId, squadRole: { requiredTrainingIds: { has: trainingId } } } }, select: { id: true } });
    if (!signup) fail(409, 'No relevant qualification signup exists for this operation.');
  }
  const now = new Date(); const actorId = requestActor(principal); const notes = input.notes === undefined ? existing?.notes ?? null : input.notes;
  const fields = { trainerId: actorId, status, notes, isHidden: input.isHidden ?? existing?.isHidden ?? false, needsRetraining: status === 'failed', statusUpdatedAt: existing?.status === status ? existing.statusUpdatedAt : now,
    trainingSessionCompletedAt: ['finished', 'needs_qualify'].includes(status) || !existing && status === 'qualified' ? existing?.trainingSessionCompletedAt ?? now : existing?.trainingSessionCompletedAt ?? null,
    orbatQualifiedAt: status === 'qualified' ? now : null, failedAt: status === 'failed' ? now : null };
  let credentialId: number;
  if (existing) { const result = await db.userTraining.updateMany({ where: { id: existing.id, status: existing.status, statusUpdatedAt: existing.statusUpdatedAt, notes: existing.notes, trainerId: existing.trainerId, isHidden: existing.isHidden }, data: fields }); if (result.count !== 1) fail(409, 'Credential changed concurrently.'); credentialId = existing.id; }
  else credentialId = (await db.userTraining.create({ data: { userId, trainingId, ...fields } })).id;
  if (existing?.status !== status) await db.userTrainingStatusHistory.create({ data: { userTrainingId: credentialId, fromStatus: existing?.status ?? null, toStatus: status, changedById: actorId, notes, trainingSessionId: input.trainingSessionId ?? null, orbatId: input.orbatId ?? null } });
  const related = await db.trainingRequest.findFirst({ where: { userId, trainingId, status: { in: ['pending','approved','in_training','finished','needs_qualify','qualified','failed'] } }, orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }] });
  const requestChanged = !!related && related.status !== status;
  if (requestChanged) { const updated = await db.trainingRequest.updateMany({ where: { id: related!.id, status: related!.status }, data: { status, handledByAdminId: actorId } }); if (updated.count !== 1) fail(409, 'Request changed concurrently.'); await db.trainingRequestMessage.create({ data: { requestId: related!.id, senderRole: 'SYSTEM', body: input.orbatId ? `ORBAT qualification ${status === 'qualified' ? 'passed' : 'failed'}${notes ? `: ${notes}` : '.'}` : `Training status changed from ${related!.status} to ${status}.` } }); }
  const row = await db.userTraining.findUnique({ where: { id: credentialId }, include }); if (!row) fail(409, 'Credential changed concurrently.');
  await writeApiAudit(db, audit, { action: existing ? 'user_training.updated' : 'user_training.created', resource: 'user_training', resourceId: String(credentialId), targetUserIds: [userId], outcome: 'success', before: existing ? snapshot(existing) : {}, after: { ...snapshot(row), trainingSessionId: input.trainingSessionId ?? null, orbatId: input.orbatId ?? null } });
  if (existing?.status !== status) await createSessionNotification({ recipientUserIds: [userId], title: `${training.name}: ${status.replaceAll('_',' ')}`, body: status === 'needs_qualify' ? `You can temporarily use ${training.name} ORBAT slots to demonstrate your skills.` : status === 'qualified' ? `You are now fully qualified for ${training.name}.` : status === 'failed' ? `Your ${training.name} qualification was marked as failed. Contact a trainer for next steps.` : `Your ${training.name} status is now ${status.replaceAll('_',' ')}.`, actionUrl: related ? `/trainings/requests/${related.id}` : '/profile?tab=trainings', createdById: actorId }, db, notifications);
  events.push({ userId, trainingId, status, requestId: related?.id ?? null, requestChanged });
  return serialize(row, true, related?.id ?? null);
}
export async function mutateCredentials(request: Request, principal: ApiPrincipal, audit: ApiAuditContext, mode: 'create' | 'update' | 'bulk' | 'delete', id?: number) {
  noQuery(request); if (!isRequestStaff(principal)) fail(403, 'Training staff rights are required.');
  if (mode === 'delete') {
    if ((await request.text()).trim()) fail(400, 'DELETE does not accept a body.');
    const deleted = await prisma.$transaction(async db => { const row = await db.userTraining.findUnique({ where: { id }, include: { statusHistory: { select: { id: true } } } }); if (!row) fail(404, 'Credential not found.'); await authorize(principal, row.userId, db); await db.userTraining.delete({ where: { id } }); await writeApiAudit(db, audit, { action: 'user_training.deleted', resource: 'user_training', resourceId: String(id), targetUserIds: [row.userId], outcome: 'success', before: { ...snapshot(row), historyIds: row.statusHistory.map(item => item.id) }, after: { deleted: true } }); return row; }, { isolationLevel: 'Serializable' });
    publishRequestEvent(() => publishUserProfileEvent(deleted.userId, { source: 'user-training.removed', trainingId: deleted.trainingId })); return apiSuccess(null);
  }
  const body = await readJsonBody(request); let inputs: Input[];
  if (mode === 'bulk') { if (!object(body) || Object.keys(body).length !== 1 || !Array.isArray(body.updates) || !body.updates.length || body.updates.length > 100) fail(422, 'Provide 1–100 updates.'); inputs = body.updates.map(value => parseCredentialInput(value, true)); if (new Set(inputs.map(value => `${value.userId}:${value.trainingId}`)).size !== inputs.length) fail(422, 'Duplicate credentials are not accepted.'); if (inputs.some(input => input.status !== 'needs_qualify')) fail(422, 'Bulk qualification requests require status needs_qualify.'); }
  else inputs = [parseCredentialInput(body, mode === 'create')];
  const notifications: SessionNotifications = []; const events: Events = [];
  const data = await prisma.$transaction(async db => { const result = []; for (const input of inputs) result.push(await writeCredential(db, principal, audit, input, id, mode === 'bulk', notifications, events)); return result; }, { isolationLevel: 'Serializable' });
  publishSessionNotifications(notifications);
  for (const event of events) publishRequestEvent(() => { if (event.requestId && event.requestChanged) publishTrainingChatEvent(event.requestId, { source: 'status', status: event.status }); publishUserProfileEvent(event.userId, { source: 'user-training.updated', trainingId: event.trainingId, status: event.status }); });
  return apiSuccess(mode === 'bulk' ? data : data[0], { status: mode === 'create' ? 201 : 200 });
}
