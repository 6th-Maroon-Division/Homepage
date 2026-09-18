import type { Prisma } from '@/generated/prisma/client';
import { parseOrbatTimeRange } from './bot-query-validation';
import { prisma } from '@/lib/prisma';
import { handlePublicApiRequest } from './handler';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination } from './validation';
export async function getPublicOrbatList(request: Request) {
  return handlePublicApiRequest(request, async () => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['limit', 'cursor', 'includePast', 'startAt', 'endBefore'].includes(key) || params.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Unknown or repeated query parameter.');
    if (params.has('includePast') && !['true', 'false'].includes(params.get('includePast')!)) return apiError(400, 'invalid_request', 'includePast must be true or false.');
    const range = parseOrbatTimeRange(params);
    if (range.error !== undefined) return apiError(400, 'invalid_request', range.error);
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const where: Prisma.OrbatWhereInput = cursor ? { id: { lt: cursor } } : {};
    const { startAt, endBefore } = range.data;
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const lower = startAt ?? (params.get('includePast') === 'false' ? today : null);
    if (lower || endBefore) {
      const dates = { ...(lower ? { gte: lower } : {}), ...(endBefore ? { lt: endBefore } : {}) };
      where.OR = [{ startsAtUtc: dates }, { startsAtUtc: null, eventDate: dates }];
    }
    const rows = await prisma.orbat.findMany({ where, orderBy: { id: 'desc' }, take: limit + 1, select: { id: true, name: true } });
    const data = rows.slice(0, limit);
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
