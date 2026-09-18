import { prisma } from './prisma';
import { randomUUID } from 'node:crypto';
import { writeApiAudit, type ApiAuditContext } from './api/audit';

/**
 * Processes unprocessed attendance events for a newly created user
 * Looks up AttendanceEvent records with matching steamId or discordId that have processed=false
 * and links them to the user, then marks them as processed.
 * Also handles duplicate events (join-join, leave-leave) by only keeping the first.
 * 
 * @param steamId - Optional Steam ID to match unprocessed events
 * @param discordId - Optional Discord ID to match unprocessed events
 * @param userId - The new user's ID to link events to
 */
export async function processPendingEventsForUser(
  steamId: string | null | undefined,
  discordId: string | null | undefined,
  userId: number,
  context?: ApiAuditContext,
): Promise<{ processedCount: number }> {
  if (!steamId && !discordId) return { processedCount: 0 };
  return prisma.$transaction(async tx => {
    const events = await tx.attendanceEvent.findMany({
      where: { processed: false, AND: [{ OR: [{ userId: null }, { userId }] }, { OR: [...(steamId ? [{ steamId }] : []), ...(discordId ? [{ discordId }] : [])] }] },
      orderBy: [{ eventTime: 'asc' }, { id: 'asc' }],
    });
    let processedCount = 0;
    let lastType: boolean | null = null;
    const linkedIds: number[] = [];
    for (const event of events) {
      const updated = await tx.attendanceEvent.updateMany({ where: { id: event.id, processed: false, OR: [{ userId: null }, { userId }] }, data: { userId, processed: true } });
      if (!updated.count) continue;
      linkedIds.push(event.id);
      if (lastType !== event.isJoin) { processedCount++; lastType = event.isJoin; }
    }
    if (linkedIds.length) {
      const event = { action: 'attendance_events.linked', resource: 'attendance_event', targetUserIds: [userId], outcome: 'success' as const, after: { eventIds: linkedIds, linkedCount: linkedIds.length } };
      if (context) await writeApiAudit(tx, context, event);
      else await tx.apiAuditLog.create({ data: { ...event, actorType: 'system', correlationId: randomUUID(), method: 'SYSTEM', path: 'attendance/account-link' } });
    }
    return { processedCount };
  }, { isolationLevel: 'Serializable', timeout: 60000 });
}
