import { prisma } from '@/lib/prisma';
import { canAccessApiUser } from './auth';
import { getCurrentAttendance } from '@/lib/rank-eligibility';
import { appendBotEvent } from '@/lib/bot-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { writeApiAudit, type ApiAuditContext } from './audit';
import type { ApiPrincipal } from './principal';
import { apiError } from './response';
export function parseUserRankMutation(body: unknown): { data: { rankId: number; reason?: string | null }; error?: never } | { error: Response; data?: never } {
  const invalid = (message: string) => ({ error: apiError(422, 'validation_failed', message) });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('Request body must be an object.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['rankId', 'reason'].includes(key))) return invalid('Provide rankId and optional reason only.');
  if (typeof input.rankId !== 'number' || !Number.isInteger(input.rankId) || input.rankId <= 0 || input.rankId > 2147483647) return invalid('rankId must be a positive 32-bit integer.');
  if (input.reason !== undefined && input.reason !== null && typeof input.reason !== 'string') return invalid('reason must be a string or null.');
  return { data: { rankId: input.rankId, ...(input.reason !== undefined ? { reason: typeof input.reason === 'string' ? input.reason.trim() || null : null } : {}) } };
}
export function userRankMutationError(error: unknown): Response {
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'P2025') return apiError(404, 'not_found', 'User or rank not found.');
    if (error.code === 'P2034' || error.code === 'P2002' || error.code === 'P2003') return apiError(409, 'conflict', 'Rank data changed concurrently. Reload and retry.');
  }
  throw error;
}

type UserRankUpdate = { userId: number; rankId: number; reason?: string | null };
export function parseBulkUserRankMutation(body: unknown): { data: UserRankUpdate[]; error?: never } | { error: Response; data?: never } {
  const invalid = () => ({ error: apiError(422, 'validation_failed', 'Provide 1–100 unique user updates with positive numeric userId, rankId and optional reason.') });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Array.isArray(input.updates) || !input.updates.length || input.updates.length > 100) return invalid();
  const seen = new Set<number>();
  const data: UserRankUpdate[] = [];
  for (const item of input.updates) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return invalid();
    const { userId, ...fields } = item;
    if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0 || userId > 2147483647 || seen.has(userId)) return invalid();
    const parsed = parseUserRankMutation(fields);
    if (parsed.error) return parsed;
    seen.add(userId); data.push({ userId, ...parsed.data });
  }
  return { data };
}
export async function updateUserRanks(principal: ApiPrincipal, audit: ApiAuditContext, updates: UserRankUpdate[], bulk = false) {
  try {
    const result = await prisma.$transaction(async tx => {
      const prepared = [];
      for (const update of updates) {
        if (!await canAccessApiUser(principal, update.userId, 'rank:manage_promotions', tx)) return { error: apiError(403, 'forbidden', 'Cannot manage one or more target users’ ranks.') };
        if (!await tx.user.findUnique({ where: { id: update.userId }, select: { id: true } })) return { error: apiError(404, 'not_found', 'User not found.') };
        const rank = await tx.rank.findUnique({ where: { id: update.rankId } });
        if (!rank) return { error: apiError(404, 'not_found', 'Rank not found.') };
        prepared.push({ update, rank });
      }
      const results = [];
      for (const { update, rank } of prepared) {
        const userId = update.userId;
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
          outcome: 'approved', note: update.reason ?? null,
        } });
        const discord = await tx.authAccount.findFirst({ where: { userId, provider: 'discord' }, select: { providerUserId: true } });
        await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: { rankHistoryId: history.id, userId, discordUserId: discord?.providerUserId ?? null, oldRankId: before?.currentRankId ?? null, newRankId: rank.id, changeType, source: bulk ? 'bulk_assignment' : 'direct_assignment' } }, tx);
        await writeApiAudit(tx, audit, { action: 'user_rank.updated', resource: 'user_rank', resourceId: String(userId), targetUserIds: [userId], outcome: 'success',
          before: { rankId: before?.currentRankId ?? null, attendanceSinceLastRank: before?.attendanceSinceLastRank ?? 0, lastRankedUpAt: before?.lastRankedUpAt.toISOString() ?? null },
          after: { rankId: rank.id, attendanceSinceLastRank: attendanceTotal, lastRankedUpAt: now.toISOString(), rankHistoryId: history.id, changeType, reason: update.reason ?? null },
        });
        results.push({ data: { userId, currentRank: updated.currentRank, retired: updated.retired, interviewDone: updated.interviewDone, attendanceSinceLastRank: updated.attendanceSinceLastRank, attendanceTotal, attendanceDelta: attendanceTotal - (updated.attendanceSinceLastRank || 0), lastRankedUpAt: updated.lastRankedUpAt }, changeType });
      }
      return { results };
    }, { isolationLevel: 'Serializable' });
    if (result.error) return { error: result.error };
    for (const row of result.results!) {
      try { publishUserProfileEvent(row.data.userId, { source: bulk ? 'rank.bulk-assigned' : row.changeType === 'demotion' ? 'rank.demoted' : 'rank.assigned', rankId: row.data.currentRank!.id }); }
      catch { console.error('Rank update notification failed', { correlationId: audit.correlationId, timestamp: new Date().toISOString() }); }
    }
    return { data: result.results!.map(row => row.data) };
  } catch (error) { return { error: userRankMutationError(error) }; }
}
