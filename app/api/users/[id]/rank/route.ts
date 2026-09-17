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
