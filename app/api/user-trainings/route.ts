import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';
import { isUserTrainingStatus } from '@/lib/training-workflow';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';

const userSelect = { id: true, username: true, avatarUrl: true } as const;
const CONCURRENT_TRAINING_UPDATE = 'CONCURRENT_TRAINING_UPDATE';

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

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const viewerId = Number(session.user.id);
  const staffViewer = await isTrainingStaff(viewerId);
  const { searchParams } = new URL(request.url);
  const requestedUserId = Number(searchParams.get('userId'));
  const requestedTrainingId = Number(searchParams.get('trainingId'));
  const includeAll = staffViewer && searchParams.get('all') === 'true';
  const includeHidden = staffViewer && searchParams.get('includeHidden') === 'true';
  const status = searchParams.get('status');

  const where = {
    ...(!includeAll
      ? { userId: staffViewer && Number.isInteger(requestedUserId) && requestedUserId > 0 ? requestedUserId : viewerId }
      : {}),
    ...(Number.isInteger(requestedTrainingId) && requestedTrainingId > 0
      ? { trainingId: requestedTrainingId }
      : {}),
    ...(!includeHidden && !staffViewer ? { isHidden: false } : {}),
    ...(isUserTrainingStatus(status) ? { status } : {}),
  };

  const rows = await prisma.userTraining.findMany({
    where,
    include: {
      training: true,
      trainer: { select: userSelect },
      user: { select: userSelect },
      statusHistory: {
        include: { changedBy: { select: userSelect } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      },
    },
    orderBy: [{ statusUpdatedAt: 'desc' }, { assignedAt: 'desc' }],
  });

  const relatedRequests = rows.length === 0
    ? []
    : await prisma.trainingRequest.findMany({
        where: {
          OR: rows.map((row) => ({ userId: row.userId, trainingId: row.trainingId })),
        },
        select: { id: true, userId: true, trainingId: true, requestedAt: true },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      });
  const requestIdByTraining = new Map<string, number>();
  for (const relatedRequest of relatedRequests) {
    const key = `${relatedRequest.userId}:${relatedRequest.trainingId}`;
    if (!requestIdByTraining.has(key)) requestIdByTraining.set(key, relatedRequest.id);
  }

  const visibleRows = staffViewer
    ? rows
    : rows.map((row) => {
        const revealTrainer = ['finished', 'needs_qualify', 'qualified', 'failed'].includes(row.status);
        return {
          ...row,
          trainerId: revealTrainer ? row.trainerId : null,
          trainer: revealTrainer ? row.trainer : null,
          statusHistory: row.statusHistory.map((history) => ({
            ...history,
            changedById: null,
            changedBy: null,
          })),
        };
      });

  return NextResponse.json(visibleRows.map((row) => ({
    ...row,
    relatedRequestId: requestIdByTraining.get(`${row.userId}:${row.trainingId}`) ?? null,
  })), {
    headers: {
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

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
  const userId = Number(body.userId);
  const trainingId = Number(body.trainingId);
  const status = body.status ?? 'qualified';
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(trainingId) || trainingId <= 0) {
    return NextResponse.json({ error: 'userId and trainingId are required' }, { status: 400 });
  }
  if (!isUserTrainingStatus(status)) {
    return NextResponse.json({ error: 'Invalid training status' }, { status: 400 });
  }

  const training = await prisma.training.findUnique({ where: { id: trainingId } });
  if (!training) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }
  const configurationError = getConfigurationStatusError(status, training);
  if (configurationError) {
    return NextResponse.json({ error: configurationError }, { status: 409 });
  }

  const existing = await prisma.userTraining.findUnique({
    where: { userId_trainingId: { userId, trainingId } },
  });
  if (existing) {
    return NextResponse.json({ error: 'Training already assigned to this user' }, { status: 400 });
  }

  const now = new Date();
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) || null : null;
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const created = await tx.userTraining.create({
        data: {
          userId,
          trainingId,
          trainerId: actorId,
          status,
          needsRetraining: status === 'failed',
          notes,
          isHidden: body.isHidden === true,
          statusUpdatedAt: now,
          trainingSessionCompletedAt: ['finished', 'needs_qualify', 'qualified'].includes(status) ? now : null,
          orbatQualifiedAt: status === 'qualified' ? now : null,
          failedAt: status === 'failed' ? now : null,
        },
      });
      await tx.userTrainingStatusHistory.create({
        data: {
          userTrainingId: created.id,
          toStatus: status,
          changedById: actorId,
          notes,
        },
      });

      const relatedRequest = await tx.trainingRequest.findFirst({
        where: {
          userId,
          trainingId,
          status: { in: ['pending', 'approved', 'in_training', 'finished', 'needs_qualify', 'qualified', 'failed'] },
        },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      });
      let requestStatusChanged = false;
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
        requestStatusChanged = true;
      }

      const row = await tx.userTraining.findUnique({
        where: { id: created.id },
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
      return { row, relatedRequestId: relatedRequest?.id ?? null, requestStatusChanged };
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
    throw error;
  }

  await createTrainingNotification({
    recipientUserIds: [userId],
    title: `${training.name}: ${status.replaceAll('_', ' ')}`,
    body: status === 'needs_qualify'
      ? `You can temporarily sign up for ${training.name} ORBAT slots to complete your qualification.`
      : `Your ${training.name} status is now ${status.replaceAll('_', ' ')}.`,
    actionUrl: result.relatedRequestId ? `/trainings/requests/${result.relatedRequestId}` : '/profile?tab=trainings',
    createdById: actorId,
  });
  if (result.relatedRequestId && result.requestStatusChanged) {
    publishTrainingChatEvent(result.relatedRequestId, { source: 'status', status });
  }
  publishUserProfileEvent(userId, { source: 'user-training.assigned', trainingId, status });
  return NextResponse.json(result.row, { status: 201 });
}
