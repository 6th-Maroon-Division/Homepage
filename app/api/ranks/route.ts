import { validateQueryParameters, parseCursorPagination } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { writeApiAudit } from '@/lib/api/audit';
import { parseRankBody, rankSnapshot, rankDatabaseError } from '@/lib/api/ranks';
export async function GET(request: Request) {
  return handleApiRequest(request, undefined, async () => {
    const queryError = validateQueryParameters(request, ['limit', 'cursor']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const pagination = parseCursorPagination(new URL(request.url).searchParams, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { cursor, limit } = pagination.data;
    const rows = await prisma.rank.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: limit + 1 });
    const data = rows.slice(0, limit);
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
export async function POST(request: Request) {
  return handleApiRequest(request, 'rank:create', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const parsed = parseRankBody(await readJsonBody(request), true);
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        const rank = await tx.rank.create({ data: { ...parsed.data, name: parsed.data.name!, abbreviation: parsed.data.abbreviation!, orderIndex: parsed.data.orderIndex! } });
        await writeApiAudit(tx, audit, { action: 'rank.created', resource: 'rank', resourceId: String(rank.id), outcome: 'success', after: rankSnapshot(rank) });
        return apiSuccess(rank, { status: 201 });
      });
    } catch (error) { return rankDatabaseError(error); }
  });
}
