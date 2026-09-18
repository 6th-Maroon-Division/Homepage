import { prisma } from '@/lib/prisma';
import { getCurrentAttendance } from '@/lib/rank-eligibility';
import { appendBotEvent } from '@/lib/bot-events';
import { publishInboxEvent } from '@/lib/realtime/inbox-events';
import { publishPromotionEvent } from '@/lib/realtime/promotion-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { canAccessApiUser } from './auth';
import { writeApiAudit } from './audit';
import { handleApiRequest } from './handler';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
import { parsePositiveId } from './validation';

export type PromotionDecision = 'approved' | 'declined';
export async function decidePromotion(request: Request, idValue: string, decision: PromotionDecision) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, context) => {
    const id = parsePositiveId(idValue);
    if (!id || id > 2147483647 || new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Use a positive 32-bit proposal id and no query parameters.');
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => decision === 'approved' || key !== 'declineReason')) return apiError(422, 'validation_failed', decision === 'approved' ? 'Approval requires an empty object.' : 'Use only declineReason.');
    const reasonValue = (body as { declineReason?: unknown }).declineReason;
    if (reasonValue !== undefined && reasonValue !== null && typeof reasonValue !== 'string') return apiError(422, 'validation_failed', 'declineReason must be a string or null.');
    const declineReason = typeof reasonValue === 'string' ? reasonValue.trim() || null : null;
    try {
      const result = await prisma.$transaction(async tx => {
        const proposal = await tx.promotionProposal.findUnique({ where: { id } });
        if (!proposal) return { error: apiError(404, 'not_found', 'Promotion proposal not found.') };
        if (!(await canAccessApiUser(principal, proposal.userId, 'rank:manage_promotions', tx))) return { error: apiError(403, 'forbidden', 'You cannot manage this user’s promotions.') };
        if (proposal.status !== 'pending') return { error: apiError(409, 'conflict', 'Promotion proposal has already been handled.') };
        const userRank = await tx.userRank.findUnique({ where: { userId: proposal.userId } });
        if (!userRank) return { error: apiError(404, 'not_found', 'User rank record not found.') };
        if (userRank.currentRankId !== proposal.currentRankId) return { error: apiError(409, 'conflict', 'The user’s rank changed since this proposal. Reload and create a new proposal.') };
        const currentRank = await tx.rank.findUnique({ where: { id: proposal.currentRankId } });
        const nextRank = await tx.rank.findUnique({ where: { id: proposal.nextRankId } });
        if (!currentRank || !nextRank) return { error: apiError(404, 'not_found', 'A proposed rank no longer exists.') };
        const attendance = await getCurrentAttendance(proposal.userId, tx);
        const delta = Math.max(0, attendance - userRank.attendanceSinceLastRank);
        const claimed = await tx.promotionProposal.updateMany({ where: { id, status: 'pending' }, data: { status: decision, attendanceTotalAtProposal: attendance, attendanceDeltaSinceLastRank: delta } });
        if (claimed.count !== 1) return { error: apiError(409, 'conflict', 'Promotion proposal has already been handled.') };
        const changed = await tx.userRank.update({ where: { userId: proposal.userId }, data: {
          attendanceSinceLastRank: attendance,
          ...(decision === 'approved' ? { currentRankId: nextRank.id, lastRankedUpAt: new Date() } : {}),
        } });
        const actorUserId = principal.kind === 'user' ? principal.userId : null;
        const history = await tx.rankHistory.create({ data: {
          userId: proposal.userId, previousRankName: currentRank.name, newRankName: nextRank.name,
          attendanceTotalAtChange: attendance, attendanceDeltaSinceLastRank: delta,
          triggeredBy: principal.kind === 'bot' ? 'bot' : 'admin_manual', triggeredByUserId: actorUserId,
          outcome: decision, declineReason: decision === 'declined' ? declineReason : null,
        } });
        if (decision === 'approved') {
          const discord = await tx.authAccount.findFirst({ where: { userId: proposal.userId, provider: 'discord' }, orderBy: { id: 'asc' }, select: { providerUserId: true } });
          await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: {
            rankHistoryId: history.id, userId: proposal.userId, discordUserId: discord?.providerUserId ?? null,
            oldRankId: currentRank.id, newRankId: nextRank.id, changeType: 'promotion', source: 'manual_approval',
          } }, tx);
        }
        await tx.message.create({ data: {
          title: decision === 'approved' ? 'Rank Approved' : 'Rank Proposal Declined',
          body: decision === 'approved' ? `You have been promoted to ${nextRank.name}.` : declineReason ? `Proposal declined: ${declineReason}` : 'Your rankup proposal was declined.',
          type: 'rankup', actionUrl: '/profile', createdById: actorUserId,
          recipients: { create: { userId: proposal.userId, audienceType: 'user', audienceValue: null, isRead: false, channel: 'web' } },
        } });
        await writeApiAudit(tx, context, { action: `promotion_proposal.${decision}`, resource: 'promotion_proposal', resourceId: String(id), targetUserIds: [proposal.userId], outcome: 'success',
          before: { status: proposal.status, currentRankId: userRank.currentRankId, attendanceSinceLastRank: userRank.attendanceSinceLastRank, lastRankedUpAt: userRank.lastRankedUpAt?.toISOString() ?? null },
          after: { status: decision, currentRankId: changed.currentRankId, attendanceSinceLastRank: changed.attendanceSinceLastRank, lastRankedUpAt: changed.lastRankedUpAt?.toISOString() ?? null, rankHistoryId: history.id, ...(decision === 'declined' ? { declineReason } : {}) },
        });
        return { userId: proposal.userId };
      }, { isolationLevel: 'Serializable' });
      if (result.error) return result.error;
      for (const publish of [() => publishPromotionEvent({ source: `proposal.${decision}`, proposalId: id }), () => publishInboxEvent(result.userId!), () => publishUserProfileEvent(result.userId!, { source: `rank.promotion-${decision}`, proposalId: id })]) {
        try { publish(); } catch { console.error('Promotion notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
      }
      return apiSuccess(null);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2025') return apiError(404, 'not_found', 'A promotion reference no longer exists.');
        if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return apiError(409, 'conflict', 'Promotion state changed concurrently. Reload and retry.');
      }
      throw error;
    }
  });
}
