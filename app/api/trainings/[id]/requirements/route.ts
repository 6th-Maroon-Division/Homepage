import { validateQueryParameters, parsePositiveId } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { hasApiPermission } from '@/lib/api/permissions';
import { writeApiAudit } from '@/lib/api/audit';
import { parseTrainingRequirements, introducesTrainingCycle, readTrainingRequirements, requirementsSnapshot, requirementsDatabaseError } from '@/lib/api/training-requirements';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async () => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid training id.');
    const requirements = await readTrainingRequirements(prisma, id);
    if (!requirements) return apiError(404, 'not_found', 'Training not found.');
    return apiSuccess(requirements);
  });
}
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'training:edit', async (principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid training id.');
    const parsed = parseTrainingRequirements(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    if (parsed.data.minimumRankId === null && !hasApiPermission(principal.permissions, 'system:super_admin')) return apiError(403, 'forbidden', 'Only superadmins can clear minimum rank requirements.');
    try {
      return await prisma.$transaction(async tx => {
        const before = await readTrainingRequirements(tx, id);
        if (!before) return apiError(404, 'not_found', 'Training not found.');
        if (parsed.data.minimumRankId !== undefined && parsed.data.minimumRankId !== null && !await tx.rank.findUnique({ where: { id: parsed.data.minimumRankId }, select: { id: true } })) return apiError(404, 'not_found', 'Rank not found.');
        const requiredIds = parsed.data.requiredTrainingIds;
        if (requiredIds !== undefined) {
          if (requiredIds.includes(id)) return apiError(422, 'validation_failed', 'Training cannot require itself.');
          if (requiredIds.length && await tx.training.count({ where: { id: { in: requiredIds } } }) !== requiredIds.length) return apiError(404, 'not_found', 'One or more required trainings do not exist.');
          if (requiredIds.length) {
            const edges = await tx.trainingTrainingRequirement.findMany({ select: { trainingId: true, requiredTrainingId: true } });
            if (introducesTrainingCycle(id, requiredIds, edges)) return apiError(409, 'conflict', 'These prerequisites would create a circular dependency.');
          }
        }
        if (parsed.data.minimumRankId === null) await tx.trainingRankRequirement.deleteMany({ where: { trainingId: id } });
        else if (parsed.data.minimumRankId !== undefined) await tx.trainingRankRequirement.upsert({ where: { trainingId: id }, create: { trainingId: id, minimumRankId: parsed.data.minimumRankId }, update: { minimumRankId: parsed.data.minimumRankId } });
        if (requiredIds !== undefined) {
          await tx.trainingTrainingRequirement.deleteMany({ where: { trainingId: id } });
          if (requiredIds.length) await tx.trainingTrainingRequirement.createMany({ data: requiredIds.map(requiredTrainingId => ({ trainingId: id, requiredTrainingId })) });
        }
        const after = (await readTrainingRequirements(tx, id))!;
        await writeApiAudit(tx, audit, { action: 'training_requirements.updated', resource: 'training_requirements', resourceId: String(id), outcome: 'success', before: requirementsSnapshot(before), after: requirementsSnapshot(after) });
        return apiSuccess(after);
      }, { isolationLevel: 'Serializable' });
    } catch (error) { return requirementsDatabaseError(error); }
  });
}
