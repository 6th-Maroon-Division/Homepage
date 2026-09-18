import { prisma } from '@/lib/prisma';
import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parseCursorPagination } from '@/lib/api/validation';
import { writeApiAudit } from '@/lib/api/audit';
import { parseTrainingRequestBody } from '@/lib/api/training-request-contract';
import { requestId, requestActor, isRequestStaff, requestUserSelect, serializeRequestMessage, canManageTrainingRequest, requestDatabaseError, publishRequestEvent } from '@/lib/api/training-requests';
import { createSessionNotification, publishSessionNotifications, type SessionNotifications } from '@/lib/api/training-session-notifications';
import { sendDiscordTrainingDm } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const id = requestId((await context.params).id);
    if (!id) return apiError(400, 'invalid_request', 'Invalid training request ID.');
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['limit', 'cursor'].includes(key) || query.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Unknown or repeated query parameter.');
    const paging = parseCursorPagination(query, { defaultLimit: 50, maxLimit: 100 });
    if (paging.error) return apiError(400, 'invalid_request', paging.error);
    const row = await prisma.trainingRequest.findUnique({ where: { id }, select: { userId: true } });
    if (!row) return apiError(404, 'not_found', 'Training request not found.');
    if (row.userId !== requestActor(principal) && !isRequestStaff(principal)) return apiError(403, 'forbidden', 'Training request access required.');
    const { limit, cursor } = paging.data!;
    const rows = await prisma.trainingRequestMessage.findMany({ where: { requestId: id, ...(cursor ? { id: { gt: cursor } } : {}) }, include: { sender: { select: requestUserSelect } }, orderBy: { id: 'asc' }, take: limit + 1 });
    const data = rows.slice(0, limit).map(message => serializeRequestMessage(message, principal));
    const targets = [...new Set([row.userId, ...data.flatMap(message => message.sender?.id ? [message.sender.id] : [])])].filter(userId => principal.kind === 'bot' || principal.userId !== userId);
    if (targets.length) await writeApiAudit(prisma, audit, { action: 'user_data.read', resource: 'training_request_message', resourceId: String(id), targetUserIds: targets, outcome: 'success' });
    return apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data[limit - 1].id) : null } });
  });
}

export async function POST(request: Request, context: Context) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const id = requestId((await context.params).id);
    if (!id || new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Invalid request ID or query.');
    const parsed = parseTrainingRequestBody(await readJsonBody(request), 'message');
    if (parsed.error) return parsed.error;
    const body = parsed.data.body!;
    const actorId = requestActor(principal);
    const notifications: SessionNotifications = [];
    const discordMessages: { userId: number; content: string }[] = [];
    try {
      const outcome = await prisma.$transaction(async tx => {
        const row = await tx.trainingRequest.findUnique({ where: { id }, include: { training: { select: { name: true } }, assignedTrainer: { select: { id: true } } } });
        if (!row) return { error: apiError(404, 'not_found', 'Training request not found.') };
        if (row.userId !== actorId && (!isRequestStaff(principal) || !await canManageTrainingRequest(principal, row.userId, tx))) return { error: apiError(403, 'forbidden', 'Training request access required.') };
        if (row.status === 'cancelled') return { error: apiError(409, 'conflict', 'This chat is closed.') };
        const senderRole = row.userId === actorId ? 'USER' as const : 'STAFF' as const;
        const message = await tx.trainingRequestMessage.create({ data: { requestId: id, senderId: actorId, senderRole, body }, include: { sender: { select: requestUserSelect } } });
        if (actorId !== null) await tx.trainingRequestReadState.upsert({ where: { requestId_userId: { requestId: id, userId: actorId } }, create: { requestId: id, userId: actorId, lastReadMessageId: message.id, lastReadAt: new Date() }, update: { lastReadMessageId: message.id, lastReadAt: new Date() } });
        const actionUrl = `/trainings/requests/${id}`;
        const baseUrl = process.env.NEXTAUTH_URL || '';
        if (senderRole === 'STAFF') {
          const preference = await tx.trainingRequestSubscription.findUnique({ where: { requestId_userId: { requestId: id, userId: row.userId } }, select: { websiteEnabled: true, discordEnabled: true } });
          await createSessionNotification({ recipientUserIds: preference?.websiteEnabled === false ? [] : [row.userId], title: `New ${row.training.name} scheduling message`, body: `Staff sent a new message about your ${row.training.name} training.`, actionUrl }, tx, notifications);
          if (preference?.discordEnabled) discordMessages.push({ userId: row.userId, content: `New message in Training Request #${id} from Staff: ${body}\n${baseUrl}${actionUrl}` });
        } else {
          const subscriptions = await tx.trainingRequestSubscription.findMany({ where: { requestId: id }, select: { userId: true, websiteEnabled: true, discordEnabled: true } });
          const staff = await tx.user.findMany({ where: { userPermissions: { some: { value: { gt: 0 }, permission: { key: { in: ['training:approve_request', 'training:mark', 'system:super_admin'] } } } } }, select: { id: true } });
          const eligible = new Set(staff.map(item => item.id));
          const recipients = subscriptions.filter(item => item.userId !== actorId && eligible.has(item.userId));
          await createSessionNotification({ recipientUserIds: recipients.filter(item => item.websiteEnabled).map(item => item.userId), title: `New ${row.training.name} request message`, body: body.length > 180 ? `${body.slice(0, 177)}...` : body, actionUrl }, tx, notifications);
          for (const item of recipients.filter(item => item.discordEnabled)) discordMessages.push({ userId: item.userId, content: `New message in Training Request #${id}: ${body}\n${baseUrl}${actionUrl}` });
        }
        await writeApiAudit(tx, audit, { action: 'training_request_message.created', resource: 'training_request_message', resourceId: String(message.id), targetUserIds: [row.userId], outcome: 'success', after: { requestId: id, messageId: message.id, senderRole } });
        return { message };
      }, { isolationLevel: 'Serializable' });
      if (outcome.error) return outcome.error;
      publishSessionNotifications(notifications);
      await Promise.allSettled(discordMessages.map(item => sendDiscordTrainingDm(item.userId, item.content)));
      publishRequestEvent(() => publishTrainingChatEvent(id, { source: 'message', messageId: outcome.message!.id }));
      return apiSuccess(serializeRequestMessage(outcome.message!, principal), { status: 201 });
    } catch (error) { return requestDatabaseError(error); }
  });
}
