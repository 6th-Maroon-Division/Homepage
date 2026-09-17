import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parseCursorPagination } from '@/lib/api/validation';
import { parseTrainingCategoryBody, categoryMutationError } from '@/lib/api/training-categories';
import { writeApiAudit } from '@/lib/api/audit';

export async function GET(request: Request) {
  return handleApiRequest(request, undefined, async () => {
    const pagination = parseCursorPagination(new URL(request.url).searchParams, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const rows = await prisma.trainingCategory.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: limit + 1 });
    const data = rows.slice(0, limit);
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}

export async function POST(request: Request) {
  return handleApiRequest(request, 'training:create', async (_principal, audit) => {
    const parsed = parseTrainingCategoryBody(await readJsonBody(request), true);
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        const last = await tx.trainingCategory.findFirst({ orderBy: { orderIndex: 'desc' } });
        if (last?.orderIndex === 2147483647) return apiError(409, 'conflict', 'Category ordering limit reached.');
        const category = await tx.trainingCategory.create({ data: { name: parsed.data.name!, orderIndex: (last?.orderIndex ?? -1) + 1 } });
        await writeApiAudit(tx, audit, { action: 'training_category.created', resource: 'training_category', resourceId: String(category.id), outcome: 'success', after: { name: category.name, orderIndex: category.orderIndex } });
        return apiSuccess(category, { status: 201 });
      });
    } catch (error) { return categoryMutationError(error); }
  });
}
