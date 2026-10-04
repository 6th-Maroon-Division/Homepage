import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { discordApi, pagination, pageResult } from './shared';

/** References remain readable when a menu is removed; deletion does not revoke roles. */
export function menuMessages(request: Request) {
  return discordApi(request, 'discord:configure', async () => {
    const { limit, cursor } = pagination(request);
    const rows = await prisma.discordRoleMenuMessage.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' }, take: limit + 1,
    });
    const page = pageResult(rows, limit);
    return apiSuccess(page.data.map(row => ({
      id: row.id, menuId: row.menuId, channelId: row.channelId,
      messageId: row.messageId, lastCommandId: row.lastCommandId,
      updatedAt: row.updatedAt.toISOString(),
    })), { meta: page.meta });
  });
}
