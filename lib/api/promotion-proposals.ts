import { prisma } from '@/lib/prisma';
import { checkRankupEligibility } from '@/lib/rank-eligibility';
import { appendBotEvent } from '@/lib/bot-events';
import { publishInboxEvents } from '@/lib/realtime/inbox-events';
import { publishPromotionEvent } from '@/lib/realtime/promotion-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { canAccessApiUser } from './auth';
import { writeApiAudit } from './audit';
import { handleApiRequest } from './handler';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
export async function proposePromotion(request: Request) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, context) => {
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'No query parameters supported.');
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'userId') || !('userId' in body) || typeof body.userId !== 'number' || !Number.isInteger(body.userId) || body.userId < 1 || body.userId > 2147483647) return apiError(422, 'validation_failed', 'Use a numeric positive 32-bit userId.');
    const userId = body.userId;
    try {
      const result = await prisma.$transaction(async tx => {
        if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) return { error: apiError(404, 'not_found', 'User not found.') };
        if (!(await canAccessApiUser(principal, userId, 'rank:manage_promotions', tx))) return { error: apiError(403, 'forbidden', 'You cannot manage this user’s promotions.') };
        const eligibility = await checkRankupEligibility(userId, tx);
        if (!eligibility.eligible || !eligibility.nextRank || !eligibility.currentRank) {
          if (principal.kind === 'bot' || principal.userId !== userId) await writeApiAudit(tx, context, { action: 'user_data.read', resource: 'rank_eligibility', resourceId: String(userId), targetUserIds: [userId], outcome: 'success' });
          return { error: apiError(409, 'conflict', 'User is not eligible for a promotion.', { reason: eligibility.reason }) };
        }
        const existing = eligibility.proposalId ? await tx.promotionProposal.findUnique({ where: { id: eligibility.proposalId } }) : null;
        if (existing && existing.currentRankId !== eligibility.currentRank.id) return { error: apiError(409, 'conflict', 'A pending proposal uses an obsolete current rank.') };
        const actorUserId = principal.kind === 'user' ? principal.userId : null;
        const attendance = eligibility.attendance.currentAttendance;
        const delta = Math.max(0, eligibility.attendance.delta);
        if (eligibility.reason === 'eligible_auto') {
          const before = await tx.userRank.findUniqueOrThrow({ where: { userId } });
          const changed = await tx.userRank.update({ where: { userId }, data: { currentRankId: eligibility.nextRank.id, attendanceSinceLastRank: attendance, lastRankedUpAt: new Date() } });
          if (existing) await tx.promotionProposal.update({ where: { id: existing.id }, data: { status: 'approved', attendanceTotalAtProposal: attendance, attendanceDeltaSinceLastRank: delta } });
          const history = await tx.rankHistory.create({ data: { userId, previousRankName: eligibility.currentRank.name, newRankName: eligibility.nextRank.name, attendanceTotalAtChange: attendance, attendanceDeltaSinceLastRank: delta, triggeredBy: 'auto', triggeredByUserId: actorUserId, outcome: 'approved' } });
          const discord = await tx.authAccount.findFirst({ where: { userId, provider: 'discord' }, orderBy: { id: 'asc' }, select: { providerUserId: true } });
          await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: { rankHistoryId: history.id, userId, discordUserId: discord?.providerUserId ?? null, oldRankId: eligibility.currentRank.id, newRankId: eligibility.nextRank.id, changeType: 'promotion', source: 'automatic' } }, tx);
          await tx.message.create({ data: { title: 'Rank Approved', body: `You have been promoted to ${eligibility.nextRank.name}.`, type: 'rankup', actionUrl: '/profile', createdById: actorUserId, recipients: { create: { userId, audienceType: 'user', channel: 'web', isRead: false } } } });
          await writeApiAudit(tx, context, { action: 'user_rank.promoted', resource: 'user_rank', resourceId: String(userId), targetUserIds: [userId], outcome: 'success', before: { currentRankId: before.currentRankId, attendanceSinceLastRank: before.attendanceSinceLastRank, lastRankedUpAt: before.lastRankedUpAt?.toISOString() ?? null }, after: { currentRankId: changed.currentRankId, attendanceSinceLastRank: changed.attendanceSinceLastRank, lastRankedUpAt: changed.lastRankedUpAt?.toISOString() ?? null, rankHistoryId: history.id, proposalId: existing?.id ?? null } });
          if (existing) await writeApiAudit(tx, context, { action: 'promotion_proposal.approved', resource: 'promotion_proposal', resourceId: String(existing.id), targetUserIds: [userId], outcome: 'success', before: { status: 'pending' }, after: { status: 'approved', rankHistoryId: history.id } });
          return { data: { userId, outcome: 'promoted' as const, proposalId: existing?.id ?? null, rankId: eligibility.nextRank.id }, notifyUserIds: [userId] };
        }
        if (existing) {
          if (principal.kind === 'bot' || principal.userId !== userId) await writeApiAudit(tx, context, { action: 'user_data.read', resource: 'promotion_proposal', resourceId: String(existing.id), targetUserIds: [userId], outcome: 'success' });
          return { data: { userId, outcome: 'already_pending' as const, proposalId: existing.id, rankId: eligibility.nextRank.id }, notifyUserIds: [] };
        }
        const proposal = await tx.promotionProposal.create({ data: { userId, currentRankId: eligibility.currentRank.id, nextRankId: eligibility.nextRank.id, attendanceTotalAtProposal: attendance, attendanceDeltaSinceLastRank: delta, status: 'pending' } });
        const admins = await tx.userPermission.findMany({ where: { permission: { key: 'system:super_admin' }, value: { gt: 0 } }, select: { userId: true } });
        const notifyUserIds = [...new Set(admins.map(admin => admin.userId))];
        if (notifyUserIds.length) await tx.message.create({ data: { title: 'New Rankup Proposal', body: `User ${userId} is eligible for ${eligibility.nextRank.name}`, type: 'rankup', actionUrl: '/admin/promotions', createdById: actorUserId, recipients: { create: notifyUserIds.map(recipientId => ({ userId: recipientId, audienceType: 'admin', channel: 'web', isRead: false })) } } });
        await writeApiAudit(tx, context, { action: 'promotion_proposal.created', resource: 'promotion_proposal', resourceId: String(proposal.id), targetUserIds: [userId], outcome: 'success', after: { userId, currentRankId: proposal.currentRankId, nextRankId: proposal.nextRankId, status: proposal.status, attendanceTotalAtProposal: attendance, attendanceDeltaSinceLastRank: delta, createdAt: proposal.createdAt.toISOString() } });
        return { data: { userId, outcome: 'proposed' as const, proposalId: proposal.id, rankId: eligibility.nextRank.id }, notifyUserIds };
      }, { isolationLevel: 'Serializable' });
      if (result.error) return result.error;
      if (result.data.outcome !== 'already_pending') {
        const notifications = [() => publishInboxEvents(result.notifyUserIds)];
        if (result.data.proposalId !== null) notifications.push(() => publishPromotionEvent({ source: result.data.outcome === 'proposed' ? 'proposal.created' : 'proposal.approved', proposalId: result.data.proposalId! }));
        if (result.data.outcome === 'promoted') notifications.push(() => publishUserProfileEvent(userId, { source: 'rank.auto-promoted', nextRankId: result.data.rankId }));
        for (const publish of notifications) try { publish(); } catch { console.error('Promotion notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
      }
      return apiSuccess(result.data, { status: result.data.outcome === 'proposed' ? 201 : 200 });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2025') return apiError(404, 'not_found', 'A promotion reference no longer exists.');
        if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return apiError(409, 'conflict', 'Promotion state changed concurrently. Reload and retry.');
      }
      throw error;
    }
  });
}
