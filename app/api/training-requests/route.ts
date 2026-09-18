import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { parseCursorPagination } from '@/lib/api/validation';
import { writeApiAudit } from '@/lib/api/audit';
import { parseTrainingRequestBody } from '@/lib/api/training-request-contract';
import { requestActor, isRequestStaff, requestInclude, serializeTrainingRequest, auditTrainingRequestRead, getTrainingRequest, canManageTrainingRequest, requestDatabaseError, publishRequestEvent } from '@/lib/api/training-requests';



import { prisma } from '@/lib/prisma';
import { canRequestTraining, getUnmetRequirements } from '@/lib/training-gating';

import { createSessionNotification, publishSessionNotifications, type SessionNotifications } from '@/lib/api/training-session-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { TRAINING_REQUEST_STATUSES, type TrainingRequestWorkflowStatus } from '@/lib/training-workflow';
import { runSerializableTransaction } from '@/lib/serializable-transaction';
import { canRetryFailedTraining, getFailedTrainingRetryAt } from '@/lib/training-retry';

const userSelect = { id: true, username: true, avatarUrl: true } as const;

export async function GET(request: Request) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['limit', 'cursor', 'status'].includes(key) || query.getAll(key).length !== 1)) return apiError(400, 'invalid_request', 'Unknown or repeated query parameter.');
    const paging = parseCursorPagination(query, { defaultLimit: 50, maxLimit: 100 });
    if (paging.error) return apiError(400, 'invalid_request', paging.error);
    const status = query.get('status');
    if (status !== null && !TRAINING_REQUEST_STATUSES.includes(status as TrainingRequestWorkflowStatus)) return apiError(400, 'invalid_request', 'Invalid request status.');
    const { limit, cursor } = paging.data!;
    const staff = isRequestStaff(principal);
    const rows = await prisma.trainingRequest.findMany({ where: { ...(!staff ? { userId: requestActor(principal)! } : {}), ...(status ? { status: status as TrainingRequestWorkflowStatus } : {}), ...(cursor ? { id: { lt: cursor } } : {}) }, include: requestInclude(principal), orderBy: { id: 'desc' }, take: limit + 1 });
    const data = rows.slice(0, limit).map(row => serializeTrainingRequest(row, principal));
    await auditTrainingRequestRead(audit, data);
    const response = apiSuccess(data, { meta: { limit, nextCursor: rows.length > limit ? String(data[limit - 1].id) : null, isStaff: staff } });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  });
}

export async function POST(request: Request) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
  try {
    if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Query parameters are not accepted.');
    const parsed = parseTrainingRequestBody(await readJsonBody(request), 'create');
    if (parsed.error) return parsed.error;
    const { userId: requestedUser, trainingId: requestedTraining, requestMessage = null } = parsed.data;
    const userId = requestedUser!, trainingId = requestedTraining!;
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return apiError(404, 'not_found', 'User not found.');
    if (!(principal.kind === 'user' && principal.userId === userId) && (!isRequestStaff(principal) || !await canManageTrainingRequest(principal, userId))) return apiError(403, 'forbidden', 'Training staff authority over this user is required.');
    const notifications: SessionNotifications = [];
    const outcome = await runSerializableTransaction(async (tx) => {
      notifications.length = 0;
      const training = await tx.training.findUnique({ where: { id: trainingId } });
      if (!training || !training.isActive) return { response: apiError(404, 'not_found', 'Training not found or inactive.') };
      if (!(principal.kind === 'user' && principal.userId === userId) && !await canManageTrainingRequest(principal, userId, tx)) return { response: apiError(403, 'forbidden', 'Insufficient training authority over this user.') };
      const unmet = await getUnmetRequirements(userId, trainingId, tx);
      if (unmet.missingRank || unmet.missingTrainings.length) return { response: apiError(403, 'forbidden', 'Requirements not met.', { missingRankId: unmet.missingRank?.id ?? null, missingTrainingIds: unmet.missingTrainings.map(item => item.id) }) };
      const [existingCredential, existingRequest] = await Promise.all([
        tx.userTraining.findUnique({
          where: { userId_trainingId: { userId, trainingId } },
        }),
        tx.trainingRequest.findFirst({
          where: {
            userId,
            trainingId,
            status: { in: ['pending', 'approved', 'in_training', 'needs_qualify'] },
          },
        }),
      ]);

      if (existingCredential && existingCredential.status !== 'failed') {
        return {
          error: 'You already have a training record for this training.',
        } as const;
      }
      if (
        existingCredential?.status === 'failed'
        && !canRetryFailedTraining(existingCredential.failedAt, existingCredential.statusUpdatedAt)
      ) {
        const retryAt = getFailedTrainingRetryAt(
          existingCredential.failedAt,
          existingCredential.statusUpdatedAt,
        );
        return {
          error: `You can request this training again after ${retryAt.toISOString()}.`,
          retryAt: retryAt.toISOString(),
        } as const;
      }
      if (existingRequest) {
        return { error: 'You already have an active request for this training' } as const;
      }

      const created = await tx.trainingRequest.create({
        data: {
          userId,
          trainingId,
          requestMessage,
          subscriptions: {
            create: { userId, websiteEnabled: true, discordEnabled: false },
          },
        },
        include: { training: true, user: { select: userSelect } },
      });

      const senderId = requestActor(principal);
      const senderRole = senderId === userId ? 'USER' as const : 'STAFF' as const;
      if (requestMessage) {
        const migratedByCompatibilityTrigger = await tx.trainingRequestMessage.count({
          where: {
            requestId: created.id,
            senderId: userId,
            senderRole: 'USER',
            body: requestMessage,
          },
        });
        if (migratedByCompatibilityTrigger && senderRole === 'STAFF') await tx.trainingRequestMessage.updateMany({ where: { requestId: created.id, senderId: userId, senderRole: 'USER', body: requestMessage }, data: { senderId, senderRole } });
        if (!migratedByCompatibilityTrigger) {
          await tx.trainingRequestMessage.create({
            data: {
              requestId: created.id,
              senderId,
              senderRole,
              body: requestMessage,
            },
          });
        }
      }

      const staff = await tx.user.findMany({ where: { userPermissions: { some: { value: { gt: 0 }, permission: { key: { in: ['training:approve_request', 'training:mark', 'system:super_admin'] } } } } }, select: { id: true } });
      await createSessionNotification({ recipientUserIds: staff.map(item => item.id), title: `New training request: ${training.name}`, body: `${created.user.username || 'A user'} requested ${training.name}.`, actionUrl: `/trainings/requests/${created.id}` }, tx, notifications);
      await writeApiAudit(tx, audit, { action: 'training_request.created', resource: 'training_request', resourceId: String(created.id), targetUserIds: [userId], outcome: 'success', after: { id: created.id, userId, trainingId, status: created.status } });
      return { created: await getTrainingRequest(created.id, principal, tx) } as const;
    });

    if ('response' in outcome) return outcome.response!;
    if ('error' in outcome) return apiError(409, 'conflict', outcome.error!, 'retryAt' in outcome ? { retryAt: outcome.retryAt } : {});
    publishSessionNotifications(notifications);
    publishRequestEvent(() => publishTrainingChatEvent(outcome.created!.id, { source: 'request-created' }));
    return apiSuccess(outcome.created, { status: 201 });
  } catch (error) { return requestDatabaseError(error); }
  });
}
