import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';
import {
  isTrainingRequestStatus,
  requestStatusToUserTrainingStatus,
  validateTrainingTransition,
} from '@/lib/training-workflow';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';

type RouteContext = { params: Promise<{ id: string }> };

const publicUserSelect = {
  id: true,
  username: true,
  avatarUrl: true,
} as const;

function parseRequestId(value: string) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getDetailedRequest(requestId: number) {
  return prisma.trainingRequest.findUnique({
    where: { id: requestId },
    include: {
      training: true,
      user: { select: publicUserSelect },
      handledByAdmin: { select: publicUserSelect },
      assignedTrainer: { select: publicUserSelect },
      messages: {
        include: { sender: { select: publicUserSelect } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
      sessionAttendee: {
        include: {
          session: {
            include: { trainer: { select: publicUserSelect } },
          },
        },
      },
    },
  });
}

function serializeDetailedRequest(
  record: NonNullable<Awaited<ReturnType<typeof getDetailedRequest>>>,
  viewerId: number,
  staffViewer: boolean,
) {
  const attendee = record.sessionAttendee;
  const session = attendee?.session ?? null;
  const isConfirmed = Boolean(
    session
    && ['scheduled', 'in_progress', 'completed'].includes(session.status)
    && session.startsAt,
  );
  const visibleSession = staffViewer || isConfirmed ? session : null;

  return {
    request: {
      id: record.id,
      userId: record.userId,
      trainingId: record.trainingId,
      status: record.status,
      requestMessage: record.requestMessage,
      adminResponse: record.adminResponse,
      requestedAt: record.requestedAt,
      updatedAt: record.updatedAt,
      training: record.training,
      user: record.user,
      handledByAdmin: staffViewer ? record.handledByAdmin : null,
      assignedTrainer: staffViewer || isConfirmed ? record.assignedTrainer : null,
    },
    messages: record.messages.map((message) => {
      const sender = message.senderRole === 'STAFF' && !staffViewer
        ? { id: null, username: 'Staff', avatarUrl: null }
        : message.sender;

      return {
        id: message.id,
        requestId: message.requestId,
        senderRole: message.senderRole,
        body: message.body,
        createdAt: message.createdAt,
        editedAt: message.editedAt,
        sender,
        isMine: message.senderId === viewerId,
      };
    }),
    session: visibleSession
      ? {
          id: visibleSession.id,
          trainingId: visibleSession.trainingId,
          trainer: visibleSession.trainer,
          startsAt: visibleSession.startsAt,
          durationMinutes: visibleSession.durationMinutes,
          status: visibleSession.status,
          specialInstructions: visibleSession.specialInstructions,
          attendeeStatus: attendee?.status ?? null,
          server: 'Arma3 Training Server',
          confirmed: isConfirmed,
        }
      : null,
    isStaff: staffViewer,
  };
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const requestId = parseRequestId(id);
  if (!requestId) {
    return NextResponse.json({ error: 'Invalid training request id' }, { status: 400 });
  }

  const record = await getDetailedRequest(requestId);
  if (!record) {
    return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
  }

  const viewerId = Number(session.user.id);
  const staffViewer = await isTrainingStaff(viewerId);
  if (record.userId !== viewerId && !staffViewer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const latestMessage = record.messages.at(-1);
  if (latestMessage) {
    await prisma.trainingRequestReadState.upsert({
      where: { requestId_userId: { requestId, userId: viewerId } },
      create: {
        requestId,
        userId: viewerId,
        lastReadMessageId: latestMessage.id,
        lastReadAt: new Date(),
      },
      update: {
        lastReadMessageId: latestMessage.id,
        lastReadAt: new Date(),
      },
    });
  }

  const subscription = await prisma.trainingRequestSubscription.findUnique({
    where: { requestId_userId: { requestId, userId: viewerId } },
  });

  return NextResponse.json({
    ...serializeDetailedRequest(record, viewerId, staffViewer),
    subscription,
  });
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
  const requestId = parseRequestId(id);
  if (!requestId) {
    return NextResponse.json({ error: 'Invalid training request id' }, { status: 400 });
  }

  const body = await request.json();
  if (!isTrainingRequestStatus(body.status) || body.status === 'completed') {
    return NextResponse.json({ error: 'Valid status is required' }, { status: 400 });
  }

  const existing = await prisma.trainingRequest.findUnique({
    where: { id: requestId },
    include: {
      training: true,
      sessionAttendee: { select: { sessionId: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
  }

  const transition = validateTrainingTransition(existing.status, body.status, {
    requiresTrainingSession: existing.training.requiresTrainingSession,
    requiresOrbatQualification: existing.training.requiresOrbatQualification,
  });
  if (!transition.valid) {
    return NextResponse.json({ error: transition.reason }, { status: 409 });
  }

  const adminResponse = typeof body.adminResponse === 'string'
    ? body.adminResponse.trim().slice(0, 4000) || null
    : existing.adminResponse;
  const nextUserTrainingStatus = requestStatusToUserTrainingStatus(body.status);
  const now = new Date();

  const transitionApplied = await prisma.$transaction(async (tx) => {
    const requestUpdate = await tx.trainingRequest.updateMany({
      where: { id: requestId, status: existing.status, updatedAt: existing.updatedAt },
      data: {
        status: body.status,
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
    return true;
  });

  if (!transitionApplied) {
    return NextResponse.json(
      { error: 'This request changed while you were updating it. Refresh and try again.' },
      { status: 409 },
    );
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

  if (statusMessages[body.status]) {
    await createTrainingNotification({
      recipientUserIds: [existing.userId],
      title: `${existing.training.name}: ${String(body.status).replaceAll('_', ' ')}`,
      body: statusMessages[body.status],
      actionUrl: `/trainings/requests/${requestId}`,
      createdById: actorId,
    });
  }

  publishTrainingChatEvent(requestId, { source: 'status', status: body.status });
  publishUserProfileEvent(existing.userId, {
    source: 'training-request.updated',
    status: body.status,
    trainingId: existing.trainingId,
  });

  const updated = await getDetailedRequest(requestId);
  if (!updated) {
    return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
  }

  const serialized = serializeDetailedRequest(updated, actorId, true);
  return NextResponse.json({ ...serialized.request, ...serialized, request: serialized.request });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const requestId = parseRequestId(id);
  if (!requestId) {
    return NextResponse.json({ error: 'Invalid training request id' }, { status: 400 });
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
    return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
  }

  const actorId = Number(session.user.id);
  const staffViewer = await isTrainingStaff(actorId);
  if (existing.userId !== actorId && !staffViewer) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!['pending', 'approved'].includes(existing.status)) {
    return NextResponse.json({ error: 'Only pending or approved requests can be cancelled' }, { status: 409 });
  }

  const cancelled = await prisma.$transaction(async (tx) => {
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
    return true;
  });

  if (!cancelled) {
    return NextResponse.json(
      { error: 'This request changed while you were cancelling it. Refresh and try again.' },
      { status: 409 },
    );
  }

  publishTrainingChatEvent(requestId, { source: 'status', status: 'cancelled' });
  publishUserProfileEvent(existing.userId, { source: 'training-request.cancelled' });
  return NextResponse.json({ message: 'Training request cancelled successfully', status: 'cancelled' });
}
