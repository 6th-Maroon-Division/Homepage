import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { parseCursorPagination } from '@/lib/api/validation';
import { resolveRankUser, rankHistorySelect } from '@/lib/api/user-rank';
import { shouldAuditUserRead, writeApiAudit } from '@/lib/api/audit';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const target = await resolveRankUser(principal, context);
    if (target.error) return target.error;
    const params = new URL(request.url).searchParams;
    if (params.has('page')) return apiError(400, 'invalid_request', 'Use cursor pagination instead of page.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { cursor, limit } = pagination.data;
    const rows = await prisma.rankHistory.findMany({ where: { userId: target.userId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: limit + 1, select: rankHistorySelect });
    const data = rows.slice(0, limit);
    if (shouldAuditUserRead(principal, [target.userId])) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'rank_history', resourceId: String(target.userId), targetUserIds: [target.userId], outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
