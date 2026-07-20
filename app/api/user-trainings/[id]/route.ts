import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';
import {
  isUserTrainingStatus,
  validateTrainingTransition,
  type TrainingRequestWorkflowStatus,
} from '@/lib/training-workflow';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';

type RouteContext = { params: Promise<{ id: string }> };
const userSelect = { id: true, username: true, avatarUrl: true } as const;
const CONCURRENT_TRAINING_UPDATE = 'CONCURRENT_TRAINING_UPDATE';
const INVALID_TRAINING_SESSION_CONTEXT = 'INVALID_TRAINING_SESSION_CONTEXT';
const INVALID_ORBAT_CONTEXT = 'INVALID_ORBAT_CONTEXT';

function parseAuditReference(value: unknown): { valid: boolean; id: number | null } {
  if (value === undefined || value === null || value === '') {
    return { valid: true, id: null };
  }
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) {
    return { valid: false, id: null };
  }
  const id = Number(normalized);
  return Number.isInteger(id) && id > 0
    ? { valid: true, id }
    : { valid: false, id: null };
}

function getConfigurationStatusError(
  status: string,
  training: { requiresTrainingSession: boolean; requiresOrbatQualification: boolean },
) {
  if (status === 'in_training' && !training.requiresTrainingSession) {
    return 'This training does not require a training session';
  }
  if (status === 'needs_qualify' && !training.requiresOrbatQualification) {
    return 'This training does not require ORBAT qualification';
  }
  if (status === 'finished' && training.requiresOrbatQualification) {
    return 'This training requires ORBAT qualification and cannot stop at finished';
  }
  return null;
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const actorId = Number(session.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const userTrainingId = Number(id);
  if (!Number.isInteger(userTrainingId) || userTrainingId <= 0) {
    return NextResponse.json({ error: 'Invalid user training id' }, { status: 400 });
  }

  const body = await request.json();
  const existing = await prisma.userTraining.findUnique({
    where: { id: userTrainingId },
    include: { training: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Training record not found' }, { status: 404 });
  }

  const requestedStatus = body.status ?? (
    typeof body.needsRetraining === 'boolean'
      ? body.needsRetraining ? 'failed' : existing.status === 'failed' ? 'qualified' : existing.status
      : existing.status
  );
  if (!isUserTrainingStatus(requestedStatus)) {
    return NextResponse.json({ error: 'Invalid training status' }, { status: 400 });
  }

  const configurationError = getConfigurationStatusError(requestedStatus, existing.training);
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 409 });
  }

  if (requestedStatus !== existing.status) {
    const transition = validateTrainingTransition(
      existing.status as TrainingRequestWorkflowStatus,
      requestedStatus as TrainingRequestWorkflowStatus,
      {
        requiresTrainingSession: existing.training.requiresTrainingSession,
        requiresOrbatQualification: existing.training.requiresOrbatQualification,
      },
    );
    if (!transition.valid) {
      return NextResponse.json({ error: transition.reason }, { status: 409 });
    }
  }

  const trainingSessionReference = parseAuditReference(body.trainingSessionId);
  const orbatReference = parseAuditReference(body.orbatId);
  if (!trainingSessionReference.valid) {
    return NextResponse.json({ error: 'Invalid trainingSessionId' }, { status: 400 });
  }
  if (!orbatReference.valid) {
    return NextResponse.json({ error: 'Invalid orbatId' }, { status: 400 });
  }

  const notes = body.notes === undefined
    ? existing.notes
    : typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) || null : null;
  const now = new Date();
  let updateResult;
  try {
    updateResult = await prisma.$transaction(async (tx) => {
      if (requestedStatus !== existing.status && trainingSessionReference.id) {
        const attendeeCount = await tx.trainingSessionAttendee.count({
          where: {
            userId: existing.userId,
            sessionId: trainingSessionReference.id,
            session: { trainingId: existing.trainingId },
          },
        });
        if (attendeeCount !== 1) {
          throw new Error(INVALID_TRAINING_SESSION_CONTEXT);
        }
      }

      if (requestedStatus !== existing.status && orbatReference.id) {
        const signups = await tx.signup.findMany({
          where: { userId: existing.userId, slot: { orbatId: orbatReference.id } },
          select: {
            slot: {
              select: { squadRole: { select: { requiredTrainingIds: true } } },
            },
          },
        });
        const hasRelevantSignup = signups.some((signup) =>
          signup.slot.squadRole?.requiredTrainingIds.includes(existing.trainingId),
        );
        if (!hasRelevantSignup) {
          throw new Error(INVALID_ORBAT_CONTEXT);
        }
      }

      const credentialUpdate = await tx.userTraining.updateMany({
        where: {
          id: userTrainingId,
          status: existing.status,
          statusUpdatedAt: existing.statusUpdatedAt,
          trainerId: existing.trainerId,
          notes: existing.notes,
          isHidden: existing.isHidden,
        },
        data: {
          status: requestedStatus,
          needsRetraining: requestedStatus === 'failed',
          notes,
          isHidden: typeof body.isHidden === 'boolean' ? body.isHidden : existing.isHidden,
          trainerId: actorId,
          statusUpdatedAt: requestedStatus !== existing.status ? now : existing.statusUpdatedAt,
          ...(requestedStatus === 'finished' || requestedStatus === 'needs_qualify'
            ? {
                trainingSessionCompletedAt: existing.trainingSessionCompletedAt ?? now,
                orbatQualifiedAt: null,
                failedAt: null,
              }
            : {}),
          ...(requestedStatus === 'qualified' ? { orbatQualifiedAt: now, failedAt: null } : {}),
          ...(requestedStatus === 'failed' ? { orbatQualifiedAt: null, failedAt: now } : {}),
          ...(['approved', 'in_training'].includes(requestedStatus)
            ? { orbatQualifiedAt: null, failedAt: null }
            : {}),
        },
      });
      if (credentialUpdate.count !== 1) {
        throw new Error(CONCURRENT_TRAINING_UPDATE);
      }

      let relatedRequestId: number | null = null;
      let requestStatusChanged = false;
      if (requestedStatus !== existing.status) {
        await tx.userTrainingStatusHistory.create({
          data: {
            userTrainingId,
            fromStatus: existing.status,
            toStatus: requestedStatus,
            changedById: actorId,
            trainingSessionId: trainingSessionReference.id,
            orbatId: orbatReference.id,
            notes,
          },
        });
      }

      const relatedRequest = await tx.trainingRequest.findFirst({
        where: {
          userId: existing.userId,
          trainingId: existing.trainingId,
          status: { in: ['pending', 'approved', 'in_training', 'finished', 'needs_qualify', 'qualified', 'failed'] },
        },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      });
      relatedRequestId = relatedRequest?.id ?? null;
      if (relatedRequest && relatedRequest.status !== requestedStatus) {
        const requestUpdate = await tx.trainingRequest.updateMany({
          where: { id: relatedRequest.id, status: relatedRequest.status },
          data: { status: requestedStatus, handledByAdminId: actorId },
        });
        if (requestUpdate.count !== 1) {
          throw new Error(CONCURRENT_TRAINING_UPDATE);
        }
        await tx.trainingRequestMessage.create({
          data: {
            requestId: relatedRequest.id,
            senderRole: 'SYSTEM',
            body: `Training status changed from ${relatedRequest.status} to ${requestedStatus}.`,
          },
        });
        requestStatusChanged = true;
      }

      const row = await tx.userTraining.findUnique({
        where: { id: userTrainingId },
        include: {
          training: true,
          trainer: { select: userSelect },
          user: { select: userSelect },
          statusHistory: {
            include: { changedBy: { select: userSelect } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          },
        },
      });
      if (!row) {
        throw new Error(CONCURRENT_TRAINING_UPDATE);
      }
      return { row, relatedRequestId, requestStatusChanged };
    });
  } catch (error) {
    if (error instanceof Error && error.message === CONCURRENT_TRAINING_UPDATE) {
      return NextResponse.json(
        { error: 'Training status changed concurrently; refresh and try again' },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === INVALID_TRAINING_SESSION_CONTEXT) {
      return NextResponse.json(
        { error: 'Training session does not belong to this training and user' },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message === INVALID_ORBAT_CONTEXT) {
      return NextResponse.json(
        { error: 'ORBAT does not contain a relevant signup for this training and user' },
        { status: 400 },
      );
    }
    throw error;
  }

  if (requestedStatus !== existing.status) {
    const notificationBody = requestedStatus === 'needs_qualify'
      ? `You can temporarily use ${existing.training.name} ORBAT slots to demonstrate your skills.`
      : requestedStatus === 'qualified'
        ? `You are now fully qualified for ${existing.training.name}.`
        : requestedStatus === 'failed'
          ? `Your ${existing.training.name} qualification was marked as failed. Contact a trainer for next steps.`
          : `Your ${existing.training.name} status is now ${requestedStatus.replaceAll('_', ' ')}.`;
    await createTrainingNotification({
      recipientUserIds: [existing.userId],
      title: `${existing.training.name}: ${requestedStatus.replaceAll('_', ' ')}`,
      body: notificationBody,
      actionUrl: updateResult.relatedRequestId
        ? `/trainings/requests/${updateResult.relatedRequestId}`
        : '/profile?tab=trainings',
      createdById: actorId,
    });
  }
  if (updateResult.relatedRequestId && updateResult.requestStatusChanged) {
    publishTrainingChatEvent(updateResult.relatedRequestId, { source: 'status', status: requestedStatus });
  }

  publishUserProfileEvent(existing.userId, {
    source: 'user-training.updated',
    trainingId: existing.trainingId,
    status: requestedStatus,
  });
  return NextResponse.json(updateResult.row);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actorId = Number(session.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const userTrainingId = Number(id);
  const existing = await prisma.userTraining.findUnique({
    where: { id: userTrainingId },
    select: { userId: true, trainingId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Training record not found' }, { status: 404 });
  }

  await prisma.userTraining.delete({ where: { id: userTrainingId } });
  publishUserProfileEvent(existing.userId, {
    source: 'user-training.removed',
    trainingId: existing.trainingId,
  });
  return NextResponse.json({ message: 'Training removed from user successfully' });
}
