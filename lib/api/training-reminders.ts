import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { appendBotEvent } from '@/lib/bot-events';
import { sendDiscordTrainingDm } from '@/lib/training-notifications';
import { publishInboxEvents } from '@/lib/realtime/inbox-events';
import { handleApiRequest } from './handler';
import { hasApiPermission } from './permissions';
import { apiError, apiSuccess } from './response';
import { readJsonBody } from './request';
import { writeApiAudit } from './audit';

export async function deliverTrainingReminders(request: Request) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    if (!hasApiPermission(principal.permissions, 'training:approve_request') && !hasApiPermission(principal.permissions, 'training:mark')) return apiError(403, 'forbidden', 'Requires training:approve_request or training:mark.');
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Query parameters are not accepted.');
    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return apiError(422, 'validation_failed', 'Use an empty JSON object.');
    const now = new Date();
    const cutoff = new Date(now.getTime() + 86400000);
    let result;
    try {
      result = await prisma.$transaction(async tx => {
        const attendees = await tx.trainingSessionAttendee.findMany({
          where: { reminder24hSentAt: null, status: { in: ['scheduled', 'attended'] }, session: { status: 'scheduled', startsAt: { gt: now, lte: cutoff } } },
          include: { session: { include: { training: { select: { name: true } }, trainer: { select: { username: true } } } }, trainingRequest: { select: { id: true, subscriptions: { where: { discordEnabled: true }, select: { userId: true } } } } },
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
            await appendBotEvent({ type: 'training.reminder_due', aggregate: 'training', aggregateId: attendee.sessionId, payload: { trainingId: attendee.session.trainingId, sessionId: attendee.sessionId, title: attendee.session.training.name, startsAt: attendee.session.startsAt.toISOString(), websiteUrl: `/trainings/sessions/${attendee.sessionId}`, version: attendee.session.updatedAt.toISOString() } }, tx);
          }
          await writeApiAudit(tx, audit, { action: 'training_reminder.delivered', resource: 'training_reminder', resourceId: String(attendee.id), targetUserIds: [attendee.userId], outcome: 'success', before: { reminder24hSentAt: null }, after: { reminder24hSentAt: now.toISOString(), sessionId: attendee.sessionId, notificationId: message.id } });
          delivered.push({ userId: attendee.userId, messageId: message.id, body: messageBody, discordEnabled: attendee.trainingRequest?.subscriptions.some(subscription => subscription.userId === attendee.userId) ?? false });
        }
        return { scanned: attendees.length, delivered };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60000 });
    } catch (error) {
      if (['P2002', 'P2003', 'P2034'].includes((error as { code?: string }).code ?? '')) return apiError(409, 'conflict', 'Reminder recipients changed concurrently. Retry the request.');
      throw error;
    }
    let discordDelivered = 0;
    for (const notification of result.delivered) {
      try { publishInboxEvents([notification.userId], { source: 'training.notification', messageId: notification.messageId }); } catch { console.error('Training reminder inbox publication failed'); }
      if (notification.discordEnabled) {
        try { if ((await sendDiscordTrainingDm(notification.userId, `Training reminder: ${notification.body}`)).delivered) discordDelivered += 1; }
        catch { console.error('Training reminder Discord delivery failed'); }
      }
    }
    return apiSuccess({ scanned: result.scanned, delivered: result.delivered.length, discordDelivered, windowEndsAt: cutoff.toISOString() });
  });
}
