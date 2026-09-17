import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { writeApiAudit } from '@/lib/api/audit';
import { parseRankReorder, rankDatabaseError } from '@/lib/api/ranks';
export async function PATCH(request: Request) {
  return handleApiRequest(request, 'rank:edit', async (_principal, audit) => {
    const parsed = parseRankReorder(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.rank.findMany({ where: { id: { in: parsed.data.map(row => row.id) } } });
        if (before.length !== parsed.data.length) return apiError(404, 'not_found', 'One or more ranks do not exist.');
        const previous = new Map(before.map(row => [row.id, row]));
        for (const item of parsed.data) {
          const after = await tx.rank.update({ where: { id: item.id }, data: { orderIndex: item.orderIndex } });
          await writeApiAudit(tx, audit, { action: 'rank.reordered', resource: 'rank', resourceId: String(item.id), outcome: 'success', before: { orderIndex: previous.get(item.id)!.orderIndex }, after: { orderIndex: after.orderIndex } });
        }
        return apiSuccess(null);
      });
    } catch (error) { return rankDatabaseError(error); }
  });
}
