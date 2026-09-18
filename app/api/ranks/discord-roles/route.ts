import { validateQueryParameters, parseCursorPagination } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { discordRankSelect, isDiscordId } from '@/lib/api/rank-discord-roles';
export async function GET(request: Request) {
  return handleApiRequest(request, 'rank:edit', async () => {
    const queryError = validateQueryParameters(request, ['limit', 'cursor', 'guildId', 'activeOnly']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const params = new URL(request.url).searchParams;
    const guildId = params.get('guildId');
    if (!isDiscordId(guildId)) return apiError(400, 'invalid_request', 'guildId must be a Discord snowflake string.');
    const activeOnly = params.get('activeOnly');
    if (activeOnly !== null && activeOnly !== 'true' && activeOnly !== 'false') return apiError(400, 'invalid_request', 'activeOnly must be true or false.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { cursor, limit } = pagination.data;
    const rows = await prisma.rankDiscordRole.findMany({ where: { guildId, ...(activeOnly === 'true' ? { isActive: true } : {}), ...(cursor ? { id: { gt: cursor } } : {}) }, select: discordRankSelect, orderBy: { id: 'asc' }, take: limit + 1 });
    const data = rows.slice(0, limit);
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
