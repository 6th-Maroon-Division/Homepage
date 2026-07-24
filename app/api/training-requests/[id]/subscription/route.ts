import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';

type RouteContext = { params: Promise<{ id: string }> };

async function getContext(context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }

  const { id } = await context.params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return { error: NextResponse.json({ error: 'Invalid training request id' }, { status: 400 }) } as const;
  }

  const userId = Number(session.user.id);
  const trainingRequest = await prisma.trainingRequest.findUnique({
    where: { id: requestId },
    select: { userId: true },
  });
  if (!trainingRequest) {
    return { error: NextResponse.json({ error: 'Training request not found' }, { status: 404 }) } as const;
  }
  if (trainingRequest.userId !== userId && !(await isTrainingStaff(userId))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }

  return { requestId, userId } as const;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const access = await getContext(context);
  if ('error' in access) return access.error;

  const subscription = await prisma.trainingRequestSubscription.findUnique({
    where: {
      requestId_userId: { requestId: access.requestId, userId: access.userId },
    },
  });

  return NextResponse.json({
    subscription: subscription ?? {
      requestId: access.requestId,
      userId: access.userId,
      websiteEnabled: false,
      discordEnabled: false,
    },
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const access = await getContext(context);
  if ('error' in access) return access.error;

  const body = await request.json();
  if (typeof body.websiteEnabled !== 'boolean' || typeof body.discordEnabled !== 'boolean') {
    return NextResponse.json(
      { error: 'websiteEnabled and discordEnabled must be booleans' },
      { status: 400 },
    );
  }

  if (body.discordEnabled) {
    const discordAccount = await prisma.authAccount.count({
      where: { userId: access.userId, provider: 'discord' },
    });
    if (!discordAccount) {
      return NextResponse.json(
        { error: 'Link a Discord account before enabling Discord notifications' },
        { status: 409 },
      );
    }
  }

  const subscription = await prisma.trainingRequestSubscription.upsert({
    where: {
      requestId_userId: { requestId: access.requestId, userId: access.userId },
    },
    create: {
      requestId: access.requestId,
      userId: access.userId,
      websiteEnabled: body.websiteEnabled,
      discordEnabled: body.discordEnabled,
    },
    update: {
      websiteEnabled: body.websiteEnabled,
      discordEnabled: body.discordEnabled,
    },
  });

  return NextResponse.json({ subscription });
}
