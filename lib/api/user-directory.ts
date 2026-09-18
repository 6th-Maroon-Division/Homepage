import type { Prisma } from '@/generated/prisma/client';
import type { ApiPrincipal } from './principal';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from './handler';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination } from './validation';
import { writeApiAudit } from './audit';

export function userVisibility(principal: ApiPrincipal): Prisma.UserWhereInput {
  if ((principal.permissions['system:super_admin'] ?? 0) > 0) return {};
  return { OR: [
    { id: principal.kind === 'user' ? principal.userId : -1 },
    { userPermissions: { none: { OR: [
      { permission: { key: 'system:super_admin' }, value: { gt: 0 } },
      { permission: { key: 'user:manage' }, value: { gte: principal.permissions['user:manage'] ?? 0 } },
    ] } } },
  ] };
}
export const directorySelect = {
  id: true, username: true, email: true, avatarUrl: true, createdAt: true,
  accounts: { orderBy: { id: 'asc' as const }, select: { provider: true, providerUserId: true } },
  userRank: { select: { retired: true, currentRank: { select: { id: true, name: true, abbreviation: true } } } },
} satisfies Prisma.UserSelect;
export async function getUserDirectory(request: Request) {
  return handleApiRequest(request, 'user:manage', async (principal, context) => {
    const params = new URL(request.url).searchParams;
    const keys = ['limit', 'cursor', 'activeOnly', 'hasDiscord', 'hasSteam', 'discordId', 'steamId'];
    if ([...params.keys()].some(key => !keys.includes(key) || params.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Unknown or repeated query parameter.');
    for (const key of ['activeOnly', 'hasDiscord', 'hasSteam']) {
      if (params.has(key) && !['true', 'false'].includes(params.get(key)!)) return apiError(400, 'invalid_request', `${key} must be true or false.`);
    }
    for (const key of ['discordId', 'steamId']) {
      if (params.has(key) && !/^[0-9]{1,32}$/.test(params.get(key)!)) return apiError(400, 'invalid_request', `${key} must be a decimal string.`);
    }
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const filters: Prisma.UserWhereInput[] = [userVisibility(principal)];
    if (cursor) filters.push({ id: { gt: cursor } });
    if (params.get('activeOnly') === 'true') filters.push({ OR: [{ userRank: null }, { userRank: { retired: false } }] });
    for (const [provider, presence, lookup] of [['discord', 'hasDiscord', 'discordId'], ['steam', 'hasSteam', 'steamId']] as const) {
      if (params.get(presence) === 'true' || params.has(lookup)) filters.push({ accounts: { some: { provider, ...(params.has(lookup) ? { providerUserId: params.get(lookup)! } : {}) } } });
    }
    const rows = await prisma.user.findMany({ where: { AND: filters }, select: directorySelect, orderBy: { id: 'asc' }, take: limit + 1 });
    const data = rows.slice(0, limit).map(user => ({
      id: user.id, username: user.username, email: user.email, avatarUrl: user.avatarUrl,
      createdAt: user.createdAt.toISOString(), isRetired: user.userRank?.retired ?? false,
      currentRank: user.userRank?.currentRank ?? null,
      discordId: user.accounts.find(account => account.provider === 'discord')?.providerUserId ?? null,
      steamId: user.accounts.find(account => account.provider === 'steam')?.providerUserId ?? null,
    }));
    const targetUserIds = data.filter(user => principal.kind !== 'user' || user.id !== principal.userId).map(user => user.id);
    if (targetUserIds.length) await writeApiAudit(prisma, context, { action: 'user.read', resource: 'user', outcome: 'success', targetUserIds });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
