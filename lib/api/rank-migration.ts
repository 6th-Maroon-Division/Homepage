import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentAttendance } from '@/lib/rank-eligibility';
import { appendBotEvent } from '@/lib/bot-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { canAccessApiUser } from './auth';
import { writeApiAudit } from './audit';
import { handleApiRequest } from './handler';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
import type { ApiPrincipal } from './principal';
type MigrationInput = { strategy: 'recalculate' | 'grandfather' | 'map'; rankMappings?: { oldRankId: number; newRankId: number }[] };
export function parseRankMigration(body: unknown): MigrationInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['strategy', 'rankMappings'].includes(key))) return null;
  const value = body as Record<string, unknown>;
  if (!['recalculate', 'grandfather', 'map'].includes(value.strategy as string)) return null;
  if (value.strategy !== 'map') return Object.hasOwn(value, 'rankMappings') ? null : { strategy: value.strategy as 'recalculate' | 'grandfather' };
  if (!Array.isArray(value.rankMappings) || !value.rankMappings.length) return null;
  const seen = new Set<number>();
  const ids = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
  for (const mapping of value.rankMappings) {
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).some(key => !['oldRankId', 'newRankId'].includes(key)) || !ids(mapping.oldRankId) || !ids(mapping.newRankId) || seen.has(mapping.oldRankId)) return null;
    seen.add(mapping.oldRankId);
  }
  return { strategy: 'map', rankMappings: value.rankMappings as MigrationInput['rankMappings'] };
}
function visibility(principal: ApiPrincipal): Prisma.UserWhereInput {
  // This helper only runs after rank:edit authorization; bots are superadmins.
  if (principal.kind === 'bot' || (principal.permissions['system:super_admin'] ?? 0) > 0) return {};
  return { OR: [{ id: principal.userId }, { userPermissions: { none: { OR: [{ permission: { key: 'system:super_admin' }, value: { gt: 0 } }, { permission: { key: 'rank:edit' }, value: { gte: principal.permissions['rank:edit'] } }] } } }] };
}
export async function migrateRanks(request: Request, apply: boolean) {
  return handleApiRequest(request, 'rank:edit', async (principal, context) => {
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'No query parameters supported.');
    const input = parseRankMigration(await readJsonBody(request));
    if (!input) return apiError(422, 'validation_failed', 'Use strategy recalculate, grandfather or map; map requires unique numeric oldRankId/newRankId mappings.');
    try {
      const result = await prisma.$transaction(async tx => {
        const ranks = await tx.rank.findMany({ orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }] });
        const rankMap = new Map(ranks.map(rank => [rank.id, rank]));
        if (input.rankMappings?.some(mapping => !rankMap.has(mapping.oldRankId) || !rankMap.has(mapping.newRankId))) return { error: apiError(404, 'not_found', 'A mapped rank does not exist.') };
        const users = await tx.userRank.findMany({ where: { currentRankId: { not: null }, user: visibility(principal) }, include: { user: { select: { id: true, username: true } }, currentRank: true }, orderBy: { userId: 'asc' } });
        for (const user of users) if (!(await canAccessApiUser(principal, user.userId, 'rank:edit', tx))) return { error: apiError(403, 'forbidden', 'A user’s rank permissions changed. Reload the preview.') };
        const plan = [];
        for (const user of users) {
          if (!user.currentRank) continue;
          let next = user.currentRank;
          if (input.strategy === 'map') next = rankMap.get(input.rankMappings!.find(mapping => mapping.oldRankId === user.currentRankId)?.newRankId ?? user.currentRankId!)!;
          const attendanceTotal = !apply || input.strategy === 'recalculate' || next.id !== user.currentRankId ? await getCurrentAttendance(user.userId, tx) : 0;
          if (input.strategy === 'recalculate') next = ranks.filter(rank => attendanceTotal >= (rank.attendanceRequiredSinceLastRank ?? 0)).at(-1) ?? user.currentRank;
          const changeType = next.id === user.currentRankId ? 'unchanged' as const : next.orderIndex < user.currentRank.orderIndex ? 'demotion' as const : 'promotion' as const;
          plan.push({ user, next, attendanceTotal, changeType });
        }
        const counts = { demoted: plan.filter(row => row.changeType === 'demotion').length, promoted: plan.filter(row => row.changeType === 'promotion').length, unchanged: plan.filter(row => row.changeType === 'unchanged').length };
        if (!apply) {
          const changes = plan.map(({ user, next, attendanceTotal, changeType }) => ({ userId: user.userId, username: user.user.username ?? 'Unknown', currentRankName: user.currentRank!.name, newRankName: next.name, changeType, attendanceTotal }));
          const targetUserIds = changes.filter(row => principal.kind === 'bot' || row.userId !== principal.userId).map(row => row.userId);
          if (targetUserIds.length) await writeApiAudit(tx, context, { action: 'user_data.read', resource: 'rank_migration', targetUserIds, outcome: 'success' });
          return { data: { totalUsers: changes.length, ...counts, changes }, changedUsers: [] };
        }
        const changedUsers: number[] = [];
        for (const { user, next, attendanceTotal, changeType } of plan) {
          if (changeType === 'unchanged') continue;
          const changed = await tx.userRank.update({ where: { userId: user.userId }, data: { currentRankId: next.id, attendanceSinceLastRank: attendanceTotal, lastRankedUpAt: new Date() } });
          const history = await tx.rankHistory.create({ data: { userId: user.userId, previousRankName: user.currentRank!.name, newRankName: next.name, attendanceTotalAtChange: attendanceTotal, attendanceDeltaSinceLastRank: Math.max(0, attendanceTotal - user.attendanceSinceLastRank), triggeredBy: 'system_migration', triggeredByUserId: principal.kind === 'user' ? principal.userId : null, outcome: 'approved', note: `Migration: ${input.strategy} strategy applied` } });
          const discord = await tx.authAccount.findFirst({ where: { userId: user.userId, provider: 'discord' }, orderBy: { id: 'asc' }, select: { providerUserId: true } });
          await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: { rankHistoryId: history.id, userId: user.userId, discordUserId: discord?.providerUserId ?? null, oldRankId: user.currentRankId, newRankId: next.id, changeType, source: 'migration' } }, tx);
          await writeApiAudit(tx, context, { action: 'user_rank.migrated', resource: 'user_rank', resourceId: String(user.userId), targetUserIds: [user.userId], outcome: 'success', before: { currentRankId: user.currentRankId, attendanceSinceLastRank: user.attendanceSinceLastRank, lastRankedUpAt: user.lastRankedUpAt.toISOString() }, after: { currentRankId: next.id, attendanceSinceLastRank: attendanceTotal, lastRankedUpAt: changed.lastRankedUpAt.toISOString(), rankHistoryId: history.id, strategy: input.strategy } });
          changedUsers.push(user.userId);
        }
        return { data: { totalProcessed: plan.length, ...counts }, changedUsers };
      }, { isolationLevel: 'Serializable', timeout: 60000 });
      if (result.error) return result.error;
      for (const userId of result.changedUsers) try { publishUserProfileEvent(userId, { source: 'rank.migrated' }); } catch { console.error('Migration notification failed', { correlationId: context.correlationId, timestamp: new Date().toISOString() }); }
      return apiSuccess(result.data);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2025') return apiError(404, 'not_found', 'A migration reference no longer exists.');
        if (['P2002', 'P2003', 'P2034'].includes(String(error.code))) return apiError(409, 'conflict', 'Migration state changed concurrently. Reload the preview and retry.');
      }
      throw error;
    }
  });
}
