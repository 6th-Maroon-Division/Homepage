import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { sendDiscordTrainingDm } from '@/lib/training-notifications';
import { publishInboxEvents } from '@/lib/realtime/inbox-events';
import { handleApiRequest } from './handler';
import { hasApiPermission } from './permissions';
import { apiError, apiSuccess } from './response';
import { readJsonBody } from './request';
import { executeTrainingReminders } from '@/lib/jobs/training-reminders';

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
        return executeTrainingReminders(tx, audit, now);
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
