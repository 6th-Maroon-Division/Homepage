import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parsePositiveId } from '@/lib/api/validation';
import { writeApiAudit } from '@/lib/api/audit';
import { parseRankBody, rankSnapshot, rankDatabaseError } from '@/lib/api/ranks';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'rank:edit', async (_principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid rank id.');
    const parsed = parseRankBody(await readJsonBody(request), false);
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.rank.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Rank not found.');
        const after = await tx.rank.update({ where: { id }, data: parsed.data });
        await writeApiAudit(tx, audit, { action: 'rank.updated', resource: 'rank', resourceId: String(id), outcome: 'success', before: rankSnapshot(before), after: rankSnapshot(after) });
        return apiSuccess(after);
      });
    } catch (error) { return rankDatabaseError(error); }
  });
}
export async function DELETE(request: Request, context: Context) {
  return handleApiRequest(request, 'rank:delete', async (_principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid rank id.');
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.rank.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Rank not found.');
        if (await tx.userRank.count({ where: { currentRankId: id } })) return apiError(409, 'conflict', 'Cannot delete a rank currently assigned to users.');
        const affectedDiscordMappings = await tx.rankDiscordRole.findMany({ where: { rankId: id }, select: { id: true, guildId: true, discordRoleId: true, isActive: true } });
        const detachedTrainingRequirements = await tx.trainingRankRequirement.findMany({ where: { minimumRankId: id }, select: { id: true, trainingId: true, minimumRankId: true } });
        const transitions = await tx.rankTransitionRequirement.findMany({ where: { targetRankId: id }, select: { id: true, targetRankId: true, requiredTrainings: { select: { id: true } } } });
        const deletedTransitionRequirements = transitions.map(row => ({ id: row.id, targetRankId: row.targetRankId, requiredTrainingIds: row.requiredTrainings.map(training => training.id) }));
        await tx.rank.delete({ where: { id } });
        await writeApiAudit(tx, audit, { action: 'rank.deleted', resource: 'rank', resourceId: String(id), outcome: 'success', before: { ...rankSnapshot(before), affectedDiscordMappings, detachedTrainingRequirements, deletedTransitionRequirements } });
        return apiSuccess(null);
      });
    } catch (error) { return rankDatabaseError(error); }
  });
}
