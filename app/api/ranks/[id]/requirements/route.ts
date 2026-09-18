import { validateQueryParameters, parsePositiveId } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { writeApiAudit } from '@/lib/api/audit';
import { parseRankRequirements, rankRequirementsSelect, rankRequirementsDto, rankRequirementsDatabaseError } from '@/lib/api/rank-requirements';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, 'rank:edit', async () => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid rank id.');
    if (!await prisma.rank.findUnique({ where: { id }, select: { id: true } })) return apiError(404, 'not_found', 'Rank not found.');
    const requirement = await prisma.rankTransitionRequirement.findUnique({ where: { targetRankId: id }, select: rankRequirementsSelect });
    return apiSuccess(rankRequirementsDto(requirement));
  });
}
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'rank:edit', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid rank id.');
    const parsed = parseRankRequirements(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        if (!await tx.rank.findUnique({ where: { id }, select: { id: true } })) return apiError(404, 'not_found', 'Rank not found.');
        if (parsed.data.length && await tx.training.count({ where: { id: { in: parsed.data } } }) !== parsed.data.length) return apiError(404, 'not_found', 'One or more required trainings do not exist.');
        const before = rankRequirementsDto(await tx.rankTransitionRequirement.findUnique({ where: { targetRankId: id }, select: rankRequirementsSelect }));
        const links = parsed.data.map(trainingId => ({ id: trainingId }));
        const after = rankRequirementsDto(await tx.rankTransitionRequirement.upsert({ where: { targetRankId: id }, create: { targetRankId: id, requiredTrainings: { connect: links } }, update: { requiredTrainings: { set: links } }, select: rankRequirementsSelect }));
        await writeApiAudit(tx, audit, { action: 'rank_requirements.updated', resource: 'rank_requirements', resourceId: String(id), outcome: 'success', before: { requiredTrainingIds: before.requiredTrainingIds }, after: { requiredTrainingIds: after.requiredTrainingIds } });
        return apiSuccess(after);
      }, { isolationLevel: 'Serializable' });
    } catch (error) { return rankRequirementsDatabaseError(error); }
  });
}
