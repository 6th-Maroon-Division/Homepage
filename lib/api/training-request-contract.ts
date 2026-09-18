import { apiError } from './response';
import { TRAINING_REQUEST_STATUSES } from '@/lib/training-workflow';
export type RequestBody = { userId?: number; trainingId?: number; requestMessage?: string | null; status?: string; adminResponse?: string | null; body?: string };
export function parseTrainingRequestBody(value: unknown, operation: 'create' | 'update' | 'message'): { data: RequestBody; error?: never } | { error: Response; data?: never } {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Invalid training request payload. Use canonical fields, numeric IDs and text of at most 4000 characters.') });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const body = value as Record<string, unknown>;
  const allowed = { create: ['userId', 'trainingId', 'requestMessage'], update: ['status', 'adminResponse'], message: ['body'] }[operation];
  if (Object.keys(body).some(key => !allowed.includes(key))) return invalid();
  const data: Record<string, unknown> = {};
  if (operation === 'create') for (const key of ['userId', 'trainingId']) {
    if (typeof body[key] !== 'number' || !Number.isInteger(body[key]) || body[key] <= 0 || body[key] > 2147483647) return invalid();
    data[key] = body[key];
  }
  for (const key of ['requestMessage', 'adminResponse', 'body']) if (key in body) {
    if (body[key] !== null && typeof body[key] !== 'string' || typeof body[key] === 'string' && body[key].trim().length > 4000) return invalid();
    data[key] = typeof body[key] === 'string' ? body[key].trim() || null : null;
  }
  if (operation === 'message' && (typeof data.body !== 'string' || !data.body)) return invalid();
  if (operation === 'update') {
    if (typeof body.status !== 'string' || !TRAINING_REQUEST_STATUSES.includes(body.status as never) || ['completed', 'cancelled'].includes(body.status)) return invalid();
    data.status = body.status;
  }
  return { data: data as RequestBody };
}
