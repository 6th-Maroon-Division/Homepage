import { readJsonBody } from '@/lib/api/request';
import { parsePositiveId } from '@/lib/api/validation';
import { parseUserRankMutation, updateUserRanks } from '@/lib/api/user-rank-mutations';
import { prisma } from '@/lib/prisma';
import { getCurrentAttendance } from '@/lib/rank-eligibility';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { resolveRankUser } from '@/lib/api/user-rank';
import { shouldAuditUserRead, writeApiAudit } from '@/lib/api/audit';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const target = await resolveRankUser(principal, context);
    if (target.error) return target.error;
    const userRank = await prisma.userRank.findUnique({ where: { userId: target.userId }, include: { currentRank: true } });
    if (!userRank) return apiError(404, 'not_found', 'User rank not found.');
    const attendanceTotal = await getCurrentAttendance(target.userId);
    const data = { userId: target.userId, currentRank: userRank.currentRank, retired: userRank.retired, interviewDone: userRank.interviewDone, attendanceSinceLastRank: userRank.attendanceSinceLastRank, attendanceTotal, attendanceDelta: attendanceTotal - (userRank.attendanceSinceLastRank || 0), lastRankedUpAt: userRank.lastRankedUpAt };
    if (shouldAuditUserRead(principal, [target.userId])) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'user_rank', resourceId: String(target.userId), targetUserIds: [target.userId], outcome: 'success' });
    return apiSuccess(data);
  });
}


export async function PATCH(request: Request, context: Context) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, audit) => {
    const { id } = await context.params;
    const userId = id === 'me' && principal.kind === 'user' ? principal.userId : parsePositiveId(id);
    if (!userId || userId > 2147483647) return apiError(400, 'invalid_request', 'Use a positive user id; me requires a user session.');
    const parsed = parseUserRankMutation(await readJsonBody(request));
    if (parsed.error) return parsed.error;
    const result = await updateUserRanks(principal, audit, [{ userId, ...parsed.data }]);
    return result.error ? result.error : apiSuccess(result.data![0]);
  });
}
