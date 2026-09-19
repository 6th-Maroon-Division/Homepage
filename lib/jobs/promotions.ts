import { prisma } from '@/lib/prisma';
import { checkRankupEligibility } from '@/lib/rank-eligibility';
import { appendBotEvent } from '@/lib/bot-events';
import { publishInboxEvent } from '@/lib/realtime/inbox-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { publishPromotionEvent } from '@/lib/realtime/promotion-events';
import type { Prisma } from '@/generated/prisma/client';
import { writeApiAudit, type ApiAuditContext } from '@/lib/api/audit';
type Options = {
  userFilter?: Prisma.UserWhereInput;
  expectedRankId?: number;
  authorize: (userId: number, tx: Prisma.TransactionClient) => Promise<boolean>;
  tx?: Prisma.TransactionClient;
};
export async function executeAutomaticPromotions(context: ApiAuditContext, options: Options) {
  const database = options.tx ?? prisma;
  const transaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => options.tx
    ? fn(options.tx) : prisma.$transaction(fn, { isolationLevel: 'Serializable' });
  const candidates = await database.userRank.findMany({ where: { currentRankId: options.expectedRankId ?? { not: null }, interviewDone: true, retired: false, user: options.userFilter }, select: { userId: true }, orderBy: { userId: 'asc' } });
  const counts = { promotedCount: 0, errorsCount: 0, ineligibleCount: 0 };
  for (const { userId } of candidates) {
    try {
      const result = await transaction(async tx => {
        if (!(await options.authorize(userId, tx))) return { outcome: 'skip' as const };
        const eligibility = await checkRankupEligibility(userId, tx);
        if (!eligibility.eligible || eligibility.reason !== 'eligible_auto' || !eligibility.currentRank || !eligibility.nextRank) return { outcome: eligibility.reason === 'ineligible_attendance' && eligibility.nextRank?.autoRankupEnabled ? 'ineligible' as const : 'skip' as const };
        const existing = eligibility.proposalId ? await tx.promotionProposal.findUnique({ where: { id: eligibility.proposalId } }) : null;
        if (existing && existing.currentRankId !== eligibility.currentRank.id) throw new Error('Stale pending proposal');
        const before = await tx.userRank.findUniqueOrThrow({ where: { userId } });
        const attendance = eligibility.attendance.currentAttendance;
        const delta = Math.max(0, eligibility.attendance.delta);
        const changed = await tx.userRank.update({ where: { userId }, data: { currentRankId: eligibility.nextRank.id, lastRankedUpAt: new Date(), attendanceSinceLastRank: attendance } });
        if (existing) await tx.promotionProposal.update({ where: { id: existing.id }, data: { status: 'approved', attendanceTotalAtProposal: attendance, attendanceDeltaSinceLastRank: delta } });
        const actorUserId = context.principal?.kind === 'user' ? context.principal.userId : null;
        const history = await tx.rankHistory.create({ data: { userId, previousRankName: eligibility.currentRank.name, newRankName: eligibility.nextRank.name, attendanceTotalAtChange: attendance, attendanceDeltaSinceLastRank: delta, triggeredBy: 'auto', triggeredByUserId: actorUserId, outcome: 'approved' } });
        const discord = await tx.authAccount.findFirst({ where: { userId, provider: 'discord' }, orderBy: { id: 'asc' }, select: { providerUserId: true } });
        await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: { rankHistoryId: history.id, userId, discordUserId: discord?.providerUserId ?? null, oldRankId: eligibility.currentRank.id, newRankId: eligibility.nextRank.id, changeType: 'promotion', source: 'automatic' } }, tx);
        await tx.message.create({ data: { title: `Promoted to ${eligibility.nextRank.name}`, body: `You have been promoted from ${eligibility.currentRank.name} to ${eligibility.nextRank.name}!`, type: 'rankup', createdById: actorUserId, recipients: { create: { userId, audienceType: 'user', channel: 'web', isRead: false } } } });
        await writeApiAudit(tx, context, { action: 'user_rank.promoted', resource: 'user_rank', resourceId: String(userId), targetUserIds: [userId], outcome: 'success', before: { currentRankId: before.currentRankId, attendanceSinceLastRank: before.attendanceSinceLastRank, lastRankedUpAt: before.lastRankedUpAt.toISOString() }, after: { currentRankId: changed.currentRankId, attendanceSinceLastRank: changed.attendanceSinceLastRank, lastRankedUpAt: changed.lastRankedUpAt.toISOString(), rankHistoryId: history.id, proposalId: existing?.id ?? null } });
        if (existing) await writeApiAudit(tx, context, { action: 'promotion_proposal.approved', resource: 'promotion_proposal', resourceId: String(existing.id), targetUserIds: [userId], outcome: 'success', before: { status: 'pending' }, after: { status: 'approved', rankHistoryId: history.id } });
        return { outcome: 'promoted' as const, nextRankId: eligibility.nextRank.id, proposalId: existing?.id ?? null };
      });
      if (result.outcome === 'ineligible') counts.ineligibleCount++;
      if (result.outcome !== 'promoted') continue;
      counts.promotedCount++;
      // A standalone worker has no browser subscribers; never publish before its outer commit.
      if (options.tx) continue;
      const notifications: (() => void)[] = [() => publishInboxEvent(userId), () => publishUserProfileEvent(userId, { source: 'rank.auto-promoted', nextRankId: result.nextRankId })];
      if (result.proposalId !== null) notifications.push(() => publishPromotionEvent({ source: 'proposal.approved', proposalId: result.proposalId! }));
      for (const publish of notifications) try { publish(); } catch { console.error('Promotion notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
    } catch (error) {
      if (options.tx) throw error;
      counts.errorsCount++;
      console.error('Automatic promotion failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() });
    }
  }
  return counts;
}
