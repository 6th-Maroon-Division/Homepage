import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getEligibleTrainingStaff, isTrainingStaff } from '@/lib/training-staff';
import {
  createTrainingNotification,
  sendDiscordTrainingDm,
} from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';

type RouteContext = { params: Promise<{ id: string }> };

const senderSelect = { id: true, username: true, avatarUrl: true } as const;

function serializeMessage<
  T extends {
    id: number;
    requestId: number;
    senderId: number | null;
    senderRole: 'USER' | 'STAFF' | 'SYSTEM';
    body: string;
    createdAt: Date;
    editedAt: Date | null;
    sender: { id: number; username: string | null; avatarUrl: string | null } | null;
  },
>(message: T, viewerId: number, staffViewer: boolean) {
  return {
    id: message.id,
    requestId: message.requestId,
    senderRole: message.senderRole,
    body: message.body,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    sender: message.senderRole === 'STAFF' && !staffViewer
      ? { id: null, username: 'Staff', avatarUrl: null }
      : message.sender,
    isMine: message.senderId === viewerId,
  };
}

async function authorize(requestId: number, viewerId: number) {
  const trainingRequest = await prisma.trainingRequest.findUnique({
    where: { id: requestId },
    include: {
      training: { select: { name: true } },
      assignedTrainer: { select: { id: true } },
    },
  });

  if (!trainingRequest) {
    return { error: NextResponse.json({ error: 'Training request not found' }, { status: 404 }) } as const;
  }

  const staffViewer = await isTrainingStaff(viewerId);
  if (trainingRequest.userId !== viewerId && !staffViewer) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }

  return { trainingRequest, staffViewer } as const;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'Invalid training request id' }, { status: 400 });
  }

  const viewerId = Number(session.user.id);
  const access = await authorize(requestId, viewerId);
  if ('error' in access) {
    return access.error;
  }

  const messages = await prisma.trainingRequestMessage.findMany({
    where: { requestId },
    include: { sender: { select: senderSelect } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const latest = messages.at(-1);
  if (latest) {
    await prisma.trainingRequestReadState.upsert({
      where: { requestId_userId: { requestId, userId: viewerId } },
      create: { requestId, userId: viewerId, lastReadMessageId: latest.id, lastReadAt: new Date() },
      update: { lastReadMessageId: latest.id, lastReadAt: new Date() },
    });
  }

  return NextResponse.json({
    messages: messages.map((message) => serializeMessage(message, viewerId, access.staffViewer)),
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: 'Invalid training request id' }, { status: 400 });
  }

  const viewerId = Number(session.user.id);
  const access = await authorize(requestId, viewerId);
  if ('error' in access) {
    return access.error;
  }

  if (['cancelled'].includes(access.trainingRequest.status)) {
    return NextResponse.json({ error: 'This chat is closed' }, { status: 409 });
  }

  const payload = await request.json();
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!body) {
    return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
  }
  if (body.length > 4000) {
    return NextResponse.json({ error: 'Message cannot exceed 4000 characters' }, { status: 400 });
  }

  const senderRole = access.trainingRequest.userId === viewerId ? 'USER' : 'STAFF';
  const message = await prisma.trainingRequestMessage.create({
    data: {
      requestId,
      senderId: viewerId,
      senderRole,
      body,
    },
    include: { sender: { select: senderSelect } },
  });

  await prisma.trainingRequestReadState.upsert({
    where: { requestId_userId: { requestId, userId: viewerId } },
    create: { requestId, userId: viewerId, lastReadMessageId: message.id, lastReadAt: new Date() },
    update: { lastReadMessageId: message.id, lastReadAt: new Date() },
  });

  const actionUrl = `/trainings/requests/${requestId}`;
  if (senderRole === 'STAFF') {
    const userSubscription = await prisma.trainingRequestSubscription.findUnique({
      where: {
        requestId_userId: {
          requestId,
          userId: access.trainingRequest.userId,
        },
      },
      select: { websiteEnabled: true, discordEnabled: true },
    });
    await createTrainingNotification({
      // Existing requests without a preference retain the historical website
      // notification behavior; users can opt out after saving preferences.
      recipientUserIds: userSubscription?.websiteEnabled === false
        ? []
        : [access.trainingRequest.userId],
      title: `New ${access.trainingRequest.training.name} scheduling message`,
      body: `Staff sent a new message about your ${access.trainingRequest.training.name} training.`,
      actionUrl,
      createdById: viewerId,
    });
    if (userSubscription?.discordEnabled) {
      const baseUrl = process.env.NEXTAUTH_URL || '';
      await sendDiscordTrainingDm(
        access.trainingRequest.userId,
        `New message in Training Request #${requestId} from Staff: ${body}\n${baseUrl}${actionUrl}`,
      );
    }
  } else {
    const subscriptions = await prisma.trainingRequestSubscription.findMany({
      where: { requestId },
      select: { userId: true, websiteEnabled: true, discordEnabled: true },
    });
    const eligibleStaff = await getEligibleTrainingStaff();
    const eligibleIds = new Set(eligibleStaff.map((staff) => staff.id));
    const assignedTrainerId = access.trainingRequest.assignedTrainer?.id ?? null;
    const webRecipientIds = subscriptions
      .filter((item) => (
        item.userId !== viewerId
        && item.websiteEnabled
        && eligibleIds.has(item.userId)
      ))
      .map((item) => item.userId);
    const assignedTrainerSubscription = assignedTrainerId
      ? subscriptions.find((item) => item.userId === assignedTrainerId)
      : null;
    if (
      assignedTrainerId
      && assignedTrainerId !== viewerId
      && eligibleIds.has(assignedTrainerId)
      && assignedTrainerSubscription?.websiteEnabled === true
    ) {
      webRecipientIds.push(assignedTrainerId);
    }

    await createTrainingNotification({
      recipientUserIds: webRecipientIds,
      title: `New ${access.trainingRequest.training.name} request message`,
      body: body.length > 180 ? `${body.slice(0, 177)}...` : body,
      actionUrl,
      createdById: viewerId,
    });

    const baseUrl = process.env.NEXTAUTH_URL || '';
    const discordRecipients = subscriptions.filter(
      (item) => item.userId !== viewerId && item.discordEnabled && eligibleIds.has(item.userId),
    );
    await Promise.allSettled(
      discordRecipients.map((item) =>
        sendDiscordTrainingDm(
          item.userId,
          `New message in Training Request #${requestId}: ${body}\n${baseUrl}${actionUrl}`,
        ),
      ),
    );
  }

  publishTrainingChatEvent(requestId, { source: 'message', messageId: message.id });
  return NextResponse.json(
    { message: serializeMessage(message, viewerId, access.staffViewer) },
    { status: 201 },
  );
}
