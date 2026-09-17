import type { Prisma } from '@/generated/prisma/client';
import { apiError } from './response';
const positiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
type RequirementPatch = { minimumRankId?: number | null; requiredTrainingIds?: number[] };
export function parseTrainingRequirements(body: unknown): { data: RequirementPatch; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some(key => !['minimumRankId', 'requiredTrainingIds'].includes(key))) return invalid('Provide minimumRankId and/or requiredTrainingIds only.');
  if (input.minimumRankId !== undefined && input.minimumRankId !== null && !positiveInt(input.minimumRankId)) return invalid('minimumRankId must be null or a positive 32-bit integer.');
  if (input.requiredTrainingIds !== undefined && (!Array.isArray(input.requiredTrainingIds) || input.requiredTrainingIds.some(id => !positiveInt(id)) || new Set(input.requiredTrainingIds).size !== input.requiredTrainingIds.length)) return invalid('requiredTrainingIds must be an array of unique positive 32-bit integer IDs.');
  return { data: { ...(input.minimumRankId !== undefined ? { minimumRankId: input.minimumRankId as number | null } : {}), ...(input.requiredTrainingIds !== undefined ? { requiredTrainingIds: [...input.requiredTrainingIds as number[]].sort((a, b) => a - b) } : {}) } };
}
export function introducesTrainingCycle(targetId: number, requiredIds: number[], edges: { trainingId: number; requiredTrainingId: number }[]): boolean {
  const graph = new Map<number, number[]>();
  for (const edge of edges) {
    if (edge.trainingId === targetId) continue;
    const outgoing = graph.get(edge.trainingId) ?? [];
    outgoing.push(edge.requiredTrainingId); graph.set(edge.trainingId, outgoing);
  }
  graph.set(targetId, requiredIds);
  const stack = [...requiredIds];
  const visited = new Set<number>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(graph.get(current) ?? []));
  }
  return false;
}
export async function readTrainingRequirements(db: Pick<Prisma.TransactionClient, 'training'>, id: number) {
  const training = await db.training.findUnique({ where: { id }, select: {
    rankRequirement: { select: { minimumRankId: true, minimumRank: true } },
    requiresTrainings: { orderBy: { requiredTrainingId: 'asc' }, select: { requiredTrainingId: true, requiredTraining: { select: { id: true, name: true, category: { select: { name: true } } } } } },
  } });
  if (!training) return null;
  return { minimumRankId: training.rankRequirement?.minimumRankId ?? null, requiredTrainingIds: training.requiresTrainings.map(row => row.requiredTrainingId), minimumRank: training.rankRequirement?.minimumRank ?? null, requiredTrainings: training.requiresTrainings.map(row => row.requiredTraining) };
}
export function requirementsSnapshot(value: { minimumRankId: number | null; requiredTrainingIds: number[] }) {
  return { minimumRankId: value.minimumRankId, requiredTrainingIds: value.requiredTrainingIds };
}
export function requirementsDatabaseError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2034') return apiError(409, 'conflict', 'Training requirements changed concurrently. Reload and retry.');
    if (error.code === 'P2002' || error.code === 'P2003') return apiError(409, 'conflict', 'Training requirement references changed. Reload and retry.');
    if (error.code === 'P2025') return apiError(404, 'not_found', 'Training requirement not found.');
  }
  throw error;
}
