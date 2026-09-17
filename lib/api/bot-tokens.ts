import { apiError } from './response';

export const botTokenSelect = {
  id: true, name: true, isActive: true, createdAt: true, lastUsedAt: true,
  createdBy: { select: { id: true, username: true } },
} as const;

export function parseBotTokenBody(body: unknown, creating: boolean) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: apiError(422, 'validation_failed', 'Request body must be an object.') } as const;
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['name', 'isActive'].includes(key))) return { error: apiError(422, 'validation_failed', 'Unknown token fields.') } as const;
  if ((creating || input.name !== undefined) && (typeof input.name !== 'string' || !input.name.trim())) return { error: apiError(422, 'validation_failed', 'name must be a non-empty string.') } as const;
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') return { error: apiError(422, 'validation_failed', 'isActive must be a boolean.') } as const;
  return { data: {
    ...(typeof input.name === 'string' ? { name: input.name.trim() } : {}),
    ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {}),
  } } as const;
}
