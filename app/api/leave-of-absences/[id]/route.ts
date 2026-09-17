import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { canAccessApiUser } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parsePositiveId } from '@/lib/api/validation';
import { writeApiAudit } from '@/lib/api/audit';
import { parseLeaveBody, leaveSnapshot, leaveDatabaseError } from '@/lib/api/leave-of-absences';
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const id = parsePositiveId((await context.params).id);
    if (!id || id > 2147483647) return apiError(400, 'invalid_request', 'Invalid leave-of-absence id.');
    const body = await readJsonBody(request);
    try {
      return await prisma.$transaction(async tx => {
        const before = await tx.leaveOfAbsence.findUnique({ where: { id } });
        if (!before) return apiError(404, 'not_found', 'Leave-of-absence entry not found.');
        if (!await canAccessApiUser(principal, before.userId, 'user:edit', tx)) return apiError(403, 'forbidden', 'Cannot manage this user’s leave of absence.');
        const parsed = parseLeaveBody(body, false, before.startDate);
        if (parsed.error) return parsed.error;
        const after = await tx.leaveOfAbsence.update({ where: { id }, data: parsed.data });
        await writeApiAudit(tx, audit, { action: 'leave_of_absence.updated', resource: 'leave_of_absence', resourceId: String(id), targetUserIds: [before.userId], outcome: 'success', before: leaveSnapshot(before), after: leaveSnapshot(after) });
        return apiSuccess(after);
      });
    } catch (error) { return leaveDatabaseError(error); }
  });
}
