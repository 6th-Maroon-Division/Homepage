import { handleApiRequest } from '@/lib/api/handler';
import { apiError, apiSuccess } from '@/lib/api/response';
import { writeApiAudit } from '@/lib/api/audit';
import { isSessionStaff, sessionActor, sessionId as parseSessionId, validateSessionBody, sessionJson, safeSessionPublish, sessionDatabaseError, auditSessionRead, sessionSnapshot, attendeeSnapshot } from '@/lib/api/training-session-contract';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertEligibleTrainingStaff } from '@/lib/training-staff';
import { createSessionNotification, publishSessionNotifications, type SessionNotifications } from '@/lib/api/training-session-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { appendBotEvent } from '@/lib/bot-events';
import { Prisma } from '@/generated/prisma/client';

const userSelect = { id: true, username: true, avatarUrl: true } as const;
type RouteContext = { params: Promise<{ id: string }> };

const SESSION_STATUSES = ['proposed', 'scheduled', 'in_progress', 'completed', 'cancelled'] as const;
type SessionStatus = (typeof SESSION_STATUSES)[number];
type JsonObject = Record<string, unknown>;

class SessionUpdateError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const ALLOWED_SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  proposed: ['proposed', 'scheduled', 'cancelled'],
  scheduled: ['scheduled', 'in_progress', 'cancelled'],
  in_progress: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function GET(_request: Request, context: RouteContext) {
  return handleApiRequest(_request, undefined, async (principal, audit) => {
    const path = await context.params;
    if (!parseSessionId(path.id)) return apiError(400, 'invalid_request', 'Invalid session or attendee ID.');

  if (new URL(_request.url).searchParams.size) return apiError(400, 'invalid_request', 'Query parameters are not accepted.');
  const { id } = await context.params;
  const sessionId = parseSessionId(id)!;

  const viewerId = sessionActor(principal) ?? 0;
  const staffViewer = isSessionStaff(principal);
  const trainingSession = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      training: true,
      trainer: { select: userSelect },
      attendees: {
        include: { user: { select: userSelect }, trainingRequest: { select: { id: true, status: true } } },
      },
    },
  });
  if (!trainingSession) {
    return sessionJson({ error: 'Training session not found' }, { status: 404 });
  }
  if (
    !staffViewer
    && !trainingSession.attendees.some(
      (item) => item.userId === viewerId && item.status !== 'cancelled',
    )
  ) {
    return sessionJson({ error: 'Forbidden' }, { status: 403 });
  }
  if (!staffViewer && ['proposed', 'cancelled'].includes(trainingSession.status)) {
    return sessionJson({ error: 'Training session not found' }, { status: 404 });
  }
  await auditSessionRead(audit, [{ ...trainingSession, attendees: staffViewer ? trainingSession.attendees : trainingSession.attendees.filter(item => item.userId === viewerId) }], String(sessionId));
  return sessionJson({
    ...trainingSession,
    attendees: staffViewer
      ? trainingSession.attendees
      : trainingSession.attendees.filter((item) => item.userId === viewerId),
    server: 'Arma3 Training Server',
    isStaff: staffViewer,
  });
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return handleApiRequest(request, undefined, async (principal, audit) => {
    const path = await context.params;
    if (!parseSessionId(path.id)) return apiError(400, 'invalid_request', 'Invalid session or attendee ID.');

    const invalid = await validateSessionBody(request, 'update');
    if (invalid) return invalid;
  const actorId = sessionActor(principal);
  if (!(isSessionStaff(principal))) {
    return sessionJson({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const sessionId = parseSessionId(id)!;

  const existing = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      training: true,
    },
  });
  if (!existing) {
    return sessionJson({ error: 'Training session not found' }, { status: 404 });
  }

  // The canonical contract above already validated this body.
  const body = await request.json() as JsonObject;
  const status = (body.status === undefined ? existing.status : body.status) as SessionStatus;

  if (!ALLOWED_SESSION_TRANSITIONS[existing.status].includes(status)) {
    return sessionJson(
      { error: `Training session cannot move from ${existing.status} to ${status}` },
      { status: 409 },
    );
  }
  if (!existing.training.isActive && status !== 'cancelled') {
    return sessionJson({ error: 'Inactive training sessions can only be cancelled' }, { status: 409 });
  }

  const trainerId = body.trainerId === undefined
    ? existing.trainerId
    : body.trainerId === null ? null : (body.trainerId as number);

  if (trainerId !== null && status !== 'cancelled' && !(await assertEligibleTrainingStaff(trainerId))) {
    return sessionJson({ error: 'Select an eligible trainer' }, { status: 400 });
  }
  const selectedTrainer = trainerId === null
    ? null
    : await prisma.user.findUnique({ where: { id: trainerId }, select: userSelect });

  const startsAt = body.startsAt === undefined
    ? existing.startsAt
    : typeof body.startsAt === 'string' && body.startsAt.trim() ? new Date(body.startsAt) : null;

  if (['scheduled', 'in_progress', 'completed'].includes(status) && (!startsAt || !trainerId)) {
    return sessionJson({ error: 'Scheduled and active sessions require a trainer and start time' }, { status: 400 });
  }

  const durationMinutes = body.durationMinutes === undefined || body.durationMinutes === null
    ? body.durationMinutes === undefined ? existing.durationMinutes : null
    : (body.durationMinutes as number);

  const startsAtChanged = existing.startsAt?.getTime() !== startsAt?.getTime();
  const notifications: SessionNotifications = [];
  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const currentTraining = await tx.training.findUnique({ where: { id: existing.trainingId } });
      if (!currentTraining || !currentTraining.isActive && status !== 'cancelled') throw new SessionUpdateError('Training no longer accepts session changes.', 409);
      if (trainerId !== null && status !== 'cancelled') {
        const eligible = await tx.userPermission.findFirst({ where: { userId: trainerId, value: { gt: 0 }, permission: { key: { in: ['training:approve_request', 'training:mark', 'system:super_admin'] } } }, select: { id: true } });
        if (!eligible) throw new SessionUpdateError('The selected trainer is no longer eligible.', 409);
      }
      const updateResult = await tx.trainingSession.updateMany({
        where: { id: sessionId, status: existing.status, updatedAt: existing.updatedAt },
        data: {
          trainerId,
          startsAt,
          durationMinutes,
          status,
          specialInstructions: body.specialInstructions === undefined
            ? existing.specialInstructions
            : typeof body.specialInstructions === 'string'
              ? body.specialInstructions.trim().slice(0, 4000) || null
              : null,
          cancelledAt: status === 'cancelled' ? existing.cancelledAt ?? new Date() : null,
        },
      });
      if (updateResult.count !== 1) {
        throw new SessionUpdateError(
          'Training session changed while it was being updated. Refresh and try again.',
          409,
        );
      }

      // Read child rows inside the serializable transaction. Session CAS alone
      // cannot detect an attendee inserted or removed concurrently.
      const activeAttendees = await tx.trainingSessionAttendee.findMany({
        where: { sessionId, status: { not: 'cancelled' } },
        include: {
          trainingRequest: {
            select: { id: true, userId: true, trainingId: true, status: true },
          },
        },
      });
      const linkedRequestIds = activeAttendees.flatMap((attendee) => (
        attendee.trainingRequest?.id ? [attendee.trainingRequest.id] : []
      ));
      const attendeeIds = Array.from(new Set(activeAttendees.map((attendee) => attendee.userId)));

      if (
        ['scheduled', 'in_progress'].includes(status)
        && activeAttendees.some((attendee) => attendee.trainingRequest?.status === 'pending')
      ) {
        throw new SessionUpdateError(
          'Approve every linked pending request before confirming or starting the session',
          409,
        );
      }

      if (status === 'completed') {
        if (activeAttendees.some((attendee) => attendee.status === 'scheduled')) {
          throw new SessionUpdateError(
            'Record attendance for every scheduled attendee before completing the session',
            409,
          );
        }
      }

      if (linkedRequestIds.length > 0) {
        await tx.trainingRequest.updateMany({
          where: { id: { in: linkedRequestIds } },
          data: { assignedTrainerId: status === 'cancelled' ? null : trainerId },
        });
        if (status !== 'cancelled' && trainerId) {
          await tx.trainingRequestSubscription.createMany({
            data: linkedRequestIds.map((requestId) => ({
              requestId,
              userId: trainerId,
              websiteEnabled: true,
              discordEnabled: false,
            })),
            skipDuplicates: true,
          });
        }
      }

      if (status === 'in_progress' && existing.status !== 'in_progress') {
        const approvedRequests = await tx.trainingRequest.findMany({
          where: { id: { in: linkedRequestIds }, status: 'approved' },
          select: { id: true, userId: true, trainingId: true, updatedAt: true },
        });
        const progressTime = new Date();
        for (const trainingRequest of approvedRequests) {
          const requestUpdate = await tx.trainingRequest.updateMany({
            where: {
              id: trainingRequest.id,
              status: 'approved',
              updatedAt: trainingRequest.updatedAt,
            },
            data: { status: 'in_training', handledByAdminId: actorId },
          });
          if (requestUpdate.count !== 1) {
            throw new SessionUpdateError(
              'A linked training request changed while the session was starting. Refresh and try again.',
              409,
            );
          }

          const previousCredential = await tx.userTraining.findUnique({
            where: {
              userId_trainingId: {
                userId: trainingRequest.userId,
                trainingId: trainingRequest.trainingId,
              },
            },
          });
          if (previousCredential) {
            const credentialUpdate = await tx.userTraining.updateMany({
              where: {
                id: previousCredential.id,
                status: 'approved',
                statusUpdatedAt: previousCredential.statusUpdatedAt,
              },
              data: {
                status: 'in_training',
                needsRetraining: false,
                trainerId: trainerId!,
                statusUpdatedAt: progressTime,
                orbatQualifiedAt: null,
                failedAt: null,
              },
            });
            if (credentialUpdate.count !== 1) {
              throw new SessionUpdateError(
                'A linked training record changed while the session was starting. Refresh and try again.',
                409,
              );
            }
            await tx.userTrainingStatusHistory.create({
              data: {
                userTrainingId: previousCredential.id,
                fromStatus: 'approved',
                toStatus: 'in_training',
                changedById: actorId,
                trainingSessionId: sessionId,
                notes: `Training Session #${sessionId} started.`,
              },
            });
          } else {
            const credential = await tx.userTraining.create({
              data: {
                userId: trainingRequest.userId,
                trainingId: trainingRequest.trainingId,
                trainerId: trainerId!,
                status: 'in_training',
                needsRetraining: false,
                statusUpdatedAt: progressTime,
              },
            });
            await tx.userTrainingStatusHistory.create({
              data: {
                userTrainingId: credential.id,
                toStatus: 'in_training',
                changedById: actorId,
                trainingSessionId: sessionId,
                notes: `Training Session #${sessionId} started.`,
              },
            });
          }

          await tx.trainingRequestMessage.create({
            data: {
              requestId: trainingRequest.id,
              senderRole: 'SYSTEM',
              body: 'Training started. Status changed from approved to in training.',
            },
          });
        }
      }

      if (status === 'cancelled') {
        await tx.trainingSessionAttendee.updateMany({
          where: { sessionId, status: { in: ['scheduled', 'attended'] } },
          data: { status: 'cancelled', reminder24hSentAt: null },
        });
        // Keep the cancelled attendance record for audit, but release its
        // one-to-one request link so the same request can be rescheduled.
        await tx.trainingSessionAttendee.updateMany({
          where: { sessionId, trainingRequestId: { not: null } },
          data: { trainingRequestId: null },
        });
      } else if (startsAtChanged) {
        await tx.trainingSessionAttendee.updateMany({
          where: { sessionId },
          data: { reminder24hSentAt: null },
        });
      }

      const hasMaterialChange = status !== existing.status
        || startsAtChanged
        || trainerId !== existing.trainerId
        || durationMinutes !== existing.durationMinutes
        || body.specialInstructions !== undefined;
      if (hasMaterialChange && linkedRequestIds.length > 0) {
        const auditBody = status === 'cancelled'
          ? `Training Session #${sessionId} was cancelled. This request remains open for rescheduling.`
          : status === 'scheduled' && startsAt
            ? `Training Session #${sessionId} was confirmed with ${selectedTrainer?.username || 'the assigned trainer'} for ${startsAt.toISOString()} on the Arma3 Training Server.`
            : status !== existing.status
              ? `Training Session #${sessionId} changed from ${existing.status} to ${status}.`
              : `Training Session #${sessionId} scheduling details were updated.`;
        await tx.trainingRequestMessage.createMany({
          data: linkedRequestIds.map((requestId) => ({
            requestId,
            senderRole: 'SYSTEM' as const,
            body: auditBody,
          })),
        });
      }

      const trainingSession = await tx.trainingSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: {
          training: true,
          trainer: { select: userSelect },
          attendees: { include: { user: { select: userSelect }, trainingRequest: { select: { id: true, status: true } } } },
        },
      });
  if (status === 'cancelled' && existing.status !== 'cancelled') {
    await createSessionNotification({
      recipientUserIds: attendeeIds,
      title: `${existing.training.name} training cancelled`,
      body: 'Your scheduled training session was cancelled. Open the training chat to coordinate a new time.',
      actionUrl: '/profile?tab=trainings',
      createdById: actorId,
    }, tx, notifications);
  } else if (
    ['scheduled', 'in_progress'].includes(status)
    && startsAt
    && (
      existing.status !== 'scheduled'
      || existing.startsAt?.getTime() !== startsAt.getTime()
      || existing.trainerId !== trainerId
      || existing.durationMinutes !== durationMinutes
    )
  ) {
    await createSessionNotification({
      recipientUserIds: attendeeIds,
      title: `${existing.training.name} training updated`,
      body: `The session is scheduled for ${startsAt.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC.`,
      actionUrl: '/profile?tab=trainings',
      createdById: actorId,
    }, tx, notifications);
  }
  if (
    status !== 'cancelled'
    && trainerId
    && trainerId !== existing.trainerId
  ) {
    await createSessionNotification({
      recipientUserIds: [trainerId],
      title: `Assigned: ${existing.training.name} training`,
      body: `You were assigned to Training Session #${sessionId}.`,
      actionUrl: `/admin/trainings?tab=sessions&session=${sessionId}`,
      createdById: actorId,
    }, tx, notifications);
  }

  if (status === 'cancelled' || (startsAt && ['scheduled', 'in_progress'].includes(status))) {
    await appendBotEvent({
      type: status === 'cancelled' ? 'training.cancelled' : 'training.updated',
      aggregate: 'training', aggregateId: sessionId, payload: {
        trainingId: existing.trainingId, sessionId, title: existing.training.name,
        startsAt: startsAt?.toISOString() ?? null,
        endsAt: startsAt && durationMinutes !== null ? new Date(startsAt.getTime() + durationMinutes * 60_000).toISOString() : null,
        websiteUrl: `/trainings/sessions/${sessionId}`, version: trainingSession.updatedAt.toISOString(),
      },
    }, tx);
  }

      await writeApiAudit(tx, audit, { action: 'training_session.updated', resource: 'training_session', resourceId: String(trainingSession.id), targetUserIds: attendeeIds, outcome: 'success', before: sessionSnapshot(existing), after: sessionSnapshot(trainingSession) });
      return { trainingSession, linkedRequestIds, attendeeIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof SessionUpdateError) {
      return sessionJson({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return sessionJson(
        { error: 'Training session changed concurrently. Refresh and try again.' },
        { status: 409 },
      );
    }
    return sessionDatabaseError(error);
  }

  publishSessionNotifications(notifications);
  const updated = outcome.trainingSession;
  const attendeeIds = outcome.attendeeIds;
  for (const attendeeId of attendeeIds) {
    safeSessionPublish(() => publishUserProfileEvent(attendeeId, { source: 'training-session.updated', sessionId }));
  }
  for (const requestId of outcome.linkedRequestIds) {
    safeSessionPublish(() => publishTrainingChatEvent(requestId, { source: 'schedule', sessionId, status }));
  }
  return sessionJson({ ...updated, server: 'Arma3 Training Server' });
  });
}
