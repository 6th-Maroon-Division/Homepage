import type { Prisma } from '@/generated/prisma/client';
import { appendBotEvent } from '@/lib/bot-events';
import { writeApiAudit, type ApiAuditContext } from '@/lib/api/audit';

export async function executeTrainingReminders(tx: Prisma.TransactionClient, audit: ApiAuditContext, now = new Date(), take?: number) {
  const cutoff = new Date(now.getTime() + 86400000);
  const attendees = await tx.trainingSessionAttendee.findMany({
    where: { reminder24hSentAt: null, status: { in: ['scheduled', 'attended'] }, session: { status: 'scheduled', startsAt: { gt: now, lte: cutoff } } },
    include: { session: { include: { training: { select: { name: true } }, trainer: { select: { username: true } } } }, trainingRequest: { select: { id: true, subscriptions: { where: { discordEnabled: true }, select: { userId: true } } } } },
    take,
    orderBy: [{ session: { startsAt: 'asc' } }, { id: 'asc' }],
  });
  const delivered: { userId: number; messageId: number; body: string; discordEnabled: boolean }[] = [];
  const sessions = new Set<number>();
  for (const attendee of attendees) {
    if (!attendee.session.startsAt) continue;
    const claimed = await tx.trainingSessionAttendee.updateMany({ where: { id: attendee.id, reminder24hSentAt: null }, data: { reminder24hSentAt: now } });
    if (claimed.count !== 1) continue;
    const start = attendee.session.startsAt.toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
    const trainer = attendee.session.trainer?.username ? ` with ${attendee.session.trainer.username}` : '';
    const messageBody = `${attendee.session.training.name}${trainer} starts at ${start} UTC on the Arma3 Training Server.`;
    const actionUrl = attendee.trainingRequest ? `/trainings/requests/${attendee.trainingRequest.id}` : '/profile?tab=trainings';
    const message = await tx.message.create({ data: { title: 'Training starts within 24 hours', body: messageBody, type: 'training', actionUrl, createdById: null, recipients: { create: { userId: attendee.userId, audienceType: 'user', channel: 'web' } } } });
    if (!sessions.has(attendee.sessionId)) {
      sessions.add(attendee.sessionId);
      // The highest attendee ID identifies the roster, even when adding someone
      // leaves TrainingSession.updatedAt unchanged. Claims do not change this ID.
      const roster = await tx.trainingSessionAttendee.findFirstOrThrow({ where: { sessionId: attendee.sessionId }, orderBy: { id: 'desc' }, select: { id: true } });
      const existing = await tx.botEvent.findFirst({ where: { type: 'training.reminder_due', aggregateId: String(attendee.sessionId) }, orderBy: { id: 'desc' }, select: { payload: true } });
      const previous = existing?.payload as { version?: string; sessionVersion?: string; reminderRosterId?: number } | null | undefined;
      const sessionVersion = attendee.session.updatedAt.toISOString();
      if (previous?.reminderRosterId !== roster.id || previous.sessionVersion !== sessionVersion) {
        // Keep the public timestamp version strictly increasing, even when two
        // roster changes are processed within the same clock millisecond.
        const version = new Date(Math.max(now.getTime(), (Date.parse(previous?.version ?? '') || 0) + 1)).toISOString();
        await appendBotEvent({ type: 'training.reminder_due', aggregate: 'training', aggregateId: attendee.sessionId, payload: { trainingId: attendee.session.trainingId, sessionId: attendee.sessionId, title: attendee.session.training.name, startsAt: attendee.session.startsAt.toISOString(), websiteUrl: `/trainings/sessions/${attendee.sessionId}`, version, sessionVersion, reminderRosterId: roster.id } }, tx);
      }
    }
    await writeApiAudit(tx, audit, { action: 'training_reminder.delivered', resource: 'training_reminder', resourceId: String(attendee.id), targetUserIds: [attendee.userId], outcome: 'success', before: { reminder24hSentAt: null }, after: { reminder24hSentAt: now.toISOString(), sessionId: attendee.sessionId, notificationId: message.id } });
    delivered.push({ userId: attendee.userId, messageId: message.id, body: messageBody, discordEnabled: attendee.trainingRequest?.subscriptions.some(subscription => subscription.userId === attendee.userId) ?? false });
  }
  return { scanned: attendees.length, delivered };
}
