import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parsePositiveId } from '@/lib/api/validation';
import { parseTrainingCategoryBody, categoryMutationError } from '@/lib/api/training-categories';
import { writeApiAudit } from '@/lib/api/audit';

type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'training:edit', async (_principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid category id.');
    const parsed = parseTrainingCategoryBody(await readJsonBody(request), false);
    if (parsed.error) return parsed.error;
    if (parsed.data.swapWithCategoryId === id) return apiError(422, 'validation_failed', 'A category cannot swap with itself.');
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.trainingCategory.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Category not found.');
        const { swapWithCategoryId, ...changes } = parsed.data;
        if (swapWithCategoryId !== undefined) {
          const other = await tx.trainingCategory.findUnique({ where: { id: swapWithCategoryId } });
          if (!other) return apiError(404, 'not_found', 'Swap category not found.');
          const updated = [
            await tx.trainingCategory.update({ where: { id }, data: { orderIndex: other.orderIndex } }),
            await tx.trainingCategory.update({ where: { id: other.id }, data: { orderIndex: before.orderIndex } }),
          ];
          for (const [index, previous] of [before, other].entries()) {
            await writeApiAudit(tx, audit, { action: 'training_category.updated', resource: 'training_category', resourceId: String(previous.id), outcome: 'success', before: { orderIndex: previous.orderIndex }, after: { orderIndex: updated[index].orderIndex } });
          }
          return apiSuccess({ updated });
        }
        const after = await tx.trainingCategory.update({ where: { id }, data: changes });
        await writeApiAudit(tx, audit, { action: 'training_category.updated', resource: 'training_category', resourceId: String(id), outcome: 'success', before: { name: before.name, orderIndex: before.orderIndex }, after: { name: after.name, orderIndex: after.orderIndex } });
        return apiSuccess(after);
      });
    } catch (error) { return categoryMutationError(error); }
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleApiRequest(request, 'training:delete', async (_principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid category id.');
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.trainingCategory.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Category not found.');
        const trainings = await tx.training.findMany({ where: { categoryId: id }, select: { id: true } });
        await tx.training.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
        await tx.trainingCategory.delete({ where: { id } });
        await writeApiAudit(tx, audit, { action: 'training_category.deleted', resource: 'training_category', resourceId: String(id), outcome: 'success', before: { name: before.name, orderIndex: before.orderIndex, trainingIds: trainings.map(training => training.id) } });
        return apiSuccess(null);
      });
    } catch (error) { return categoryMutationError(error); }
  });
}
