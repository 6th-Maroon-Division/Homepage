import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api/response';
import { discordApi, pagination, pageResult } from './shared';
export function configurationHistory(request: Request) {
  return discordApi(request, 'discord:configure', async () => {
    const {limit, cursor} = pagination(request);
    const rows = await prisma.discordConfigurationRevision.findMany({where: cursor ? {id: {lt: cursor}} : {}, orderBy: {id: 'desc'}, take: limit + 1});
    const page = pageResult(rows, limit);
    return apiSuccess(page.data, {meta: page.meta});
  });
}
