import { apiError } from './response';
export const rankRequirementsSelect = { requiredTrainings: { orderBy: { id: 'asc' }, select: { id: true, name: true, category: { select: { name: true } } } } } as const;
export function parseRankRequirements(body: unknown): { data: number[]; error?: never } | { error: Response; data?: never } {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Provide requiredTrainingIds as an array of unique positive 32-bit integer IDs.') });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Array.isArray(input.requiredTrainingIds)) return invalid();
  const ids = input.requiredTrainingIds;
  if (ids.some(id => typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || id > 2147483647) || new Set(ids).size !== ids.length) return invalid();
  return { data: [...ids].sort((a, b) => a - b) };
}
export function rankRequirementsDto(value: { requiredTrainings: { id: number; name: string; category: { name: string } | null }[] } | null) {
  const requiredTrainings = value?.requiredTrainings ?? [];
  return { requiredTrainingIds: requiredTrainings.map(training => training.id), requiredTrainings };
}
export function rankRequirementsDatabaseError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2025') return apiError(404, 'not_found', 'Rank or required training not found.');
    if (error.code === 'P2003' || error.code === 'P2002' || error.code === 'P2034') return apiError(409, 'conflict', 'Rank requirements changed concurrently. Reload and retry.');
  }
  throw error;
}
