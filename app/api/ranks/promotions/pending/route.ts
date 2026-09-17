import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { parseCursorPagination } from '@/lib/api/validation';
import { writeApiAudit } from '@/lib/api/audit';
import { promotionVisibility, pendingPromotionSelect } from '@/lib/api/promotions';
export async function GET(request: Request) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, audit) => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Use only one limit and cursor parameter.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { cursor, limit } = pagination.data;
    const rows = await prisma.promotionProposal.findMany({ where: { status: 'pending', ...promotionVisibility(principal), ...(cursor ? { id: { lt: cursor } } : {}) }, select: pendingPromotionSelect, orderBy: { id: 'desc' }, take: limit + 1 });
    const page = rows.slice(0, limit);
    const rankIds = [...new Set(page.flatMap(row => [row.currentRankId, row.nextRankId]))];
    const ranks = rankIds.length ? await prisma.rank.findMany({ where: { id: { in: rankIds } }, select: { id: true, name: true, abbreviation: true } }) : [];
    const rankMap = new Map(ranks.map(rank => [rank.id, rank]));
    const data = page.map(({ user, ...row }) => ({ ...row, user: { id: user.id, username: user.username, discordId: user.accounts[0]?.providerUserId ?? null }, currentRank: rankMap.get(row.currentRankId) ?? null, nextRank: rankMap.get(row.nextRankId) ?? null }));
    const targetUserIds = [...new Set(data.filter(row => principal.kind === 'bot' || row.userId !== principal.userId).map(row => row.userId))];
    if (targetUserIds.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'promotion_proposal', targetUserIds, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
