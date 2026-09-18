import { prisma } from '@/lib/prisma';
import { handleApiRequest } from './handler';
import { hasApiPermission } from './permissions';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination } from './validation';
import { writeApiAudit } from './audit';
export function getOrbatManagement(request: Request) {
  return handleApiRequest(request, undefined, async (principal, context) => {
    if (!(['orbat:create', 'orbat:edit', 'orbat:delete'] as const).some(permission => hasApiPermission(principal.permissions, permission))) return apiError(403, 'forbidden', 'ORBAT management permission required.');
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['limit', 'cursor'].includes(key) || params.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Unknown or repeated query parameter.');
    const paging = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (paging.error !== undefined) return apiError(400, 'invalid_request', paging.error);
    const { limit, cursor } = paging.data;
    const rows = await prisma.orbat.findMany({ where: cursor ? { id: { lt: cursor } } : {}, orderBy: { id: 'desc' }, take: limit + 1, select: {
      id: true, name: true, description: true, startsAtUtc: true, endsAtUtc: true, eventDate: true, startTime: true, endTime: true, createdAt: true,
      createdBy: { select: { id: true, username: true } }, squads: { select: { _count: { select: { slots: true } }, slots: { select: { _count: { select: { signups: true } } } } } },
    } });
    const data = rows.slice(0, limit).map(row => ({
      id: row.id, name: row.name, description: row.description, startsAtUtc: row.startsAtUtc?.toISOString() ?? null,
      endsAtUtc: row.endsAtUtc?.toISOString() ?? null, eventDate: row.eventDate?.toISOString() ?? null,
      startTime: row.startTime, endTime: row.endTime, createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy ? { id: row.createdBy.id, username: row.createdBy.username || 'Unknown' } : null,
      slotCount: row.squads.length, totalSubslots: row.squads.reduce((sum, squad) => sum + squad._count.slots, 0),
      totalSignups: row.squads.reduce((sum, squad) => sum + squad.slots.reduce((count, slot) => count + slot._count.signups, 0), 0),
    }));
    const targetUserIds = [...new Set(data.flatMap(row => row.createdBy && (principal.kind === 'bot' || row.createdBy.id !== principal.userId) ? [row.createdBy.id] : []))];
    if (targetUserIds.length) await writeApiAudit(prisma, context, { action: 'user_data.read', resource: 'orbat_creator', targetUserIds, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
