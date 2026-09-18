import { prisma } from '@/lib/prisma';
import { checkRankupEligibility } from '@/lib/rank-eligibility';
import { appendBotEvent } from '@/lib/bot-events';
import { publishInboxEvent } from '@/lib/realtime/inbox-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { publishPromotionEvent } from '@/lib/realtime/promotion-events';
import { canAccessApiUser } from './auth';
import { writeApiAudit } from './audit';
import { handleApiRequest } from './handler';
import { promotionVisibility } from './promotions';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
import { parseCursorPagination, parsePositiveId } from './validation';

export async function listAutomaticPromotions(request: Request) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, context) => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !['days', 'limit', 'cursor'].includes(key) || params.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Use only one days, limit and cursor parameter.');
    const days = params.has('days') ? parsePositiveId(params.get('days')) : 7;
    if (days === null || days > 3650) return apiError(400, 'invalid_request', 'days must be an integer from 1 to 3650.');
    const pagination = parseCursorPagination(params, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return apiError(400, 'invalid_request', pagination.error);
    const { limit, cursor } = pagination.data;
    const rows = await prisma.rankHistory.findMany({ where: {
      user: promotionVisibility(principal).user,
      createdAt: { gte: new Date(Date.now() - days * 86400000) }, triggeredBy: { contains: 'auto', mode: 'insensitive' },
      ...(cursor ? { id: { lt: cursor } } : {}),
    }, select: { id: true, userId: true, previousRankName: true, newRankName: true, createdAt: true, triggeredBy: true, outcome: true,
      user: { select: { id: true, username: true, accounts: { where: { provider: 'discord' }, orderBy: { id: 'asc' }, take: 1, select: { providerUserId: true } } } },
    }, orderBy: { id: 'desc' }, take: limit + 1 });
    const data = rows.slice(0, limit).map(row => ({ id: row.id, userId: row.userId, previousRankName: row.previousRankName, newRankName: row.newRankName, createdAt: row.createdAt.toISOString(), triggeredBy: row.triggeredBy, outcome: row.outcome, user: { id: row.user.id, username: row.user.username, discordId: row.user.accounts[0]?.providerUserId ?? null } }));
    const targetUserIds = [...new Set(data.filter(row => principal.kind === 'bot' || row.userId !== principal.userId).map(row => row.userId))];
    if (targetUserIds.length) await writeApiAudit(prisma, context, { action: 'user_data.read', resource: 'rank_history', targetUserIds, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data.at(-1)!.id) : null } });
  });
}

export async function runAutomaticPromotions(request: Request) {
  return handleApiRequest(request, 'rank:manage_promotions', async (principal, context) => {
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'No query parameters supported.');
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return apiError(422, 'validation_failed', 'Use an empty JSON object.');
    const candidates = await prisma.userRank.findMany({ where: { currentRankId: { not: null }, interviewDone: true, retired: false, user: promotionVisibility(principal).user }, select: { userId: true }, orderBy: { userId: 'asc' } });
    const counts = { promotedCount: 0, errorsCount: 0, ineligibleCount: 0 };
    for (const { userId } of candidates) {
      try {
        const result = await prisma.$transaction(async tx => {
          if (!(await canAccessApiUser(principal, userId, 'rank:manage_promotions', tx))) return { outcome: 'skip' as const };
          const eligibility = await checkRankupEligibility(userId, tx);
          if (!eligibility.eligible || eligibility.reason !== 'eligible_auto' || !eligibility.currentRank || !eligibility.nextRank) return { outcome: eligibility.reason === 'ineligible_attendance' && eligibility.nextRank?.autoRankupEnabled ? 'ineligible' as const : 'skip' as const };
          const existing = eligibility.proposalId ? await tx.promotionProposal.findUnique({ where: { id: eligibility.proposalId } }) : null;
          if (existing && existing.currentRankId !== eligibility.currentRank.id) throw new Error('Stale pending proposal');
          const before = await tx.userRank.findUniqueOrThrow({ where: { userId } });
          const attendance = eligibility.attendance.currentAttendance;
          const delta = Math.max(0, eligibility.attendance.delta);
          const changed = await tx.userRank.update({ where: { userId }, data: { currentRankId: eligibility.nextRank.id, lastRankedUpAt: new Date(), attendanceSinceLastRank: attendance } });
          if (existing) await tx.promotionProposal.update({ where: { id: existing.id }, data: { status: 'approved', attendanceTotalAtProposal: attendance, attendanceDeltaSinceLastRank: delta } });
          const actorUserId = principal.kind === 'user' ? principal.userId : null;
          const history = await tx.rankHistory.create({ data: { userId, previousRankName: eligibility.currentRank.name, newRankName: eligibility.nextRank.name, attendanceTotalAtChange: attendance, attendanceDeltaSinceLastRank: delta, triggeredBy: 'auto', triggeredByUserId: actorUserId, outcome: 'approved' } });
          const discord = await tx.authAccount.findFirst({ where: { userId, provider: 'discord' }, orderBy: { id: 'asc' }, select: { providerUserId: true } });
          await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: { rankHistoryId: history.id, userId, discordUserId: discord?.providerUserId ?? null, oldRankId: eligibility.currentRank.id, newRankId: eligibility.nextRank.id, changeType: 'promotion', source: 'automatic' } }, tx);
          await tx.message.create({ data: { title: `Promoted to ${eligibility.nextRank.name}`, body: `You have been promoted from ${eligibility.currentRank.name} to ${eligibility.nextRank.name}!`, type: 'rankup', createdById: actorUserId, recipients: { create: { userId, audienceType: 'user', channel: 'web', isRead: false } } } });
          await writeApiAudit(tx, context, { action: 'user_rank.promoted', resource: 'user_rank', resourceId: String(userId), targetUserIds: [userId], outcome: 'success', before: { currentRankId: before.currentRankId, attendanceSinceLastRank: before.attendanceSinceLastRank, lastRankedUpAt: before.lastRankedUpAt.toISOString() }, after: { currentRankId: changed.currentRankId, attendanceSinceLastRank: changed.attendanceSinceLastRank, lastRankedUpAt: changed.lastRankedUpAt.toISOString(), rankHistoryId: history.id, proposalId: existing?.id ?? null } });
          if (existing) await writeApiAudit(tx, context, { action: 'promotion_proposal.approved', resource: 'promotion_proposal', resourceId: String(existing.id), targetUserIds: [userId], outcome: 'success', before: { status: 'pending' }, after: { status: 'approved', rankHistoryId: history.id } });
          return { outcome: 'promoted' as const, nextRankId: eligibility.nextRank.id, proposalId: existing?.id ?? null };
        }, { isolationLevel: 'Serializable' });
        if (result.outcome === 'ineligible') counts.ineligibleCount++;
        if (result.outcome !== 'promoted') continue;
        counts.promotedCount++;
        const notifications: (() => void)[] = [() => publishInboxEvent(userId), () => publishUserProfileEvent(userId, { source: 'rank.auto-promoted', nextRankId: result.nextRankId })];
        if (result.proposalId !== null) notifications.push(() => publishPromotionEvent({ source: 'proposal.approved', proposalId: result.proposalId! }));
        for (const publish of notifications) try { publish(); } catch { console.error('Promotion notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
      } catch {
        counts.errorsCount++;
        console.error('Automatic promotion failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() });
      }
    }
    return apiSuccess(counts);
  });
}
