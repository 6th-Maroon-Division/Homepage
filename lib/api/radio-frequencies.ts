import { apiError } from './response';

type RadioFrequencyInput = { frequency?: string; type?: 'SR' | 'LR'; isAdditional?: boolean; channel?: string | null; callsign?: string | null };

export function parseRadioFrequencyBody(body: unknown, creating: boolean): { data: RadioFrequencyInput; error?: never } | { error: ReturnType<typeof apiError>; data?: never } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: apiError(422, 'validation_failed', 'Request body must be an object.') };
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['frequency', 'type', 'isAdditional', 'channel', 'callsign'].includes(key))) return { error: apiError(422, 'validation_failed', 'Unknown frequency fields.') };
  if (!creating && !Object.keys(input).length) return { error: apiError(422, 'validation_failed', 'At least one field is required.') };
  if ((creating || input.frequency !== undefined) && (typeof input.frequency !== 'string' || !input.frequency.trim())) return { error: apiError(422, 'validation_failed', 'frequency must be a non-empty string.') };
  if ((creating || input.type !== undefined) && input.type !== 'SR' && input.type !== 'LR') return { error: apiError(422, 'validation_failed', 'type must be SR or LR.') };
  if (input.isAdditional !== undefined && typeof input.isAdditional !== 'boolean') return { error: apiError(422, 'validation_failed', 'isAdditional must be a boolean.') };
  for (const field of ['channel', 'callsign']) if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') return { error: apiError(422, 'validation_failed', `${field} must be a string or null.`) };
  return { data: {
    ...(typeof input.frequency === 'string' ? { frequency: input.frequency.trim() } : {}),
    ...(input.type === 'SR' || input.type === 'LR' ? { type: input.type } : {}),
    ...(typeof input.isAdditional === 'boolean' ? { isAdditional: input.isAdditional } : {}),
    ...(input.channel !== undefined ? { channel: typeof input.channel === 'string' ? input.channel.trim() || null : null } : {}),
    ...(input.callsign !== undefined ? { callsign: typeof input.callsign === 'string' ? input.callsign.trim() || null : null } : {}),
  } };
}

export function radioFrequencySnapshot(value: { frequency: string; type: string; isAdditional: boolean; channel: string | null; callsign: string | null }) {
  return { frequency: value.frequency, type: value.type, isAdditional: value.isAdditional, channel: value.channel, callsign: value.callsign };
}

export function isDuplicateFrequency(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'P2002';
}

export function radioMutationError(error: unknown): Response {
  if (isDuplicateFrequency(error)) return apiError(409, 'conflict', 'This frequency already exists.');
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') return apiError(404, 'not_found', 'Frequency not found.');
  throw error;
}
