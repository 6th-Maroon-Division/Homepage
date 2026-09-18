import { apiError } from './response';
export const discordRankSelect = {
  id: true, rankId: true, guildId: true, discordRoleId: true, isActive: true, createdAt: true, updatedAt: true,
  rank: { select: { id: true, name: true, abbreviation: true, orderIndex: true } },
} as const;
export function isDiscordId(value: unknown): value is string { return typeof value === 'string' && /^\d{17,20}$/.test(value); }
export function parseDiscordRoleBody(body: unknown): { data: { discordRoleId?: string; isActive?: boolean }; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  if (!Object.keys(input).length || Object.keys(input).some(key => !['discordRoleId', 'isActive'].includes(key))) return invalid('Provide discordRoleId and/or isActive only.');
  if (input.discordRoleId !== undefined && !isDiscordId(input.discordRoleId)) return invalid('discordRoleId must be a Discord snowflake string.');
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') return invalid('isActive must be a boolean.');
  return { data: { ...(typeof input.discordRoleId === 'string' ? { discordRoleId: input.discordRoleId } : {}), ...(typeof input.isActive === 'boolean' ? { isActive: input.isActive } : {}) } };
}
export function discordRoleSnapshot(value: { rankId: number; guildId: string; discordRoleId: string; isActive: boolean }) {
  return { rankId: value.rankId, guildId: value.guildId, discordRoleId: value.discordRoleId, isActive: value.isActive };
}
export function discordRoleDatabaseError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2025' || error.code === 'P2003') return apiError(404, 'not_found', 'Rank or Discord role mapping not found.');
    if (error.code === 'P2002') return apiError(409, 'conflict', 'This rank already has a mapping in this guild.');
  }
  throw error;
}
