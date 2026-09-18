import { validateQueryParameters, parsePositiveId } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { writeApiAudit } from '@/lib/api/audit';
import { discordRankSelect, isDiscordId, parseDiscordRoleBody, discordRoleSnapshot, discordRoleDatabaseError } from '@/lib/api/rank-discord-roles';
type Context = { params: Promise<{ id: string }> };
async function target(request: Request, context: Context) {
  const rankId = parsePositiveId((await context.params).id);
  const guildId = new URL(request.url).searchParams.get('guildId');
  if (!rankId || rankId > 2147483647) return { error: apiError(400, 'invalid_request', 'Invalid rank id.') } as const;
  if (!isDiscordId(guildId)) return { error: apiError(400, 'invalid_request', 'guildId must be a Discord snowflake string.') } as const;
  return { rankId, guildId } as const;
}
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'rank:edit', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, ['guildId']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const ids = await target(request, context);
    if (ids.error) return ids.error;
    const parsed = parseDiscordRoleBody(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        if (!await tx.rank.findUnique({ where: { id: ids.rankId }, select: { id: true } })) return apiError(404, 'not_found', 'Rank not found.');
        const where = { rankId_guildId: { rankId: ids.rankId, guildId: ids.guildId } };
        const before = await tx.rankDiscordRole.findUnique({ where });
        if (!before && !parsed.data.discordRoleId) return apiError(422, 'validation_failed', 'discordRoleId is required to create a mapping.');
        const after = before
          ? await tx.rankDiscordRole.update({ where, data: parsed.data, select: discordRankSelect })
          : await tx.rankDiscordRole.create({ data: { rankId: ids.rankId, guildId: ids.guildId, discordRoleId: parsed.data.discordRoleId!, ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}) }, select: discordRankSelect });
        await writeApiAudit(tx, audit, { action: before ? 'rank_discord_role.updated' : 'rank_discord_role.created', resource: 'rank_discord_role', resourceId: String(after.id), outcome: 'success', ...(before ? { before: discordRoleSnapshot(before) } : {}), after: discordRoleSnapshot(after) });
        return apiSuccess(after);
      });
    } catch (error) { return discordRoleDatabaseError(error); }
  });
}
export async function DELETE(request: Request, context: Context) {
  return handleApiRequest(request, 'rank:edit', async (_principal, audit) => {
    const queryError = validateQueryParameters(request, ['guildId']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const ids = await target(request, context);
    if (ids.error) return ids.error;
    try {
      return await prisma.$transaction(async tx => {
        const where = { rankId_guildId: { rankId: ids.rankId, guildId: ids.guildId } };
        const before = await tx.rankDiscordRole.findUnique({ where });
        if (!before) return apiError(404, 'not_found', 'Discord role mapping not found.');
        await tx.rankDiscordRole.delete({ where });
        await writeApiAudit(tx, audit, { action: 'rank_discord_role.deleted', resource: 'rank_discord_role', resourceId: String(before.id), outcome: 'success', before: discordRoleSnapshot(before) });
        return apiSuccess(null);
      });
    } catch (error) { return discordRoleDatabaseError(error); }
  });
}
