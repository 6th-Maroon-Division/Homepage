import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { ApiPrincipal } from './principal';
import type { ApiAuditContext } from './audit';
import { writeApiAudit } from './audit';
import { hasApiPermission } from './permissions';
import { apiError, apiSuccess } from './response';
import { parseUtcTimestamp } from './utc';
import { readJsonBody } from './request';
import { parsePositiveId } from './validation';

export const isSessionStaff = (principal: ApiPrincipal) => hasApiPermission(principal.permissions, 'training:approve_request') || hasApiPermission(principal.permissions, 'training:mark');
export const sessionActor = (principal: ApiPrincipal) => principal.kind === 'user' ? principal.userId : null;
export type SessionOperation = 'create' | 'update' | 'add' | 'attendee' | 'remove';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, maximum = 2147483647) => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= maximum;
export function sessionId(value: string) { const id = parsePositiveId(value); return id && id <= 2147483647 ? id : null; }
export async function validateSessionBody(request: Request, operation: SessionOperation): Promise<Response | null> {
  if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Query parameters are not accepted.');
  const body = operation === 'remove' && !(await request.clone().text()).trim() ? {} : await readJsonBody(request.clone());
  const invalid = () => apiError(422, 'validation_failed', 'Invalid training session payload. Use canonical fields, numeric IDs and explicitly zoned timestamps.');
  if (!record(body)) return invalid();
  const allowed: Record<SessionOperation, string[]> = { create: ['trainingId', 'trainerId', 'attendeeUserIds', 'requestAssignments', 'status', 'startsAt', 'durationMinutes', 'specialInstructions'], update: ['trainerId', 'status', 'startsAt', 'durationMinutes', 'specialInstructions'], add: ['userId', 'trainingRequestId', 'notes', 'advanceTraining'], attendee: ['status', 'notes', 'expectedUpdatedAt'], remove: ['notes', 'expectedUpdatedAt'] };
  if (Object.keys(body).some(key => !allowed[operation].includes(key)) || operation === 'update' && !Object.keys(body).length) return invalid();
  const required = operation === 'create' ? ['trainingId', 'trainerId'] : operation === 'add' ? ['userId'] : [];
  for (const key of required) if (!integer(body[key])) return invalid();
  for (const key of ['trainingId', 'trainerId', 'userId', 'trainingRequestId']) if (key in body && body[key] !== null && !integer(body[key])) return invalid();
  if ('attendeeUserIds' in body && (!Array.isArray(body.attendeeUserIds) || body.attendeeUserIds.some(id => !integer(id)) || new Set(body.attendeeUserIds).size !== body.attendeeUserIds.length)) return invalid();
  if ('requestAssignments' in body) {
    if (!Array.isArray(body.requestAssignments) || body.requestAssignments.some(item => !record(item) || Object.keys(item).some(key => !['userId', 'trainingRequestId'].includes(key)) || !integer(item.userId) || !integer(item.trainingRequestId) || !Array.isArray(body.attendeeUserIds) || !body.attendeeUserIds.includes(item.userId))) return invalid();
    if (new Set(body.requestAssignments.map(item => item.userId)).size !== body.requestAssignments.length || new Set(body.requestAssignments.map(item => item.trainingRequestId)).size !== body.requestAssignments.length) return invalid();
  }
  if ('durationMinutes' in body && body.durationMinutes !== null && !integer(body.durationMinutes, 1440)) return invalid();
  for (const key of ['startsAt', 'expectedUpdatedAt']) if (key in body && !(key === 'startsAt' && body[key] === null) && !parseUtcTimestamp(body[key])) return invalid();
  for (const key of ['specialInstructions', 'notes']) if (key in body && body[key] !== null && (typeof body[key] !== 'string' || body[key].trim().length > 4000)) return invalid();
  if ('advanceTraining' in body && typeof body.advanceTraining !== 'boolean') return invalid();
  const statuses = operation === 'create' ? ['proposed', 'scheduled'] : operation === 'attendee' ? ['scheduled', 'attended', 'completed', 'absent', 'cancelled'] : ['proposed', 'scheduled', 'in_progress', 'completed', 'cancelled'];
  if (('status' in body || operation === 'attendee') && !statuses.includes(body.status as string)) return invalid();
  return null;
}
/** The workflow implementations retain their business errors; normalize their transport here. */
export function sessionJson(value: unknown, options: { status?: number } = {}): NextResponse {
  if (record(value) && typeof value.error === 'string') {
    const status = options.status === 400 ? 422 : options.status ?? 500;
    return apiError(status, status === 403 ? 'forbidden' : status === 404 ? 'not_found' : status === 409 ? 'conflict' : status === 422 ? 'validation_failed' : 'internal_error', value.error);
  }
  if (record(value) && 'attendee' in value) return apiSuccess(value.removed === true ? null : value.attendee, options);
  if (record(value) && 'isStaff' in value) { const { isStaff, ...data } = value; return apiSuccess(data, { ...options, meta: { isStaff } }); }
  return apiSuccess(value, options);
}
export function sessionDatabaseError(error: unknown): Response {
  const code = (error as { code?: string })?.code;
  if (code === 'P2025') return apiError(404, 'not_found', 'Training session reference not found.');
  if (['P2002', 'P2003', 'P2034'].includes(code ?? '')) return apiError(409, 'conflict', 'The session or a linked record changed concurrently. Reload and retry.');
  throw error;
}
export function safeSessionPublish(work: () => unknown) { try { work(); } catch { console.error('Training session notification failed'); } }
export async function auditSessionRead(audit: ApiAuditContext, rows: { trainerId: number | null; attendees: { userId: number }[] }[], resourceId?: string) {
  const targets = [...new Set(rows.flatMap(row => [...(row.trainerId ? [row.trainerId] : []), ...row.attendees.map(attendee => attendee.userId)]))].filter(id => audit.principal?.kind !== 'user' || audit.principal.userId !== id);
  if (targets.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'training_session', resourceId, targetUserIds: targets, outcome: 'success' });
}
export const sessionSnapshot = (row: { id: number; trainingId: number; trainerId: number | null; status: string; startsAt: Date | null; durationMinutes: number | null }) => ({ id: row.id, trainingId: row.trainingId, trainerId: row.trainerId, status: row.status, startsAt: row.startsAt?.toISOString() ?? null, durationMinutes: row.durationMinutes });
export const attendeeSnapshot = (row: { id: number; sessionId: number; userId: number; trainingRequestId: number | null; status: string }) => ({ id: row.id, sessionId: row.sessionId, userId: row.userId, trainingRequestId: row.trainingRequestId, status: row.status });
