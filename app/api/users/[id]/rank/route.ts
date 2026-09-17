import { readJsonBody } from '@/lib/api/request';
import { parsePositiveId } from '@/lib/api/validation';
import { canAccessApiUser } from '@/lib/api/auth';
import { parseUserRankMutation, userRankMutationError } from '@/lib/api/user-rank-mutations';
import { appendBotEvent } from '@/lib/bot-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
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
    try {
      const result = await prisma.$transaction(async tx => {
        if (!await canAccessApiUser(principal, userId, 'rank:manage_promotions', tx)) return { error: apiError(403, 'forbidden', 'Cannot manage this user’s rank.') };
        if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) return { error: apiError(404, 'not_found', 'User not found.') };
        const rank = await tx.rank.findUnique({ where: { id: parsed.data.rankId } });
        if (!rank) return { error: apiError(404, 'not_found', 'Rank not found.') };
        const before = await tx.userRank.findUnique({ where: { userId }, include: { currentRank: true } });
        const changeType = before?.currentRank && rank.orderIndex < before.currentRank.orderIndex ? 'demotion' : 'assignment';
        const attendanceTotal = await getCurrentAttendance(userId, tx);
        const now = new Date();
        const changes = { currentRankId: rank.id, lastRankedUpAt: now, attendanceSinceLastRank: attendanceTotal };
        const updated = await tx.userRank.upsert({ where: { userId }, create: { userId, ...changes }, update: changes, include: { currentRank: true } });
        const history = await tx.rankHistory.create({ data: {
          userId, previousRankName: before?.currentRank?.name ?? null, newRankName: rank.name,
          attendanceTotalAtChange: attendanceTotal, attendanceDeltaSinceLastRank: Math.max(0, attendanceTotal - (before?.attendanceSinceLastRank || 0)),
          triggeredBy: principal.kind === 'user' ? 'admin' : 'bot', triggeredByUserId: principal.kind === 'user' ? principal.userId : null,
          outcome: 'approved', note: parsed.data.reason ?? null,
        } });
        const discord = await tx.authAccount.findFirst({ where: { userId, provider: 'discord' }, select: { providerUserId: true } });
        await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: { rankHistoryId: history.id, userId, discordUserId: discord?.providerUserId ?? null, oldRankId: before?.currentRankId ?? null, newRankId: rank.id, changeType, source: 'direct_assignment' } }, tx);
        await writeApiAudit(tx, audit, { action: 'user_rank.updated', resource: 'user_rank', resourceId: String(userId), targetUserIds: [userId], outcome: 'success',
          before: { rankId: before?.currentRankId ?? null, attendanceSinceLastRank: before?.attendanceSinceLastRank ?? 0, lastRankedUpAt: before?.lastRankedUpAt.toISOString() ?? null },
          after: { rankId: rank.id, attendanceSinceLastRank: attendanceTotal, lastRankedUpAt: now.toISOString(), rankHistoryId: history.id, changeType, reason: parsed.data.reason ?? null },
        });
        return { data: { userId, currentRank: updated.currentRank, retired: updated.retired, interviewDone: updated.interviewDone, attendanceSinceLastRank: updated.attendanceSinceLastRank, attendanceTotal, attendanceDelta: attendanceTotal - (updated.attendanceSinceLastRank || 0), lastRankedUpAt: updated.lastRankedUpAt }, changeType };
      }, { isolationLevel: 'Serializable' });
      if (result.error) return result.error;
      try {
        publishUserProfileEvent(userId, { source: result.changeType === 'demotion' ? 'rank.demoted' : 'rank.assigned', rankId: parsed.data.rankId });
      } catch {
        console.error('Rank update notification failed', { correlationId: audit.correlationId, timestamp: new Date().toISOString() });
      }
      return apiSuccess(result.data);
    } catch (error) { return userRankMutationError(error); }
  });
}
