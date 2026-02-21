// app/api/signups/[id]/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const hasPermission = await checkPermission(session.user.id, 'orbat:edit');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const signupId = parseInt(id);

    if (isNaN(signupId)) {
      return NextResponse.json({ error: 'Invalid signup ID' }, { status: 400 });
    }

    const body = await request.json();
    const { targetSubslotId } = body;

    if (!targetSubslotId || isNaN(parseInt(targetSubslotId))) {
      return NextResponse.json({ error: 'Target subslot ID is required' }, { status: 400 });
    }

    const targetId = parseInt(targetSubslotId);

    // Verify signup exists
    const signup = await prisma.signup.findUnique({
      where: { id: signupId },
      include: {
        subslot: true,
      },
    });

    if (!signup) {
      return NextResponse.json({ error: 'Signup not found' }, { status: 404 });
    }

    // Verify target subslot exists
    const targetSubslot = await prisma.subslot.findUnique({
      where: { id: targetId },
      include: {
        signups: true,
      },
    });

    if (!targetSubslot) {
      return NextResponse.json({ error: 'Target subslot not found' }, { status: 404 });
    }

    const requiredTrainingIds = targetSubslot.requiredTrainingIds?.length
      ? targetSubslot.requiredTrainingIds
      : targetSubslot.requiredTrainingId
        ? [targetSubslot.requiredTrainingId]
        : [];

    if (requiredTrainingIds.length > 0) {
      const completedTrainings = await prisma.userTraining.findMany({
        where: {
          userId: signup.userId,
          trainingId: { in: requiredTrainingIds },
          needsRetraining: false,
        },
        select: { trainingId: true },
      });

      const completedIds = new Set(completedTrainings.map((training) => training.trainingId));
      const missingTrainingIds = requiredTrainingIds.filter((trainingId) => !completedIds.has(trainingId));

      if (missingTrainingIds.length > 0) {
        const missingTrainings = await prisma.training.findMany({
          where: { id: { in: missingTrainingIds } },
          select: { name: true },
          orderBy: { name: 'asc' },
        });

        return NextResponse.json(
          { error: `User is missing required trainings: ${missingTrainings.map((training) => training.name).join(', ')}` },
          { status: 400 }
        );
      }
    }

    const requiredRankIds = targetSubslot.requiredRankIds?.length
      ? targetSubslot.requiredRankIds
      : targetSubslot.requiredRankId
        ? [targetSubslot.requiredRankId]
        : [];

    if (requiredRankIds.length > 0) {
      const [userRank, requiredRanks] = await Promise.all([
        prisma.userRank.findUnique({
          where: { userId: signup.userId },
          include: {
            currentRank: {
              select: { id: true, name: true, abbreviation: true, orderIndex: true },
            },
          },
        }),
        prisma.rank.findMany({
          where: { id: { in: requiredRankIds } },
          select: { id: true, name: true, abbreviation: true, orderIndex: true },
        }),
      ]);

      if (requiredRanks.length !== requiredRankIds.length) {
        return NextResponse.json({ error: 'Target subslot rank requirement is invalid' }, { status: 400 });
      }

      const userOrderIndex = userRank?.currentRank?.orderIndex;
      const unmetRanks = requiredRanks.filter(
        (requiredRank) => typeof userOrderIndex !== 'number' || userOrderIndex < requiredRank.orderIndex
      );

      if (unmetRanks.length > 0) {
        return NextResponse.json(
          {
            error: `User does not meet required ranks: ${unmetRanks
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((rank) => `[${rank.abbreviation}] ${rank.name}`)
              .join(', ')} or higher`,
          },
          { status: 400 }
        );
      }
    }

    // Check if target subslot is full
    if (targetSubslot.signups.length >= targetSubslot.maxSignups) {
      return NextResponse.json({ error: 'Target subslot is full' }, { status: 400 });
    }

    // Check if user already signed up in target subslot
    const existingSignup = targetSubslot.signups.find((s) => s.userId === signup.userId);
    if (existingSignup) {
      return NextResponse.json(
        { error: 'User already signed up in target subslot' },
        { status: 400 }
      );
    }

    // Move the signup
    const updatedSignup = await prisma.signup.update({
      where: { id: signupId },
      data: {
        subslotId: targetId,
      },
      include: {
        user: true,
        subslot: {
          include: {
            slot: true,
          },
        },
      },
    });

    return NextResponse.json(updatedSignup);
  } catch (error) {
    console.error('Error moving signup:', error);
    return NextResponse.json({ error: 'Failed to move signup' }, { status: 500 });
  }
}
