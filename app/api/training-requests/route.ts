import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { canRequestTraining, getUnmetRequirements } from '@/lib/training-gating';
import { getEligibleTrainingStaff, isTrainingStaff } from '@/lib/training-staff';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { TRAINING_REQUEST_STATUSES, type TrainingRequestWorkflowStatus } from '@/lib/training-workflow';
import { runSerializableTransaction } from '@/lib/serializable-transaction';

const userSelect = { id: true, username: true, avatarUrl: true } as const;

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const viewerId = Number(session.user.id);
    const staffViewer = await isTrainingStaff(viewerId);
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const status = statusParam && TRAINING_REQUEST_STATUSES.includes(statusParam as TrainingRequestWorkflowStatus)
      ? statusParam as TrainingRequestWorkflowStatus
      : null;

    const trainingRequests = await prisma.trainingRequest.findMany({
      where: {
        ...(staffViewer ? {} : { userId: viewerId }),
        ...(status ? { status } : {}),
      },
      include: {
        training: true,
        user: { select: userSelect },
        handledByAdmin: { select: userSelect },
        assignedTrainer: { select: userSelect },
        messages: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          include: { sender: { select: userSelect } },
        },
        readStates: {
          where: { userId: viewerId },
          take: 1,
        },
        subscriptions: {
          where: { userId: viewerId },
          take: 1,
        },
        sessionAttendee: {
          include: {
            session: { include: { trainer: { select: userSelect } } },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    });

    const serialized = trainingRequests.map((item) => {
      const sessionItem = item.sessionAttendee?.session ?? null;
      const confirmed = Boolean(
        sessionItem
        && ['scheduled', 'in_progress', 'completed'].includes(sessionItem.status)
        && sessionItem.startsAt,
      );
      const lastMessage = item.messages[0] ?? null;
      const readState = item.readStates[0] ?? null;
      const unread = Boolean(
        lastMessage
        && lastMessage.senderId !== viewerId
        && (!readState?.lastReadAt || lastMessage.createdAt > readState.lastReadAt),
      );

      return {
        id: item.id,
        userId: item.userId,
        trainingId: item.trainingId,
        status: item.status,
        requestMessage: item.requestMessage,
        adminResponse: item.adminResponse,
        requestedAt: item.requestedAt,
        updatedAt: item.updatedAt,
        training: item.training,
        user: item.user,
        handledByAdmin: staffViewer ? item.handledByAdmin : null,
        assignedTrainer: staffViewer || confirmed ? item.assignedTrainer : null,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              body: lastMessage.body,
              senderRole: lastMessage.senderRole,
              sender: lastMessage.senderRole === 'STAFF' && !staffViewer
                ? { id: null, username: 'Staff', avatarUrl: null }
                : lastMessage.sender,
              createdAt: lastMessage.createdAt,
            }
          : null,
        unread,
        subscription: item.subscriptions[0] ?? null,
        session: staffViewer || confirmed
          ? sessionItem
            ? {
                id: sessionItem.id,
                startsAt: sessionItem.startsAt,
                durationMinutes: sessionItem.durationMinutes,
                status: sessionItem.status,
                trainer: sessionItem.trainer,
                specialInstructions: sessionItem.specialInstructions,
                server: 'Arma3 Training Server',
                confirmed,
              }
            : null
          : null,
      };
    });

    return NextResponse.json(serialized, {
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    console.error('Error fetching training requests:', error);
    return NextResponse.json({ error: 'Failed to fetch training requests' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = Number(session.user.id);
    const body = await request.json();
    const trainingId = Number(body.trainingId);
    const requestMessage = typeof body.requestMessage === 'string'
      ? body.requestMessage.trim().slice(0, 4000) || null
      : null;

    if (!Number.isInteger(trainingId) || trainingId <= 0) {
      return NextResponse.json({ error: 'trainingId is required' }, { status: 400 });
    }

    const training = await prisma.training.findUnique({ where: { id: trainingId } });
    if (!training || !training.isActive) {
      return NextResponse.json({ error: 'Training not found or inactive' }, { status: 404 });
    }

    if (!(await canRequestTraining(userId, trainingId))) {
      const unmet = await getUnmetRequirements(userId, trainingId);
      const details = [
        ...(unmet.missingRank ? [`Requires rank: ${unmet.missingRank.name}`] : []),
        ...(unmet.missingTrainings.length
          ? [`Missing trainings: ${unmet.missingTrainings.map((item) => item.name).join(', ')}`]
          : []),
      ];
      return NextResponse.json({ error: 'Requirements not met', details }, { status: 403 });
    }

    const outcome = await runSerializableTransaction(async (tx) => {
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

      if (existingCredential) {
        return {
          error: existingCredential.status === 'failed'
            ? 'A trainer must reopen your qualification attempt.'
            : 'You already have a training record for this training.',
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

      if (requestMessage) {
        const migratedByCompatibilityTrigger = await tx.trainingRequestMessage.count({
          where: {
            requestId: created.id,
            senderId: userId,
            senderRole: 'USER',
            body: requestMessage,
          },
        });
        if (!migratedByCompatibilityTrigger) {
          await tx.trainingRequestMessage.create({
            data: {
              requestId: created.id,
              senderId: userId,
              senderRole: 'USER',
              body: requestMessage,
            },
          });
        }
      }

      return { created } as const;
    });

    if ('error' in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: 409 });
    }
    const trainingRequest = outcome.created;

    const staff = await getEligibleTrainingStaff();
    await createTrainingNotification({
      recipientUserIds: staff.map((item) => item.id),
      title: `New training request: ${training.name}`,
      body: `${trainingRequest.user.username || 'A user'} requested ${training.name}.`,
      actionUrl: `/trainings/requests/${trainingRequest.id}`,
      createdById: userId,
    });
    publishTrainingChatEvent(trainingRequest.id, { source: 'request-created' });

    return NextResponse.json({
      ...trainingRequest,
      lastMessage: requestMessage
        ? { body: requestMessage, senderRole: 'USER', createdAt: trainingRequest.requestedAt }
        : null,
      message: 'Your request has been received. Staff will contact you to schedule.',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating training request:', error);
    return NextResponse.json({ error: 'Failed to create training request' }, { status: 500 });
  }
}
