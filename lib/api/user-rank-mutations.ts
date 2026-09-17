import { apiError } from './response';
export function parseUserRankMutation(body: unknown): { data: { rankId: number; reason?: string | null }; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['rankId', 'reason'].includes(key))) return invalid('Provide rankId and optional reason only.');
  if (typeof input.rankId !== 'number' || !Number.isInteger(input.rankId) || input.rankId <= 0 || input.rankId > 2147483647) return invalid('rankId must be a positive 32-bit integer.');
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string') return invalid('reason must be a string or null.');
  return { data: { rankId: input.rankId, ...(input.reason !== undefined ? { reason: typeof input.reason === 'string' ? input.reason.trim() || null : null } : {}) } };
}
export function userRankMutationError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2025') return apiError(404, 'not_found', 'User or rank not found.');
    if (error.code === 'P2034' || error.code === 'P2002' || error.code === 'P2003') return apiError(409, 'conflict', 'Rank data changed concurrently. Reload and retry.');
  }
  throw error;
}
