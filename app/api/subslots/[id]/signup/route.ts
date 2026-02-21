// app/api/subslots/[id]/signup/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

type RouteParams = {
  params: Promise<{ id: string }>;
};

type SubslotWithSignupsAndUser = {
  id: number;
  name: string;
  orderIndex: number;
  maxSignups: number;
  requiredTrainings: { id: number; name: string }[];
  requiredRanks: { id: number; name: string; abbreviation: string }[];
  requiredTraining: { id: number; name: string } | null;
  requiredRank: { id: number; name: string; abbreviation: string } | null;
  signups: {
    id: number;
    user: {
      id: number;
      username: string | null;
    } | null;
  }[];
};

export async function POST(_req: NextRequest, context: RouteParams) {
  const { id } = await context.params;
  const subslotId = Number(id);

  if (Number.isNaN(subslotId)) {
    return NextResponse.json({ error: 'Invalid subslot id' }, { status: 400 });
  }

  // Get the current logged-in user from session
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'You must be logged in to sign up.' },
      { status: 401 },
    );
  }

  const currentUserId = Number(session.user.id);

  // Load subslot + its orbat to check date, capacity, etc.
  const subslot = await prisma.subslot.findUnique({
    where: { id: subslotId },
    include: {
      slot: {
        include: { orbat: true },
      },
      signups: true,
    },
  });

  if (!subslot) {
    return NextResponse.json({ error: 'Subslot not found' }, { status: 404 });
  }

  const orbat = subslot.slot.orbat;
  const now = new Date();

  // Past ops cannot be signed up to
  if (orbat.eventDate && orbat.eventDate < now) {
    return NextResponse.json(
      { error: 'Operation is in the past. Signups are closed.' },
      { status: 400 },
    );
  }

  // Check if this user already signed up for this subslot
  const alreadySigned = await prisma.signup.findFirst({
    where: {
      subslotId,
      userId: currentUserId,
    },
  });

  if (alreadySigned) {
    return NextResponse.json(
      { error: 'You are already signed up for this slot.' },
      { status: 400 },
    );
  }

  // Check if user is already signed up anywhere in this ORBAT
  const existingSignupInOrbat = await prisma.signup.findFirst({
    where: {
      userId: currentUserId,
      subslot: {
        slot: {
          orbatId: subslot.slot.orbat.id,
        },
      },
    },
    include: {
      subslot: {
        include: {
          slot: true,
        },
      },
    },
  });

  if (existingSignupInOrbat) {
    return NextResponse.json(
      { error: `You are already signed up for "${existingSignupInOrbat.subslot.name}" in ${existingSignupInOrbat.subslot.slot.name}.` },
      { status: 400 },
    );
  }

  const requiredTrainingIds = subslot.requiredTrainingIds?.length
    ? subslot.requiredTrainingIds
    : subslot.requiredTrainingId
      ? [subslot.requiredTrainingId]
      : [];

  if (requiredTrainingIds.length > 0) {
    const completedTrainings = await prisma.userTraining.findMany({
      where: {
        userId: currentUserId,
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
        {
          error: `This subslot requires all trainings: ${missingTrainings.map((training) => training.name).join(', ')}.`,
        },
        { status: 400 },
      );
    }
  }

  const requiredRankIds = subslot.requiredRankIds?.length
    ? subslot.requiredRankIds
    : subslot.requiredRankId
      ? [subslot.requiredRankId]
      : [];

  if (requiredRankIds.length > 0) {
    const [userRank, requiredRanks] = await Promise.all([
      prisma.userRank.findUnique({
        where: { userId: currentUserId },
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
      return NextResponse.json({ error: 'Subslot rank prerequisite is invalid.' }, { status: 400 });
    }

    const userOrderIndex = userRank?.currentRank?.orderIndex;
    const unmetRanks = requiredRanks.filter(
      (requiredRank) => typeof userOrderIndex !== 'number' || userOrderIndex < requiredRank.orderIndex
    );

    if (unmetRanks.length > 0) {
      return NextResponse.json(
        {
          error: `This subslot requires all selected ranks: ${unmetRanks
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((rank) => `[${rank.abbreviation}] ${rank.name}`)
            .join(', ')} or higher.`,
        },
        { status: 400 },
      );
    }
  }

  // Check if slot is full
  const currentCount = await prisma.signup.count({
    where: { subslotId },
  });

  if (currentCount >= subslot.maxSignups) {
    return NextResponse.json(
      { error: 'This slot is already full.' },
      { status: 400 },
    );
  }

  // Create signup
  await prisma.signup.create({
    data: {
      subslotId,
      userId: currentUserId,
    },
  });

  // Return updated subslot with users included
  const updatedSubslot = await prisma.subslot.findUnique({
    where: { id: subslotId },
    include: {
      signups: {
        include: { user: true },
      },
    },
  });

  if (!updatedSubslot) {
    return NextResponse.json(
      { error: 'Failed to load updated subslot.' },
      { status: 500 },
    );
  }

  const responseTrainingIds = updatedSubslot.requiredTrainingIds?.length
    ? updatedSubslot.requiredTrainingIds
    : updatedSubslot.requiredTrainingId
      ? [updatedSubslot.requiredTrainingId]
      : [];
  const responseRankIds = updatedSubslot.requiredRankIds?.length
    ? updatedSubslot.requiredRankIds
    : updatedSubslot.requiredRankId
      ? [updatedSubslot.requiredRankId]
      : [];

  const [responseTrainings, responseRanks] = await Promise.all([
    responseTrainingIds.length
      ? prisma.training.findMany({
          where: { id: { in: responseTrainingIds } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    responseRankIds.length
      ? prisma.rank.findMany({
          where: { id: { in: responseRankIds } },
          select: { id: true, name: true, abbreviation: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const responseTrainingMap = new Map(responseTrainings.map((training) => [training.id, training]));
  const responseRankMap = new Map(responseRanks.map((rank) => [rank.id, rank]));

  const orderedTrainings = responseTrainingIds
    .map((id) => responseTrainingMap.get(id))
    .filter((item): item is { id: number; name: string } => Boolean(item));
  const orderedRanks = responseRankIds
    .map((id) => responseRankMap.get(id))
    .filter((item): item is { id: number; name: string; abbreviation: string } => Boolean(item));

  const responseBody: SubslotWithSignupsAndUser = {
    id: updatedSubslot.id,
    name: updatedSubslot.name,
    orderIndex: updatedSubslot.orderIndex,
    maxSignups: updatedSubslot.maxSignups,
    requiredTrainings: orderedTrainings,
    requiredRanks: orderedRanks,
    requiredTraining: orderedTrainings[0] || null,
    requiredRank: orderedRanks[0] || null,
    signups: updatedSubslot.signups.map((s) => ({
      id: s.id,
      user: s.user
        ? {
            id: s.user.id,
            username: s.user.username,
          }
        : null,
    })),
  };

  return NextResponse.json(responseBody);
}

export async function DELETE(req: NextRequest, context: RouteParams) {
  const { id } = await context.params;
  const subslotId = Number(id);

  if (Number.isNaN(subslotId)) {
    return NextResponse.json({ error: 'Invalid subslot id' }, { status: 400 });
  }

  // Get the current logged-in user from session
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'You must be logged in to remove a signup.' },
      { status: 401 },
    );
  }

  const currentUserId = Number(session.user.id);
  
  // Load subslot to check if the operation is in the past
  const subslot = await prisma.subslot.findUnique({
    where: { id: subslotId },
    include: {
      slot: {
        include: { orbat: true },
      },
    },
  });

  if (!subslot) {
    return NextResponse.json({ error: 'Subslot not found' }, { status: 404 });
  }

  const orbat = subslot.slot.orbat;
  const now = new Date();

  // Check if user has permission to modify signups
  const hasOrbatEditPermission = await checkPermission(currentUserId, 'orbat:edit');
  
  // Past ops cannot be modified (unless has orbat:edit permission)
  if (!hasOrbatEditPermission && orbat.eventDate && orbat.eventDate < now) {
    return NextResponse.json(
      { error: 'Operation is in the past. Signups cannot be modified.' },
      { status: 400 },
    );
  }

  // Admins can specify a signup ID to delete, otherwise delete current user's signup
  const body = await req.json().catch(() => ({}));
  const signupIdToDelete = body.signupId;

  let signup;

  if (hasOrbatEditPermission && signupIdToDelete) {
    // User with orbat:edit can remove a specific signup
    signup = await prisma.signup.findFirst({
      where: {
        id: Number(signupIdToDelete),
        subslotId,
      },
    });
  } else {
    // User removing their own signup
    signup = await prisma.signup.findFirst({
      where: {
        subslotId,
        userId: currentUserId,
      },
    });
  }

  if (!signup) {
    return NextResponse.json(
      { error: 'Signup not found.' },
      { status: 400 },
    );
  }

  // Delete the signup
  await prisma.signup.delete({
    where: { id: signup.id },
  });

  // Return updated subslot with users included
  const updatedSubslot = await prisma.subslot.findUnique({
    where: { id: subslotId },
    include: {
      signups: {
        include: { user: true },
      },
    },
  });

  if (!updatedSubslot) {
    return NextResponse.json(
      { error: 'Failed to load updated subslot.' },
      { status: 500 },
    );
  }

  const responseTrainingIds = updatedSubslot.requiredTrainingIds?.length
    ? updatedSubslot.requiredTrainingIds
    : updatedSubslot.requiredTrainingId
      ? [updatedSubslot.requiredTrainingId]
      : [];
  const responseRankIds = updatedSubslot.requiredRankIds?.length
    ? updatedSubslot.requiredRankIds
    : updatedSubslot.requiredRankId
      ? [updatedSubslot.requiredRankId]
      : [];

  const [responseTrainings, responseRanks] = await Promise.all([
    responseTrainingIds.length
      ? prisma.training.findMany({
          where: { id: { in: responseTrainingIds } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    responseRankIds.length
      ? prisma.rank.findMany({
          where: { id: { in: responseRankIds } },
          select: { id: true, name: true, abbreviation: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const responseTrainingMap = new Map(responseTrainings.map((training) => [training.id, training]));
  const responseRankMap = new Map(responseRanks.map((rank) => [rank.id, rank]));

  const orderedTrainings = responseTrainingIds
    .map((id) => responseTrainingMap.get(id))
    .filter((item): item is { id: number; name: string } => Boolean(item));
  const orderedRanks = responseRankIds
    .map((id) => responseRankMap.get(id))
    .filter((item): item is { id: number; name: string; abbreviation: string } => Boolean(item));

  const responseBody: SubslotWithSignupsAndUser = {
    id: updatedSubslot.id,
    name: updatedSubslot.name,
    orderIndex: updatedSubslot.orderIndex,
    maxSignups: updatedSubslot.maxSignups,
    requiredTrainings: orderedTrainings,
    requiredRanks: orderedRanks,
    requiredTraining: orderedTrainings[0] || null,
    requiredRank: orderedRanks[0] || null,
    signups: updatedSubslot.signups.map((s) => ({
      id: s.id,
      user: s.user
        ? {
            id: s.user.id,
            username: s.user.username,
          }
        : null,
    })),
  };

  return NextResponse.json(responseBody);
}
