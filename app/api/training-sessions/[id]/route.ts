import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { assertEligibleTrainingStaff, isTrainingStaff } from '@/lib/training-staff';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === 'string' && (SESSION_STATUSES as readonly string[]).includes(value);
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await context.params;
  const sessionId = parsePositiveInteger(id);
  if (!sessionId) {
    return NextResponse.json({ error: 'Invalid training session id' }, { status: 400 });
  }
  const viewerId = Number(session.user.id);
  const staffViewer = await isTrainingStaff(viewerId);
  const trainingSession = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      training: true,
      trainer: { select: userSelect },
      attendees: {
        include: { user: { select: userSelect }, trainingRequest: { select: { id: true } } },
      },
    },
  });
  if (!trainingSession) {
    return NextResponse.json({ error: 'Training session not found' }, { status: 404 });
  }
  if (
    !staffViewer
    && !trainingSession.attendees.some(
      (item) => item.userId === viewerId && item.status !== 'cancelled',
    )
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!staffViewer && ['proposed', 'cancelled'].includes(trainingSession.status)) {
    return NextResponse.json({ error: 'Training session not found' }, { status: 404 });
  }
  return NextResponse.json({
    ...trainingSession,
    attendees: staffViewer
      ? trainingSession.attendees
      : trainingSession.attendees.filter((item) => item.userId === viewerId),
    server: 'Arma3 Training Server',
    isStaff: staffViewer,
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actorId = Number(authSession.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const sessionId = parsePositiveInteger(id);
  if (!sessionId) {
    return NextResponse.json({ error: 'Invalid training session id' }, { status: 400 });
  }
  const existing = await prisma.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      training: true,
    },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Training session not found' }, { status: 404 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isJsonObject(parsedBody)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }
  const body = parsedBody;
  const status = body.status === undefined ? existing.status : body.status;
  if (!isSessionStatus(status)) {
    return NextResponse.json({ error: 'Invalid session status' }, { status: 400 });
  }
  if (!ALLOWED_SESSION_TRANSITIONS[existing.status].includes(status)) {
    return NextResponse.json(
      { error: `Training session cannot move from ${existing.status} to ${status}` },
      { status: 409 },
    );
  }
  if (!existing.training.isActive && status !== 'cancelled') {
    return NextResponse.json({ error: 'Inactive training sessions can only be cancelled' }, { status: 409 });
  }

  const trainerId = body.trainerId === undefined
    ? existing.trainerId
    : body.trainerId === null ? null : parsePositiveInteger(body.trainerId);
  if (body.trainerId !== undefined && body.trainerId !== null && trainerId === null) {
    return NextResponse.json({ error: 'trainerId must be a positive integer or null' }, { status: 400 });
  }
  if (trainerId !== null && status !== 'cancelled' && !(await assertEligibleTrainingStaff(trainerId))) {
    return NextResponse.json({ error: 'Select an eligible trainer' }, { status: 400 });
  }
  const selectedTrainer = trainerId === null
    ? null
    : await prisma.user.findUnique({ where: { id: trainerId }, select: userSelect });
  if (body.startsAt !== undefined && body.startsAt !== null && typeof body.startsAt !== 'string') {
    return NextResponse.json({ error: 'startsAt must be an ISO date string or null' }, { status: 400 });
  }
  const startsAt = body.startsAt === undefined
    ? existing.startsAt
    : typeof body.startsAt === 'string' && body.startsAt.trim() ? new Date(body.startsAt) : null;
  if (typeof body.startsAt === 'string' && (!body.startsAt.trim() || Number.isNaN(startsAt?.getTime()))) {
    return NextResponse.json({ error: 'Invalid startsAt value' }, { status: 400 });
  }
  if (['scheduled', 'in_progress', 'completed'].includes(status) && (!startsAt || !trainerId)) {
    return NextResponse.json({ error: 'Scheduled and active sessions require a trainer and start time' }, { status: 400 });
  }

  const durationMinutes = body.durationMinutes === undefined || body.durationMinutes === null
    ? body.durationMinutes === undefined ? existing.durationMinutes : null
    : parsePositiveInteger(body.durationMinutes);
  if (
    body.durationMinutes !== undefined
    && body.durationMinutes !== null
    && (durationMinutes === null || durationMinutes > 1440)
  ) {
    return NextResponse.json({ error: 'Duration must be between 1 and 1440 minutes' }, { status: 400 });
  }

  if (
    body.specialInstructions !== undefined
    && body.specialInstructions !== null
    && typeof body.specialInstructions !== 'string'
  ) {
    return NextResponse.json({ error: 'specialInstructions must be a string or null' }, { status: 400 });
  }

  const startsAtChanged = existing.startsAt?.getTime() !== startsAt?.getTime();
  let outcome;
  try {
    outcome = await prisma.$transaction(async (tx) => {
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
                trainerId: trainerId ?? actorId,
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
                trainerId: trainerId ?? actorId,
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
          attendees: { include: { trainingRequest: { select: { id: true } } } },
        },
      });
      return { trainingSession, linkedRequestIds, attendeeIds };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof SessionUpdateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json(
        { error: 'Training session changed concurrently. Refresh and try again.' },
        { status: 409 },
      );
    }
    throw error;
  }

  const updated = outcome.trainingSession;
  const attendeeIds = outcome.attendeeIds;
  if (status === 'cancelled' && existing.status !== 'cancelled') {
    await createTrainingNotification({
      recipientUserIds: attendeeIds,
      title: `${existing.training.name} training cancelled`,
      body: 'Your scheduled training session was cancelled. Open the training chat to coordinate a new time.',
      actionUrl: '/profile?tab=trainings',
      createdById: actorId,
    });
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
    await createTrainingNotification({
      recipientUserIds: attendeeIds,
      title: `${existing.training.name} training updated`,
      body: `The session is scheduled for ${startsAt.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC.`,
      actionUrl: '/profile?tab=trainings',
      createdById: actorId,
    });
  }
  if (
    status !== 'cancelled'
    && trainerId
    && trainerId !== existing.trainerId
  ) {
    await createTrainingNotification({
      recipientUserIds: [trainerId],
      title: `Assigned: ${existing.training.name} training`,
      body: `You were assigned to Training Session #${sessionId}.`,
      actionUrl: `/admin/trainings?tab=sessions&session=${sessionId}`,
      createdById: actorId,
    });
  }

  for (const attendeeId of attendeeIds) {
    publishUserProfileEvent(attendeeId, { source: 'training-session.updated', sessionId });
  }
  for (const requestId of outcome.linkedRequestIds) {
    publishTrainingChatEvent(requestId, { source: 'schedule', sessionId, status });
  }
  return NextResponse.json({ ...updated, server: 'Arma3 Training Server' });
}
