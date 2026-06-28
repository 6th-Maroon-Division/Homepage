// app/api/signups/[id]/move/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { publishOrbatEvent } from '@/lib/realtime/orbat-events';

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
    const { targetSlotId } = body;

    if (!targetSlotId || isNaN(parseInt(targetSlotId))) {
      return NextResponse.json({ error: 'Target slot ID is required' }, { status: 400 });
    }

    const targetId = parseInt(targetSlotId);

    // Verify signup exists
    const signup = await prisma.signup.findUnique({
      where: { id: signupId },
      include: {
        slot: {
          include: {
            squad: true,
          },
        },
        user: true,
      },
    });

    if (!signup) {
      return NextResponse.json({ error: 'Signup not found' }, { status: 404 });
    }

    // Verify target slot exists
    const targetSlot = await prisma.slot.findUnique({
      where: { id: targetId },
      include: {
        squadRole: {
          select: {
            id: true,
            name: true,
            requiredTrainingIds: true,
            requiredRankIds: true,
          },
        },
        signups: true,
        squad: true,
      },
    });

    if (!targetSlot) {
      return NextResponse.json({ error: 'Target slot not found' }, { status: 404 });
    }

    // Check if target slot is full
    const maxSignups = targetSlot.maxSignups ?? null;
    if (maxSignups !== null && targetSlot.signups.length >= maxSignups) {
      return NextResponse.json({ error: 'Target slot is full' }, { status: 400 });
    }

    // Check if user already signed up in target slot
    const existingSignup = targetSlot.signups.find((s) => s.userId === signup.userId);
    if (existingSignup) {
      return NextResponse.json(
        { error: 'User already signed up in target slot' },
        { status: 400 }
      );
    }

    // Collect warnings instead of blocking on requirements
    const warnings: string[] = [];

    if (targetSlot.squadRole) {
      const requiredTrainingIds = targetSlot.squadRole.requiredTrainingIds?.length
        ? targetSlot.squadRole.requiredTrainingIds
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

          warnings.push(`User is missing required trainings: ${missingTrainings.map((training) => training.name).join(', ')}`);
        }
      }

      const requiredRankIds = targetSlot.squadRole.requiredRankIds?.length
        ? targetSlot.squadRole.requiredRankIds
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

        if (requiredRanks.length === requiredRankIds.length) {
          const userOrderIndex = userRank?.currentRank?.orderIndex;
          const unmetRanks = requiredRanks.filter(
            (requiredRank) => typeof userOrderIndex !== 'number' || userOrderIndex < requiredRank.orderIndex
          );

          if (unmetRanks.length > 0) {
            warnings.push(
              `User does not meet required ranks: ${unmetRanks
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((rank) => `[${rank.abbreviation}] ${rank.name}`)
                .join(', ')} or higher`
            );
          }
        }
      }
    }

    // Move the signup
    const updatedSignup = await prisma.signup.update({
      where: { id: signupId },
      data: {
        slotId: targetId,
      },
      include: {
        user: true,
        slot: {
          include: {
            squad: true,
            squadRole: true,
          },
        },
      },
    });

    publishOrbatEvent({
      type: 'signup.moved',
      orbatId: signup.slot.orbatId,
      actorUserId: Number(session.user.id),
      payload: {
        fromSlotId: signup.slotId,
        toSlotId: targetId,
      },
    });

    // Return signup with any warnings
    return NextResponse.json({
      signup: updatedSignup,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    console.error('Error moving signup:', error);
    return NextResponse.json({ error: 'Failed to move signup' }, { status: 500 });
  }
}
