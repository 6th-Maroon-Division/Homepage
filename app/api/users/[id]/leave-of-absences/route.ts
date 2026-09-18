import { validateQueryParameters, parsePositiveId, parseCursorPagination } from '@/lib/api/validation';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { canAccessApiUser } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { writeApiAudit, shouldAuditUserRead } from '@/lib/api/audit';
import { parseLeaveBody, leaveSnapshot, leaveDatabaseError } from '@/lib/api/leave-of-absences';
import type { ApiPrincipal } from '@/lib/api/principal';
type Context = { params: Promise<{ id: string }> };
async function target(principal: ApiPrincipal, context: Context) {
  const { id } = await context.params;
  const userId = id === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(id);
  if (!userId || userId > 2147483647) return { error: apiError(400, 'invalid_request', 'Use a positive user id; me requires a user session.') } as const;
  if (!await canAccessApiUser(principal, userId, 'user:edit')) return { error: apiError(403, 'forbidden', 'Cannot access this user’s leave of absence.') } as const;
  if (!await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })) return { error: apiError(404, 'not_found', 'User not found.') } as const;
  return { userId } as const;
}
export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const queryError = validateQueryParameters(request, ['limit', 'cursor']);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const resolved = await target(principal, context);
    if (resolved.error) return resolved.error;
    const pagination = parseCursorPagination(new URL(request.url).searchParams, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { cursor, limit } = pagination.data;
    const rows = await prisma.leaveOfAbsence.findMany({ where: { userId: resolved.userId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: limit + 1 });
    const data = rows.slice(0, limit);
    if (shouldAuditUserRead(principal, [resolved.userId])) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'leave_of_absence', targetUserIds: [resolved.userId], outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}
export async function POST(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const queryError = validateQueryParameters(request, []);
    if (queryError) return apiError(400, 'invalid_request', queryError);
    const resolved = await target(principal, context);
    if (resolved.error) return resolved.error;
    const parsed = parseLeaveBody(await readJsonBody(request), true);
    if (parsed.error) return parsed.error;
    try {
      return await prisma.$transaction(async tx => {
        const created = await tx.leaveOfAbsence.create({ data: { ...parsed.data, startDate: parsed.data.startDate!, userId: resolved.userId } });
        await writeApiAudit(tx, audit, { action: 'leave_of_absence.created', resource: 'leave_of_absence', resourceId: String(created.id), targetUserIds: [resolved.userId], outcome: 'success', after: leaveSnapshot(created) });
        return apiSuccess(created, { status: 201 });
      });
    } catch (error) { return leaveDatabaseError(error); }
  });
}
