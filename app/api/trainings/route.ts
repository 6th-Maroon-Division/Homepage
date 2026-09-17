import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parsePositiveId, parseCursorPagination } from '@/lib/api/validation';
import { writeApiAudit } from '@/lib/api/audit';
import { parseTrainingBody, trainingDto, trainingCountInclude, trainingSnapshot, trainingDatabaseError } from '@/lib/api/trainings';
export async function GET(request: Request) {
  return handleApiRequest(request, undefined, async () => {
    const params = new URL(request.url).searchParams;
    const activeOnly = params.get('activeOnly');
    if (activeOnly !== null && activeOnly !== 'true' && activeOnly !== 'false') return apiError(400, 'invalid_request', 'activeOnly must be true or false.');
    const categoryId = params.has('categoryId') ? parsePositiveId(params.get('categoryId')) : null;
    if (params.has('categoryId') && (!categoryId || categoryId > 2147483647)) return apiError(400, 'invalid_request', 'Invalid categoryId.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { cursor, limit } = pagination.data;
    const rows = await prisma.training.findMany({ where: { ...(activeOnly === 'true' ? { isActive: true } : {}), ...(categoryId ? { categoryId } : {}), ...(cursor ? { id: { gt: cursor } } : {}) }, include: trainingCountInclude, orderBy: { id: 'asc' }, take: limit + 1 });
    const data = rows.slice(0, limit).map(trainingDto);
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
export async function POST(request: Request) {
  return handleApiRequest(request, 'training:create', async (_principal, audit) => {
    const parsed = parseTrainingBody(await readJsonBody(request), true);
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        if (parsed.data.categoryId && !await tx.trainingCategory.findUnique({ where: { id: parsed.data.categoryId }, select: { id: true } })) return apiError(404, 'not_found', 'Training category not found.');
        const created = await tx.training.create({ data: { ...parsed.data, name: parsed.data.name! }, include: trainingCountInclude });
        await writeApiAudit(tx, audit, { action: 'training.created', resource: 'training', resourceId: String(created.id), outcome: 'success', after: trainingSnapshot(created) });
        return apiSuccess(trainingDto(created), { status: 201 });
      });
    } catch (error) { return trainingDatabaseError(error); }
  });
}
