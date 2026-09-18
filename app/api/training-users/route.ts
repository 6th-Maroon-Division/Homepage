import { validateQueryParameters, parseCursorPagination } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { TRAINING_STAFF_PERMISSION_KEYS } from '@/lib/training-staff';
import { handleApiRequest } from '@/lib/api/handler';
import { hasApiPermission } from '@/lib/api/permissions';
import { apiError, apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
export async function GET(request: Request) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const queryError = validateQueryParameters(request, ['limit', 'cursor', 'staffOnly']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    if (!TRAINING_STAFF_PERMISSION_KEYS.some(permission => hasApiPermission(principal.permissions, permission))) return apiError(403, 'forbidden', 'Training staff access is required.');
    const params = new URL(request.url).searchParams;
    const staffOnly = params.get('staffOnly');
    if (staffOnly !== null && staffOnly !== 'true' && staffOnly !== 'false') return apiError(400, 'invalid_request', 'staffOnly must be true or false.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const qualifyingGrant = { value: { gt: 0 }, permission: { key: { in: [...TRAINING_STAFF_PERMISSION_KEYS] } } };
    const rows = await prisma.user.findMany({
      where: { ...(staffOnly === 'true' ? { userPermissions: { some: qualifyingGrant } } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, username: true, avatarUrl: true, userPermissions: { where: qualifyingGrant, select: { id: true } } },
      orderBy: { id: 'asc' }, take: limit + 1,
    });
    const data = rows.slice(0, limit).map(user => ({ id: user.id, username: user.username, avatarUrl: user.avatarUrl, isTrainer: user.userPermissions.length > 0 }));
    const targetUserIds = data.filter(user => principal.kind === 'bot' || user.id !== principal.userId).map(user => user.id);
    if (targetUserIds.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'training_user', targetUserIds, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
