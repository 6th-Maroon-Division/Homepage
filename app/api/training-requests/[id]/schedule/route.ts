import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { assertEligibleTrainingStaff, isTrainingStaff } from '@/lib/training-staff';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { Prisma } from '@/generated/prisma/client';

const trainerSelect = { id: true, username: true, avatarUrl: true } as const;

type JsonObject = Record<string, unknown>;

class ScheduleConflictError extends Error {}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const actorId = Number(session.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const requestId = parsePositiveInteger(id);
  if (!requestId) {
    return NextResponse.json({ error: 'Invalid training request id' }, { status: 400 });
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
  const trainerId = parsePositiveInteger(body.trainerId ?? body.assignedTrainerId);
  if (!trainerId || !(await assertEligibleTrainingStaff(trainerId))) {
    return NextResponse.json({ error: 'Select an eligible trainer' }, { status: 400 });
  }

  for (const field of ['confirmed', 'confirm'] as const) {
    if (body[field] !== undefined && typeof body[field] !== 'boolean') {
      return NextResponse.json({ error: `${field} must be a boolean` }, { status: 400 });
    }
  }
  if (body.status !== undefined && body.status !== 'proposed' && body.status !== 'scheduled') {
    return NextResponse.json({ error: 'status must be proposed or scheduled' }, { status: 400 });
  }
  const confirmed = body.confirmed === true || body.confirm === true || body.status === 'scheduled';
  const hasStartsAt = Object.prototype.hasOwnProperty.call(body, 'startsAt')
    || Object.prototype.hasOwnProperty.call(body, 'scheduledAt')
    || Object.prototype.hasOwnProperty.call(body, 'dateTime');
  const rawStartsAt = Object.prototype.hasOwnProperty.call(body, 'startsAt')
    ? body.startsAt
    : Object.prototype.hasOwnProperty.call(body, 'scheduledAt') ? body.scheduledAt : body.dateTime;
  if (rawStartsAt !== undefined && rawStartsAt !== null && typeof rawStartsAt !== 'string') {
    return NextResponse.json({ error: 'Training date/time must be an ISO date string or null' }, { status: 400 });
  }
  const startsAt = typeof rawStartsAt === 'string' && rawStartsAt.trim()
    ? new Date(rawStartsAt)
    : null;
  if (typeof rawStartsAt === 'string' && (!rawStartsAt.trim() || Number.isNaN(startsAt?.getTime()))) {
    return NextResponse.json({ error: 'Invalid training date/time' }, { status: 400 });
  }

  const hasExplicitDuration = body.durationMinutes !== null
    && body.durationMinutes !== undefined
    && body.durationMinutes !== '';
  const durationMinutes = !hasExplicitDuration
    ? null
    : parsePositiveInteger(body.durationMinutes);
  if (hasExplicitDuration && (durationMinutes === null || durationMinutes > 1440)) {
    return NextResponse.json({ error: 'Duration must be between 1 and 1440 minutes' }, { status: 400 });
  }

  if (
    body.specialInstructions !== undefined
    && body.specialInstructions !== null
    && typeof body.specialInstructions !== 'string'
  ) {
    return NextResponse.json({ error: 'specialInstructions must be a string or null' }, { status: 400 });
  }
  const specialInstructions = typeof body.specialInstructions === 'string'
    ? body.specialInstructions.trim().slice(0, 4000) || null
    : body.specialInstructions === null ? null : undefined;
  const trainingRequest = await prisma.trainingRequest.findUnique({
    where: { id: requestId },
    include: {
      training: true,
      assignedTrainer: { select: trainerSelect },
      sessionAttendee: { include: { session: true } },
    },
  });
  if (!trainingRequest) {
    return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
  }
  if (!trainingRequest.training.isActive) {
    return NextResponse.json({ error: 'Inactive trainings cannot be scheduled' }, { status: 409 });
  }
  if (!trainingRequest.training.requiresTrainingSession) {
    return NextResponse.json({ error: 'This training does not require a scheduled session' }, { status: 409 });
  }
  if (['rejected', 'completed', 'finished', 'failed', 'needs_qualify', 'qualified', 'cancelled'].includes(trainingRequest.status)) {
    return NextResponse.json({ error: 'A closed request cannot be scheduled' }, { status: 409 });
  }
  if (confirmed && !['approved', 'in_training'].includes(trainingRequest.status)) {
    return NextResponse.json({ error: 'Approve the request before confirming its schedule' }, { status: 409 });
  }
  if (!confirmed && !['pending', 'approved'].includes(trainingRequest.status)) {
    return NextResponse.json({ error: 'Only pending or approved requests can have draft schedules' }, { status: 409 });
  }

  const priorAttendance = trainingRequest.sessionAttendee ?? null;
  const releasedPriorAttendance = priorAttendance
    && (priorAttendance.status === 'cancelled' || priorAttendance.session.status === 'cancelled');
  const existingSession = releasedPriorAttendance ? null : priorAttendance?.session ?? null;
  if (existingSession?.status === 'completed') {
    return NextResponse.json({ error: 'A completed session cannot be rescheduled' }, { status: 409 });
  }
  if (existingSession?.status === 'in_progress') {
    return NextResponse.json({ error: 'An in-progress session cannot be changed through scheduling' }, { status: 409 });
  }
  if (existingSession?.status === 'scheduled' && !confirmed) {
    return NextResponse.json({ error: 'A confirmed session cannot be changed back to a draft' }, { status: 409 });
  }
  if (
    trainingRequest.status === 'in_training'
    && existingSession
    && existingSession.status !== 'scheduled'
  ) {
    return NextResponse.json({ error: 'An in-training request must already have a confirmed session' }, { status: 409 });
  }

  const desiredStartsAt = hasStartsAt ? startsAt : existingSession?.startsAt ?? null;
  if (confirmed && !desiredStartsAt) {
    return NextResponse.json({ error: 'A date and time are required to confirm scheduling' }, { status: 400 });
  }
  const desiredDurationMinutes = body.durationMinutes === undefined
    ? existingSession?.durationMinutes ?? trainingRequest.training.duration
    : durationMinutes ?? trainingRequest.training.duration;
  const desiredSpecialInstructions = specialInstructions === undefined
    ? existingSession?.specialInstructions ?? null
    : specialInstructions;

  const trainer = await prisma.user.findUnique({
    where: { id: trainerId },
    select: trainerSelect,
  });
  if (!trainer) {
    return NextResponse.json({ error: 'Trainer not found' }, { status: 404 });
  }

  const priorTrainerId = trainingRequest.assignedTrainerId;
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const requestUpdate = await tx.trainingRequest.updateMany({
        where: { id: requestId, status: trainingRequest.status },
        data: { assignedTrainerId: trainerId },
      });
      if (requestUpdate.count !== 1) {
        throw new ScheduleConflictError('Training request changed while scheduling');
      }
      await tx.trainingRequestSubscription.upsert({
        where: { requestId_userId: { requestId, userId: trainerId } },
        create: {
          requestId,
          userId: trainerId,
          websiteEnabled: true,
          discordEnabled: false,
        },
        update: {},
      });

      if (releasedPriorAttendance && priorAttendance) {
        // Preserve the old attendance row for audit while releasing the
        // request's one-to-one link for a replacement session.
        await tx.trainingSessionAttendee.updateMany({
          where: {
            id: priorAttendance.id,
            trainingRequestId: requestId,
          },
          data: { trainingRequestId: null, reminder24hSentAt: null },
        });
      }

      let trainingSession;
      if (existingSession && priorAttendance) {
        const sessionUpdate = await tx.trainingSession.updateMany({
          where: {
            id: priorAttendance.sessionId,
            status: existingSession.status,
          },
          data: {
            trainerId,
            startsAt: desiredStartsAt,
            durationMinutes: desiredDurationMinutes,
            status: confirmed ? 'scheduled' : 'proposed',
            specialInstructions: desiredSpecialInstructions,
            cancelledAt: null,
          },
        });
        if (sessionUpdate.count !== 1) {
          throw new ScheduleConflictError('Training session changed while scheduling');
        }
        if (existingSession.startsAt?.getTime() !== desiredStartsAt?.getTime()) {
          await tx.trainingSessionAttendee.updateMany({
            where: { sessionId: priorAttendance.sessionId },
            data: { reminder24hSentAt: null },
          });
        }
        trainingSession = await tx.trainingSession.findUniqueOrThrow({
          where: { id: priorAttendance.sessionId },
          include: { trainer: { select: trainerSelect } },
        });
      } else {
        trainingSession = await tx.trainingSession.create({
          data: {
            trainingId: trainingRequest.trainingId,
            trainerId,
            createdById: actorId,
            startsAt: desiredStartsAt,
            durationMinutes: desiredDurationMinutes,
            status: confirmed ? 'scheduled' : 'proposed',
            specialInstructions: desiredSpecialInstructions,
            attendees: {
              create: {
                userId: trainingRequest.userId,
                trainingRequestId: requestId,
              },
            },
          },
          include: { trainer: { select: trainerSelect } },
        });
      }

      const scheduleText = confirmed && desiredStartsAt
        ? `Training scheduled with ${trainer.username || 'the assigned trainer'} for ${desiredStartsAt.toISOString()} on the Arma3 Training Server.`
        : 'Staff saved a scheduling draft. Trainer and date details will appear after the schedule is confirmed.';
      await tx.trainingRequestMessage.create({
        data: { requestId, senderRole: 'SYSTEM', body: scheduleText },
      });

      return trainingSession;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ScheduleConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return NextResponse.json(
        { error: 'The request or session changed concurrently. Refresh and try again.' },
        { status: 409 },
      );
    }
    throw error;
  }

  if (confirmed && desiredStartsAt) {
    await createTrainingNotification({
      recipientUserIds: [trainingRequest.userId],
      title: `${trainingRequest.training.name} training scheduled`,
      body: `Scheduled with ${trainer.username || 'your trainer'} for ${desiredStartsAt.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC on the Arma3 Training Server.`,
      actionUrl: `/trainings/requests/${requestId}`,
      createdById: actorId,
    });
  }

  if (priorTrainerId !== trainerId) {
    await createTrainingNotification({
      recipientUserIds: [trainerId],
      title: `Assigned: ${trainingRequest.training.name} training`,
      body: `You were assigned to Training Request #${requestId}.`,
      actionUrl: `/trainings/requests/${requestId}`,
      createdById: actorId,
    });
  }

  publishTrainingChatEvent(requestId, {
    source: 'schedule',
    sessionId: result.id,
    confirmed,
  });
  publishUserProfileEvent(trainingRequest.userId, {
    source: 'training-session.updated',
    sessionId: result.id,
  });

  return NextResponse.json({
    session: {
      ...result,
      server: 'Arma3 Training Server',
      confirmed,
    },
    assignedTrainer: trainer,
  });
}
