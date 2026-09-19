import { executeAutomaticPromotions } from '@/lib/jobs/promotions';
import { prisma } from '@/lib/prisma';
import { canAccessApiUser } from './auth';
import { writeApiAudit } from './audit';
import { handleApiRequest } from './handler';
import { promotionVisibility } from './promotions';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination, parsePositiveId } from './validation';

export async function listAutomaticPromotions(request: Request) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, context) => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['days', 'limit', 'cursor'].includes(key) || params.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Use only one days, limit and cursor parameter.');
    const days = params.has('days') ? parsePositiveId(params.get('days')) : 7;
    if (days === null || days > 3650) return apiError(400, 'invalid_request', 'days must be an integer from 1 to 3650.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const rows = await prisma.rankHistory.findMany({ where: {
      user: promotionVisibility(principal).user,
      createdAt: { gte: new Date(Date.now() - days * 86400000) }, triggeredBy: { contains: 'auto', mode: 'insensitive' },
      ...(cursor ? { id: { lt: cursor } } : {}),
    }, select: { id: true, userId: true, previousRankName: true, newRankName: true, createdAt: true, triggeredBy: true, outcome: true,
      user: { select: { id: true, username: true, accounts: { where: { provider: 'discord' }, orderBy: { id: 'asc' }, take: 1, select: { providerUserId: true } } } },
    }, orderBy: { id: 'desc' }, take: limit + 1 });
    const data = rows.slice(0, limit).map(row => ({ id: row.id, userId: row.userId, previousRankName: row.previousRankName, newRankName: row.newRankName, createdAt: row.createdAt.toISOString(), triggeredBy: row.triggeredBy, outcome: row.outcome, user: { id: row.user.id, username: row.user.username, discordId: row.user.accounts[0]?.providerUserId ?? null } }));
    const targetUserIds = [...new Set(data.filter(row => principal.kind === 'bot' || row.userId !== principal.userId).map(row => row.userId))];
    if (targetUserIds.length) await writeApiAudit(prisma, context, { action: 'user_data.read', resource: 'rank_history', targetUserIds, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}

export async function runAutomaticPromotions(request: Request) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, context) => {
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'No query parameters supported.');
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return apiError(422, 'validation_failed', 'Use an empty JSON object.');
    const counts = await executeAutomaticPromotions(context, { userFilter: promotionVisibility(principal).user, authorize: (userId, tx) => canAccessApiUser(principal, userId, 'rank:manage_promotions', tx) });
    return apiSuccess(counts);
  });
}
