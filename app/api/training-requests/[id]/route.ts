import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { readJsonBody } from '@/lib/api/request';
import { writeApiAudit } from '@/lib/api/audit';
import { parseTrainingRequestBody } from '@/lib/api/training-request-contract';
import { requestId as parseRequestId, requestActor, isRequestStaff, getTrainingRequest, canManageTrainingRequest, auditTrainingRequestRead, requestDatabaseError, publishRequestEvent } from '@/lib/api/training-requests';
import { sessionJson as requestJson } from '@/lib/api/training-session-contract';



import { prisma } from '@/lib/prisma';

import {
  type TrainingRequestWorkflowStatus,
  requestStatusToUserTrainingStatus,
  validateTrainingTransition,
} from '@/lib/training-workflow';
import { createSessionNotification, publishSessionNotifications, type SessionNotifications } from '@/lib/api/training-session-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const id = parseRequestId((await context.params).id);
    if (!id || new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Invalid request ID or query.');
    const data = await getTrainingRequest(id, principal);
    if (!data) return apiError(404, 'not_found', 'Training request not found.');
    if (!(principal.kind === 'user' && principal.userId === data.userId) && !isRequestStaff(principal)) return apiError(403, 'forbidden', 'Training request access required.');
    await auditTrainingRequestRead(audit, [data], String(id));
    return apiSuccess(data, { meta: { isStaff: isRequestStaff(principal) } });
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
  try {

  const actorId = requestActor(principal);
  if (!(isRequestStaff(principal))) {
    return requestJson({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const requestId = parseRequestId(id);
  if (!requestId) {
    return apiError(400, 'invalid_request', 'Invalid training request ID.');
  }

  if (new URL(request.url).searchParams.size) return apiError(400, 'invalid_request', 'Query parameters are not accepted.');
  const parsed = parseTrainingRequestBody(await readJsonBody(request), 'update');
  if (parsed.error) return parsed.error;
  // Update payloads require a valid status in the canonical parser.
  const body = parsed.data as typeof parsed.data & { status: TrainingRequestWorkflowStatus };
  const existing = await prisma.trainingRequest.findUnique({
    where: { id: requestId },
    include: {
      training: true,
      sessionAttendee: { select: { sessionId: true } },
    },
  });
  if (!existing) {
    return requestJson({ error: 'Training request not found' }, { status: 404 });
  }

  const transition = validateTrainingTransition(existing.status, body.status, {
    requiresTrainingSession: existing.training.requiresTrainingSession,
    requiresOrbatQualification: existing.training.requiresOrbatQualification,
  });
  if (!transition.valid) {
    return requestJson({ error: transition.reason }, { status: 409 });
  }

  const adminResponse = body.adminResponse === undefined ? existing.adminResponse : body.adminResponse;
  const nextStatus = body.status;
  const nextUserTrainingStatus = requestStatusToUserTrainingStatus(nextStatus);
  const now = new Date();

  const notifications: SessionNotifications = [];
  const transitionApplied = await prisma.$transaction(async (tx) => {
    if (!await canManageTrainingRequest(principal, existing.userId, tx)) return 'denied' as const;
    const requestUpdate = await tx.trainingRequest.updateMany({
      where: { id: requestId, status: existing.status, updatedAt: existing.updatedAt },
      data: {
        status: nextStatus,
        adminResponse,
        handledByAdminId: actorId,
      },
    });
    if (requestUpdate.count !== 1) {
      return false;
    }

    if (nextUserTrainingStatus) {
      const currentCredential = await tx.userTraining.findUnique({
        where: {
          userId_trainingId: {
            userId: existing.userId,
            trainingId: existing.trainingId,
          },
        },
      });

      const isLegacyTerminal = currentCredential
        && ['finished', 'qualified'].includes(currentCredential.status)
        && body.status === 'approved';
      const credentialStatus = isLegacyTerminal
        ? currentCredential.status
        : nextUserTrainingStatus;

      const credential = await tx.userTraining.upsert({
        where: {
          userId_trainingId: {
            userId: existing.userId,
            trainingId: existing.trainingId,
          },
        },
        create: {
          userId: existing.userId,
          trainingId: existing.trainingId,
          trainerId: actorId,
          status: credentialStatus,
          needsRetraining: credentialStatus === 'failed',
          notes: adminResponse,
          statusUpdatedAt: now,
          trainingSessionCompletedAt: credentialStatus === 'finished' || credentialStatus === 'needs_qualify' ? now : null,
          orbatQualifiedAt: credentialStatus === 'qualified' ? now : null,
          failedAt: credentialStatus === 'failed' ? now : null,
        },
        update: isLegacyTerminal
          ? { trainerId: currentCredential.trainerId ?? actorId }
          : {
              trainerId: actorId,
              status: credentialStatus,
              needsRetraining: credentialStatus === 'failed',
              notes: adminResponse,
              statusUpdatedAt: now,
              ...(credentialStatus === 'finished' || credentialStatus === 'needs_qualify'
                ? { trainingSessionCompletedAt: now, orbatQualifiedAt: null, failedAt: null }
                : {}),
              ...(credentialStatus === 'qualified' ? { orbatQualifiedAt: now, failedAt: null } : {}),
              ...(credentialStatus === 'failed' ? { orbatQualifiedAt: null, failedAt: now } : {}),
              ...(['approved', 'in_training'].includes(credentialStatus)
                ? { orbatQualifiedAt: null, failedAt: null }
                : {}),
            },
      });

      if (!isLegacyTerminal && currentCredential?.status !== credentialStatus) {
        await tx.userTrainingStatusHistory.create({
          data: {
            userTrainingId: credential.id,
            fromStatus: currentCredential?.status ?? null,
            toStatus: credentialStatus,
            changedById: actorId,
            trainingSessionId: existing.sessionAttendee?.sessionId ?? null,
            notes: adminResponse,
          },
        });
      }
    }

    await tx.trainingRequestMessage.create({
      data: {
        requestId,
        senderRole: 'SYSTEM',
        body: `Request status changed from ${existing.status} to ${body.status}.`,
      },
    });

    if (adminResponse && adminResponse !== existing.adminResponse) {
      const migratedByCompatibilityTrigger = await tx.trainingRequestMessage.count({
        where: {
          requestId,
          senderId: actorId,
          senderRole: 'STAFF',
          body: adminResponse,
          createdAt: { gte: existing.updatedAt },
        },
      });
      if (!migratedByCompatibilityTrigger) {
        await tx.trainingRequestMessage.create({
          data: {
            requestId,
            senderId: actorId,
            senderRole: 'STAFF',
            body: adminResponse,
          },
        });
      }
    }
  const statusMessages: Record<string, string> = {
    approved: `Your ${existing.training.name} request was approved. Staff will coordinate your training session.`,
    rejected: `Your ${existing.training.name} request was declined.`,
    in_training: `Your ${existing.training.name} training is now in progress.`,
    finished: `You completed ${existing.training.name}.`,
    needs_qualify: `You can now use ${existing.training.name} ORBAT slots temporarily to demonstrate your skills.`,
    qualified: `You are now fully qualified for ${existing.training.name}.`,
    failed: `Your ${existing.training.name} qualification was marked as failed. Contact a trainer for next steps.`,
  };

  if (statusMessages[nextStatus]) {
    await createSessionNotification({
      recipientUserIds: [existing.userId],
      title: `${existing.training.name}: ${String(body.status).replaceAll('_', ' ')}`,
      body: statusMessages[nextStatus],
      actionUrl: `/trainings/requests/${requestId}`,
      createdById: actorId,
    }, tx, notifications);
  }

    await writeApiAudit(tx, audit, { action: 'training_request.updated', resource: 'training_request', resourceId: String(requestId), targetUserIds: [existing.userId], outcome: 'success', before: { status: existing.status }, after: { status: nextStatus } });
    return await getTrainingRequest(requestId, principal, tx);
  }, { isolationLevel: 'Serializable' });

  if (transitionApplied === 'denied') return apiError(403, 'forbidden', 'Insufficient training authority over this user.');
  if (!transitionApplied) {
    return requestJson(
      { error: 'This request changed while you were updating it. Refresh and try again.' },
      { status: 409 },
    );
  }

  publishRequestEvent(() => publishTrainingChatEvent(requestId, { source: 'status', status: body.status }));
  publishRequestEvent(() => publishUserProfileEvent(existing.userId, {
    source: 'training-request.updated',
    status: nextStatus,
    trainingId: existing.trainingId,
  }));

  publishSessionNotifications(notifications);
  return apiSuccess(transitionApplied);
  } catch (error) { return requestDatabaseError(error); }
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  return handleApiRequest(_request, undefined, async (principal, audit) => {
  try {

  const { id } = await context.params;
  const requestId = parseRequestId(id);
  if (!requestId) {
    return apiError(400, 'invalid_request', 'Invalid training request ID.');
  }

  const existing = await prisma.trainingRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      userId: true,
      trainingId: true,
      status: true,
      updatedAt: true,
      sessionAttendee: { select: { id: true } },
    },
  });
  if (!existing) {
    return requestJson({ error: 'Training request not found' }, { status: 404 });
  }

  const actorId = requestActor(principal);
  const staffViewer = isRequestStaff(principal);
  if (existing.userId !== actorId && !staffViewer) {
    return requestJson({ error: 'Forbidden' }, { status: 403 });
  }

  if (!['pending', 'approved'].includes(existing.status)) {
    return requestJson({ error: 'Only pending or approved requests can be cancelled' }, { status: 409 });
  }

  if (new URL(_request.url).searchParams.size) return apiError(400, 'invalid_request', 'Query parameters are not accepted.');
  if ((await _request.text()).trim()) return apiError(400, 'invalid_request', 'Cancellation does not accept a request body.');
  const cancelled = await prisma.$transaction(async (tx) => {
    if (!await canManageTrainingRequest(principal, existing.userId, tx)) return 'denied' as const;
    const requestUpdate = await tx.trainingRequest.updateMany({
      where: { id: requestId, status: existing.status, updatedAt: existing.updatedAt },
      data: {
        status: 'cancelled',
        assignedTrainerId: null,
        handledByAdminId: staffViewer ? actorId : undefined,
      },
    });
    if (requestUpdate.count !== 1) {
      return false;
    }

    if (existing.status === 'approved') {
      await tx.userTraining.deleteMany({
        where: {
          userId: existing.userId,
          trainingId: existing.trainingId,
          status: 'approved',
        },
      });
    }

    if (existing.sessionAttendee) {
      await tx.trainingSessionAttendee.updateMany({
        where: {
          id: existing.sessionAttendee.id,
          trainingRequestId: requestId,
          status: { in: ['scheduled', 'attended'] },
        },
        data: {
          status: 'cancelled',
          reminder24hSentAt: null,
        },
      });
      await tx.trainingSessionAttendee.updateMany({
        where: {
          id: existing.sessionAttendee.id,
          trainingRequestId: requestId,
        },
        data: {
          reminder24hSentAt: null,
          // Preserve terminal attendance outcomes for audit while removing
          // the cancelled request's active session association.
          trainingRequestId: null,
        },
      });
    }

    await tx.trainingRequestMessage.create({
      data: {
        requestId,
        senderRole: 'SYSTEM',
        body: staffViewer ? 'The request was cancelled by staff.' : 'The request was cancelled by the requester.',
      },
    });
    await writeApiAudit(tx, audit, { action: 'training_request.cancelled', resource: 'training_request', resourceId: String(requestId), targetUserIds: [existing.userId], outcome: 'success', before: { status: existing.status }, after: { status: 'cancelled', detachedAttendeeId: existing.sessionAttendee?.id ?? null } });
    return true;
  }, { isolationLevel: 'Serializable' });

  if (cancelled === 'denied') return apiError(403, 'forbidden', 'Insufficient training authority over this user.');
  if (!cancelled) {
    return requestJson(
      { error: 'This request changed while you were cancelling it. Refresh and try again.' },
      { status: 409 },
    );
  }

  publishRequestEvent(() => publishTrainingChatEvent(requestId, { source: 'status', status: 'cancelled' }));
  publishRequestEvent(() => publishUserProfileEvent(existing.userId, { source: 'training-request.cancelled' }));
  return apiSuccess(null);
  } catch (error) { return requestDatabaseError(error); }
  });
}
