import { validateQueryParameters, parseCursorPagination } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { parseUtcTimestamp } from '@/lib/api/utc';
import { shouldAuditUserRead, writeApiAudit } from '@/lib/api/audit';

export async function GET(request: Request) {
  return handleApiRequest(request, 'system:super_admin', async (principal, audit) => {
    const queryError = validateQueryParameters(request, ['limit', 'cursor', 'from', 'to']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const params = new URL(request.url).searchParams;
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const from = params.has('from') ? parseUtcTimestamp(params.get('from')) : null;
    const to = params.has('to') ? parseUtcTimestamp(params.get('to')) : null;
    if (params.has('from') && !from || params.has('to') && !to || from && to && from >= to) {
      return apiError(400, 'invalid_request', 'from and to must be explicit-timezone timestamps, with from before to.');
    }
    const { limit, cursor } = pagination.data;
    const rows = await prisma.apiAuditLog.findMany({
      where: {
        ...(cursor ? { id: { lt: cursor } } : {}),
        ...(from || to ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      },
      orderBy: { id: 'desc' }, take: limit + 1,
    });
    const data = rows.slice(0, limit);
    const targetUserIds = [...new Set(data.flatMap(row => [...row.targetUserIds, ...(row.actorUserId ? [row.actorUserId] : [])]))];
    if (shouldAuditUserRead(principal, targetUserIds)) {
      await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'audit_log', targetUserIds, outcome: 'success' });
    }
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
