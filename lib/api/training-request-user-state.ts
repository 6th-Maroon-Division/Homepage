import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { handleApiRequest } from './handler';
import { readJsonBody } from './request';
import { apiError, apiSuccess } from './response';
import { canAccessApiUser } from './auth';
import { writeApiAudit } from './audit';
import { requestId, isRequestStaff, requestDatabaseError } from './training-requests';
const fields = ['training:approve_request', 'training:mark', 'system:super_admin'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const subscriptionDto = (value: { websiteEnabled: boolean; discordEnabled: boolean } | null) => ({ websiteEnabled: value?.websiteEnabled ?? false, discordEnabled: value?.discordEnabled ?? false });
export function trainingRequestUserState(request: Request, params: { id: string; userId: string }, operation: 'read' | 'subscription' | 'read-state') {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Query parameters are not accepted.');
    const id = requestId(params.id);
    const userId = params.userId === 'me' && principal.kind === 'user' ? principal.userId : requestId(params.userId);
    if (!id || !userId) return apiError(400, 'invalid_request', 'Invalid request or user ID. Bots must use numeric user IDs.');
    let input: Record<string, unknown> = {};
    if (operation !== 'read') {
      const body = await readJsonBody(request);
      if (!object(body) || !Object.keys(body).length) return apiError(422, 'validation_failed', 'Provide a nonempty object.');
      if (operation === 'subscription' && (Object.keys(body).some(key => !['websiteEnabled', 'discordEnabled'].includes(key)) || Object.values(body).some(value => typeof value !== 'boolean'))) return apiError(422, 'validation_failed', 'Provide only boolean notification preferences.');
      if (operation === 'read-state' && (Object.keys(body).length !== 1 || typeof body.lastReadMessageId !== 'number' || !requestId(String(body.lastReadMessageId)))) return apiError(422, 'validation_failed', 'Provide a numeric positive lastReadMessageId.');
      input = body;
    }
    const execute = async (db: Prisma.TransactionClient) => {
      const target = await db.user.findUnique({ where: { id: userId }, select: { id: true, userPermissions: { where: { value: { gt: 0 }, permission: { key: { in: fields } } }, select: { id: true } } } });
      const row = await db.trainingRequest.findUnique({ where: { id }, select: { userId: true } });
      if (!target || !row) return apiError(404, 'not_found', 'Training request or user not found.');
      if (!(principal.kind === 'user' && principal.userId === row.userId) && !isRequestStaff(principal)) return apiError(403, 'forbidden', 'Training request access required.');
      if (userId !== row.userId && !target.userPermissions.length) return apiError(403, 'forbidden', 'The target user cannot access this training request.');
      if (!await canAccessApiUser(principal, userId, 'user:edit', db)) return apiError(403, 'forbidden', 'Insufficient rights to manage this user’s request settings.');
      const where = { requestId_userId: { requestId: id, userId } };
      if (operation === 'read') {
        const data = subscriptionDto(await db.trainingRequestSubscription.findUnique({ where }));
        if (principal.kind === 'bot' || principal.userId !== userId) await writeApiAudit(db, audit, { action: 'user_data.read', resource: 'training_request_subscription', resourceId: String(id), targetUserIds: [userId], outcome: 'success' });
        return apiSuccess(data);
      }
      if (operation === 'subscription') {
        const before = subscriptionDto(await db.trainingRequestSubscription.findUnique({ where }));
        const after = { ...before, ...input } as typeof before;
        if (after.discordEnabled && !await db.authAccount.count({ where: { userId, provider: 'discord' } })) return apiError(409, 'conflict', 'Link a Discord account before enabling Discord notifications.');
        await db.trainingRequestSubscription.upsert({ where, create: { requestId: id, userId, ...after }, update: after });
        await writeApiAudit(db, audit, { action: 'training_request_subscription.updated', resource: 'training_request_subscription', resourceId: String(id), targetUserIds: [userId], outcome: 'success', before, after });
        return apiSuccess(after);
      }
      const message = await db.trainingRequestMessage.findFirst({ where: { id: input.lastReadMessageId as number, requestId: id }, select: { id: true } });
      if (!message) return apiError(404, 'not_found', 'Message not found in this training request.');
      const before = await db.trainingRequestReadState.findUnique({ where });
      if (before?.lastReadMessageId && before.lastReadMessageId >= message.id) return apiSuccess({ lastReadMessageId: before.lastReadMessageId, lastReadAt: before.lastReadAt?.toISOString() ?? null });
      const after = await db.trainingRequestReadState.upsert({ where, create: { requestId: id, userId, lastReadMessageId: message.id, lastReadAt: new Date() }, update: { lastReadMessageId: message.id, lastReadAt: new Date() } });
      await writeApiAudit(db, audit, { action: 'training_request_read_state.updated', resource: 'training_request_read_state', resourceId: String(id), targetUserIds: [userId], outcome: 'success', before: { lastReadMessageId: before?.lastReadMessageId ?? null }, after: { lastReadMessageId: after.lastReadMessageId } });
      return apiSuccess({ lastReadMessageId: after.lastReadMessageId, lastReadAt: after.lastReadAt?.toISOString() ?? null });
    };
    try { return operation === 'read' ? await execute(prisma) : await prisma.$transaction(execute, { isolationLevel: 'Serializable' }); } catch (error) { return requestDatabaseError(error); }
  });
}
