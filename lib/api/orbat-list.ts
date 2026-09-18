import { prisma } from '@/lib/prisma';
import { handlePublicApiRequest } from './handler';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination } from './validation';
export async function getPublicOrbatList(request: Request) {
  return handlePublicApiRequest(request, async () => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Use only one limit and cursor parameter.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const rows = await prisma.orbat.findMany({ where: cursor ? { id: { lt: cursor } } : {}, orderBy: { id: 'desc' }, take: limit + 1, select: { id: true, name: true } });
    const data = rows.slice(0, limit);
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
