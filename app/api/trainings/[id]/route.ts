import { validateQueryParameters, parsePositiveId } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { writeApiAudit } from '@/lib/api/audit';
import { parseTrainingBody, trainingDto, trainingCountInclude, trainingSnapshot, trainingDatabaseError } from '@/lib/api/trainings';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async () => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid training id.');
    const training = await prisma.training.findUnique({ where: { id }, include: trainingCountInclude });
    return training ? apiSuccess(trainingDto(training)) : apiError(404, 'not_found', 'Training not found.');
  });
}
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'training:edit', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid training id.');
    const parsed = parseTrainingBody(await readJsonBody(request), false);
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.training.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Training not found.');
        if (parsed.data.categoryId && !await tx.trainingCategory.findUnique({ where: { id: parsed.data.categoryId }, select: { id: true } })) return apiError(404, 'not_found', 'Training category not found.');
        const after = await tx.training.update({ where: { id }, data: parsed.data, include: trainingCountInclude });
        await writeApiAudit(tx, audit, { action: 'training.updated', resource: 'training', resourceId: String(id), outcome: 'success', before: trainingSnapshot(before), after: trainingSnapshot(after) });
        return apiSuccess(trainingDto(after));
      });
    } catch (error) { return trainingDatabaseError(error); }
  });
}
export async function DELETE(request: Request, context: Context) {
  return handleApiRequest(request, 'training:delete', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid training id.');
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.training.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Training not found.');
        if (await tx.trainingSession.count({ where: { trainingId: id } }) || await tx.trainingRequest.count({ where: { trainingId: id } })) return apiError(409, 'conflict', 'Training has sessions or requests and cannot be deleted.');
        const userTrainings = await tx.userTraining.findMany({ where: { trainingId: id }, select: { id: true, userId: true, statusHistory: { select: { id: true } } } });
        const rankRequirements = await tx.trainingRankRequirement.findMany({ where: { trainingId: id }, select: { id: true, minimumRankId: true } });
        const prerequisiteEdges = await tx.trainingTrainingRequirement.findMany({ where: { OR: [{ trainingId: id }, { requiredTrainingId: id }] }, select: { id: true, trainingId: true, requiredTrainingId: true } });
        const rankTransitionLinks = await tx.rankTransitionRequirement.findMany({ where: { requiredTrainings: { some: { id } } }, select: { id: true, targetRankId: true } });
        await tx.training.delete({ where: { id } });
        await writeApiAudit(tx, audit, { action: 'training.deleted', resource: 'training', resourceId: String(id), targetUserIds: userTrainings.map(row => row.userId), outcome: 'success', before: { ...trainingSnapshot(before), userTrainingIds: userTrainings.map(row => row.id), statusHistoryIds: userTrainings.flatMap(row => row.statusHistory.map(history => history.id)), rankRequirements, prerequisiteEdges, rankTransitionLinks } });
        return apiSuccess(null);
      });
    } catch (error) { return trainingDatabaseError(error); }
  });
}
