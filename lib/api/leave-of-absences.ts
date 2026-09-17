import type { LeaveOfAbsence } from '@/generated/prisma/client';
import { apiError } from './response';
import { parseUtcTimestamp } from './utc';
type LeavePatch = { startDate?: Date; returnDate?: Date | null; reason?: string | null; cancelledAt?: Date | null };
export function parseLeaveBody(body: unknown, creating: boolean, existingStart?: Date): { data: LeavePatch; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  const allowed = creating ? ['startDate', 'returnDate', 'reason'] : ['returnDate', 'reason', 'cancel'];
  if (Object.keys(input).some(key => !allowed.includes(key))) return invalid('Unknown leave-of-absence fields.');
  if (!creating && !Object.keys(input).length) return invalid('At least one field is required.');
  const data: LeavePatch = {};
  const startDate = creating ? parseUtcTimestamp(input.startDate) : existingStart;
  if (!startDate) return invalid('startDate must be an explicit-timezone timestamp.');
  if (creating) data.startDate = startDate;
  if (input.returnDate !== undefined) {
    const returnDate = input.returnDate === null ? null : parseUtcTimestamp(input.returnDate);
    if (input.returnDate !== null && !returnDate) return invalid('returnDate must be null or an explicit-timezone timestamp.');
    if (returnDate && returnDate < startDate) return invalid('returnDate cannot be before startDate.');
    data.returnDate = returnDate;
  }
  if (input.reason !== undefined) {
    if (input.reason !== null && typeof input.reason !== 'string') return invalid('reason must be a string or null.');
    data.reason = typeof input.reason === 'string' ? input.reason.trim() || null : null;
  }
  if (input.cancel !== undefined) {
    if (typeof input.cancel !== 'boolean') return invalid('cancel must be a boolean.');
    data.cancelledAt = input.cancel ? new Date() : null;
  }
  return { data };
}
export function leaveSnapshot(value: LeaveOfAbsence) {
  return { userId: value.userId, startDate: value.startDate.toISOString(), returnDate: value.returnDate?.toISOString() ?? null, cancelledAt: value.cancelledAt?.toISOString() ?? null, reason: value.reason };
}
export function leaveDatabaseError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error && (error.code === 'P2025' || error.code === 'P2003')) return apiError(404, 'not_found', 'User or leave-of-absence entry not found.');
  throw error;
}
