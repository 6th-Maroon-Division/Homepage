import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';
import {
  validateTrainingTransition,
  type TrainingRequestWorkflowStatus,
} from '@/lib/training-workflow';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';

const CONCURRENT_TRAINING_UPDATE = 'CONCURRENT_TRAINING_UPDATE';
const INVALID_TRANSITION_PREFIX = 'INVALID_TRANSITION:';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const actorId = Number(session.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const trainingId = Number(body.trainingId);
  const userIds: number[] = Array.isArray(body.userIds)
    ? Array.from(new Set<number>(
        (body.userIds as unknown[])
          .map((value) => Number(value))
          .filter((id) => Number.isInteger(id) && id > 0),
      ))
    : [];
  const status = 'needs_qualify' as const;
  if (!Number.isInteger(trainingId) || trainingId <= 0 || userIds.length === 0) {
    return NextResponse.json({ error: 'trainingId and at least one userId are required' }, { status: 400 });
  }
  if (body.status !== undefined && body.status !== null && body.status !== status) {
    return NextResponse.json(
      { error: 'Bulk status updates only support needs_qualify' },
      { status: 400 },
    );
  }

  const training = await prisma.training.findUnique({ where: { id: trainingId } });
  if (!training) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }
  if (!training.requiresOrbatQualification) {
    return NextResponse.json({ error: 'This training does not require ORBAT qualification' }, { status: 409 });
  }

  const note = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) || null : null;
  const now = new Date();
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const ids: number[] = [];
      const requestEventIds: number[] = [];
      for (const userId of userIds) {
        const previous = await tx.userTraining.findUnique({
          where: { userId_trainingId: { userId, trainingId } },
        });
        if (previous && previous.status !== status) {
          const transition = validateTrainingTransition(
            previous.status as TrainingRequestWorkflowStatus,
            status,
            {
              requiresTrainingSession: training.requiresTrainingSession,
              requiresOrbatQualification: training.requiresOrbatQualification,
            },
          );
          if (!transition.valid) {
            throw new Error(`${INVALID_TRANSITION_PREFIX}${transition.reason}`);
          }
        }

        let userTrainingId: number;
        if (previous) {
          const credentialUpdate = await tx.userTraining.updateMany({
            where: {
              id: previous.id,
              status: previous.status,
              statusUpdatedAt: previous.statusUpdatedAt,
              trainerId: previous.trainerId,
              notes: previous.notes,
            },
            data: {
              trainerId: actorId,
              status,
              notes: note,
              needsRetraining: false,
              statusUpdatedAt: previous.status === status ? previous.statusUpdatedAt : now,
              trainingSessionCompletedAt: previous.trainingSessionCompletedAt ?? now,
              orbatQualifiedAt: null,
              failedAt: null,
            },
          });
          if (credentialUpdate.count !== 1) {
            throw new Error(CONCURRENT_TRAINING_UPDATE);
          }
          userTrainingId = previous.id;
        } else {
          const created = await tx.userTraining.create({
            data: {
              userId,
              trainingId,
              trainerId: actorId,
              status,
              notes: note,
              needsRetraining: false,
              statusUpdatedAt: now,
              trainingSessionCompletedAt: now,
            },
          });
          userTrainingId = created.id;
        }

        if (previous?.status !== status) {
          await tx.userTrainingStatusHistory.create({
            data: {
              userTrainingId,
              fromStatus: previous?.status ?? null,
              toStatus: status,
              changedById: actorId,
              notes: note,
            },
          });
        }

        const relatedRequest = await tx.trainingRequest.findFirst({
          where: {
            userId,
            trainingId,
            status: { in: ['pending', 'approved', 'in_training', 'finished', 'needs_qualify', 'qualified', 'failed'] },
          },
          orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        });
        if (relatedRequest && relatedRequest.status !== status) {
          const requestUpdate = await tx.trainingRequest.updateMany({
            where: { id: relatedRequest.id, status: relatedRequest.status },
            data: { status, handledByAdminId: actorId },
          });
          if (requestUpdate.count !== 1) {
            throw new Error(CONCURRENT_TRAINING_UPDATE);
          }
          await tx.trainingRequestMessage.create({
            data: {
              requestId: relatedRequest.id,
              senderRole: 'SYSTEM',
              body: `Training status changed from ${relatedRequest.status} to ${status}.`,
            },
          });
          requestEventIds.push(relatedRequest.id);
        }
        ids.push(userId);
      }
      return { updatedIds: ids, requestEventIds };
    });
  } catch (error) {
    if (
      (error instanceof Error && error.message === CONCURRENT_TRAINING_UPDATE)
      || (error as { code?: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { error: 'Training status changed concurrently; refresh and try again' },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message.startsWith(INVALID_TRANSITION_PREFIX)) {
      return NextResponse.json(
        { error: error.message.slice(INVALID_TRANSITION_PREFIX.length) },
        { status: 409 },
      );
    }
    throw error;
  }

  await createTrainingNotification({
    recipientUserIds: result.updatedIds,
    title: `${training.name}: ${status.replaceAll('_', ' ')}`,
    body: `You can temporarily use ${training.name} ORBAT slots to demonstrate your skills.`,
    actionUrl: '/profile?tab=trainings',
    createdById: actorId,
  });
  for (const requestId of result.requestEventIds) {
    publishTrainingChatEvent(requestId, { source: 'status', status });
  }
  for (const userId of result.updatedIds) {
    publishUserProfileEvent(userId, { source: 'user-training.bulk-status', trainingId, status });
  }

  return NextResponse.json({
    updated: result.updatedIds.length,
    userIds: result.updatedIds,
    trainingId,
    status,
  });
}
