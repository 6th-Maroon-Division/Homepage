import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { hasApiPermission } from '@/lib/api/permissions';
import { snowflake } from '@/lib/discord/config';
import { body, botOnly, discordApi, fail, instant, int, integration, pagination, pageResult, query, transaction } from './shared';

const kinds = ['join.roles', 'welcome', 'menu.roles', 'rank.sync', 'nickname.sync'];
const statuses = ['succeeded', 'failed', 'cancelled', 'skipped'];
const identifier = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);

export function operations(request: Request, method: 'GET' | 'POST') {
  return discordApi(request, undefined, async (principal, audit) => {
    if (method === 'GET') {
      if (!hasApiPermission(principal.permissions, 'discord:view') && !hasApiPermission(principal.permissions, 'discord:configure')) fail(403, 'Requires Discord view or configuration access.');
      const { limit, cursor } = pagination(request, ['kind', 'status']);
      const params = new URL(request.url).searchParams;
      const kind = params.get('kind'), status = params.get('status');
      if (kind !== null && !kinds.includes(kind) || status !== null && !statuses.includes(status)) fail(400, 'Invalid operation kind or status.');
      const rows = await prisma.discordOperation.findMany({
        where: { ...(cursor ? { id: { lt: cursor } } : {}), ...(kind ? { kind } : {}), ...(status ? { status } : {}) },
        orderBy: { id: 'desc' }, take: limit + 1,
      });
      const page = pageResult(rows, limit);
      await writeApiAudit(prisma, audit, { action: 'discord.operations.read', resource: 'discord_operation', outcome: 'success' });
      return apiSuccess(page.data, { meta: page.meta });
    }
    botOnly(principal);
    query(request);
    const input = await body(request, ['eventId', 'guildId', 'configRevision', 'kind', 'status', 'attempts', 'memberId', 'channelId', 'roleId', 'menuId', 'errorCode', 'occurredAt'], 4096);
    if (!identifier(input.eventId, 128) || !snowflake(input.guildId) || !int(input.configRevision, 1) || !kinds.includes(String(input.kind)) || !statuses.includes(String(input.status)) || !int(input.attempts, 1, input.kind === 'join.roles' ? 3 : 6)) fail(422, 'Invalid operation report.');
    for (const field of ['memberId', 'channelId', 'roleId']) {
      if (input[field] !== undefined && !snowflake(input[field])) fail(422, 'Invalid Discord resource identifier.');
    }
    if (input.menuId !== undefined && !identifier(input.menuId, 80)) fail(422, 'Invalid menu identifier.');
    if (input.errorCode !== undefined && !identifier(input.errorCode, 80)) fail(422, 'Use a bounded error code, not an error message.');
    if ((input.status === 'failed') !== (input.errorCode !== undefined)) fail(422, 'Only failed operations require an error code.');
    const occurredAt = instant(input.occurredAt);
    if (occurredAt.getTime() > Date.now() + 60000) fail(422, 'Operation cannot be in the future.');
    const data = {
      eventId: String(input.eventId), guildId: String(input.guildId), configRevision: Number(input.configRevision),
      kind: String(input.kind), status: String(input.status), attempts: Number(input.attempts), occurredAt,
      memberId: input.memberId === undefined ? null : String(input.memberId),
      channelId: input.channelId === undefined ? null : String(input.channelId),
      roleId: input.roleId === undefined ? null : String(input.roleId),
      menuId: input.menuId === undefined ? null : String(input.menuId),
      errorCode: input.errorCode === undefined ? null : String(input.errorCode),
    };
    const result = await transaction(async tx => {
      const existing = await tx.discordOperation.findUnique({ where: { eventId: data.eventId } });
      if (existing) {
        if (Object.entries(data).some(([key, value]) => key === 'occurredAt'
          ? existing.occurredAt.getTime() !== occurredAt.getTime()
          : existing[key as keyof typeof existing] !== value)) fail(409, 'Event ID already belongs to a different report.');
        return { row: existing, created: false };
      }
      const { row, settings } = await integration(tx);
      if (!row || settings.guildId !== data.guildId) fail(409, 'Report does not match the configured server.');
      // Delayed reports remain useful after a configuration change; future revisions are impossible.
      if (data.configRevision > row!.revision) fail(409, 'Report references an unknown configuration revision.');
      const operation = await tx.discordOperation.create({ data });
      await writeApiAudit(tx, audit, { action: 'discord.operation.reported', resource: 'discord_operation', resourceId: String(operation.id), outcome: 'success', after: { kind: operation.kind, status: operation.status, configRevision: operation.configRevision } });
      return { row: operation, created: true };
    });
    return apiSuccess(result.row, { status: result.created ? 201 : 200 });
  });
}
