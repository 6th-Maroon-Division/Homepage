import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { botOnly, discordApi, pagination, pageResult } from './shared';

/** Enumerate persisted messages so a restarted bot can reconcile announcements. */
export function announcementList(request: Request) {
  return discordApi(request, undefined, async principal => {
    botOnly(principal);
    const { cursor, limit } = pagination(request);
    const rows = await prisma.discordAnnouncement.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: { id: true, orbatId: true, channelId: true, mention: true, missionText: true, messageId: true, updatedAt: true, renderedRevision: true, lastRenderedAt: true, missingAt: true },
    });
    const page = pageResult(rows, limit);
    return apiSuccess(page.data, { meta: page.meta });
  });
}
