import type { Prisma, SquadRole } from '@/generated/prisma/client';
import type { PermissionKey } from '@/lib/permissions';
import { apiError } from './response';

export const roleReadPermissions: PermissionKey[] = ['subslot:view', 'subslot:create', 'subslot:edit', 'subslot:delete', 'template:create', 'template:edit', 'template:delete', 'orbat:create', 'orbat:edit'];
type RolePatch = { name?: string; requiredTrainingIds?: number[]; requiredRankIds?: number[]; isRetired?: boolean };

export function parseRoleDefinition(body: unknown, creating: boolean): { data: RolePatch; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  const allowed = creating ? ['name', 'requiredTrainingIds', 'requiredRankIds'] : ['name', 'requiredTrainingIds', 'requiredRankIds', 'isRetired'];
  if (!creating && Object.keys(input).length === 0) return invalid('At least one field must be provided.');
  if (Object.keys(input).some(key => !allowed.includes(key))) return invalid('Unknown role definition fields.');
  if ((creating || input.name !== undefined) && (typeof input.name !== 'string' || !input.name.trim())) return invalid('name must be a non-empty string.');
  if (input.isRetired !== undefined && typeof input.isRetired !== 'boolean') return invalid('isRetired must be a boolean.');
  const data: RolePatch = {};
  if (typeof input.name === 'string') data.name = input.name.trim();
  if (typeof input.isRetired === 'boolean') data.isRetired = input.isRetired;
  for (const field of ['requiredTrainingIds', 'requiredRankIds'] as const) {
    const ids = input[field];
    if (ids === undefined) { if (creating) data[field] = []; continue; }
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || id > 2147483647)) return invalid(`${field} must be an array of positive integer IDs.`);
    data[field] = [...new Set(ids)];
  }
  return { data };
}

export async function validateRolePrerequisites(db: Pick<Prisma.TransactionClient, 'training' | 'rank'>, data: RolePatch): Promise<Response | null> {
  if (data.requiredTrainingIds?.length && await db.training.count({ where: { id: { in: data.requiredTrainingIds } } }) !== data.requiredTrainingIds.length) return apiError(422, 'validation_failed', 'One or more training prerequisite IDs do not exist.');
  if (data.requiredRankIds?.length && await db.rank.count({ where: { id: { in: data.requiredRankIds } } }) !== data.requiredRankIds.length) return apiError(422, 'validation_failed', 'One or more rank prerequisite IDs do not exist.');
  return null;
}

export async function enrichRoleDefinitions(db: Pick<Prisma.TransactionClient, 'training' | 'rank'>, roles: SquadRole[]) {
  const trainingIds = [...new Set(roles.flatMap(role => role.requiredTrainingIds))];
  const rankIds = [...new Set(roles.flatMap(role => role.requiredRankIds))];
  const [trainings, ranks] = await Promise.all([
    trainingIds.length ? db.training.findMany({ where: { id: { in: trainingIds } }, select: { id: true, name: true } }) : [],
    rankIds.length ? db.rank.findMany({ where: { id: { in: rankIds } }, select: { id: true, name: true, abbreviation: true, orderIndex: true } }) : [],
  ]);
  return roles.map(role => ({ ...role, requiredTrainings: role.requiredTrainingIds.flatMap(id => trainings.filter(item => item.id === id)), requiredRanks: role.requiredRankIds.flatMap(id => ranks.filter(item => item.id === id)) }));
}

export function roleDatabaseError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2002') return apiError(409, 'conflict', 'A role definition with this name already exists.');
    if (error.code === 'P2003') return apiError(409, 'conflict', 'This role definition is referenced by other records.');
    if (error.code === 'P2025') return apiError(404, 'not_found', 'Role definition not found.');
  }
  throw error;
}
