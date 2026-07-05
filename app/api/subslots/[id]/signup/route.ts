import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { publishOrbatEvent } from '@/lib/realtime/orbat-events';

type RouteParams = {
  params: Promise<{ id: string }>;
};

type SlotResponse = {
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

function getOperationCutoff(eventDate: Date | null, startTime?: string | null, endTime?: string | null): Date | null {
  if (!eventDate) {
    return null;
  }

  const cutoff = new Date(eventDate);
  const timeValue = endTime || startTime;

  if (timeValue && /^\d{2}:\d{2}$/.test(timeValue)) {
    const [hour, minute] = timeValue.split(':').map(Number);
    cutoff.setHours(hour, minute, 0, 0);
  } else {
    cutoff.setHours(23, 59, 59, 999);
  }

  return cutoff;
}

async function buildSlotResponse(slotId: number): Promise<SlotResponse | null> {
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: {
      squadRole: {
        select: {
          name: true,
          requiredTrainingIds: true,
          requiredRankIds: true,
        },
      },
      signups: {
        include: { user: true },
      },
    },
  });

  if (!slot) {
    return null;
  }

  const requiredTrainingIds = slot.squadRole?.requiredTrainingIds || [];
  const requiredRankIds = slot.squadRole?.requiredRankIds || [];

  const [requiredTrainings, requiredRanks] = await Promise.all([
    requiredTrainingIds.length
      ? prisma.training.findMany({
          where: { id: { in: requiredTrainingIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    requiredRankIds.length
      ? prisma.rank.findMany({
          where: { id: { in: requiredRankIds } },
          select: { id: true, name: true, abbreviation: true },
        })
      : Promise.resolve([]),
  ]);

  const trainingMap = new Map(requiredTrainings.map((training) => [training.id, training]));
  const rankMap = new Map(requiredRanks.map((rank) => [rank.id, rank]));

  const orderedTrainings = requiredTrainingIds
    .map((trainingId) => trainingMap.get(trainingId))
    .filter((item): item is { id: number; name: string } => Boolean(item));

  const orderedRanks = requiredRankIds
    .map((rankId) => rankMap.get(rankId))
    .filter((item): item is { id: number; name: string; abbreviation: string } => Boolean(item));

  return {
    id: slot.id,
    name: slot.squadRole?.name || 'Unassigned Role',
    orderIndex: slot.orderIndex,
    maxSignups: slot.maxSignups ?? 9999,
    requiredTrainings: orderedTrainings,
    requiredRanks: orderedRanks,
    requiredTraining: orderedTrainings[0] || null,
    requiredRank: orderedRanks[0] || null,
    signups: slot.signups.map((signup) => ({
      id: signup.id,
      user: signup.user
        ? {
            id: signup.user.id,
            username: signup.user.username,
          }
        : null,
    })),
  };
}

export async function POST(_req: NextRequest, context: RouteParams) {
  const { id } = await context.params;
  const slotId = Number(id);

  if (Number.isNaN(slotId)) {
    return NextResponse.json({ error: 'Invalid slot id' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'You must be logged in to sign up.' }, { status: 401 });
  }

  const currentUserId = Number(session.user.id);

  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: {
      orbat: true,
      squadRole: {
        select: {
          requiredTrainingIds: true,
          requiredRankIds: true,
          name: true,
        },
      },
      signups: true,
    },
  });

  if (!slot) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
  }

  const operationCutoff = getOperationCutoff(slot.orbat.eventDate, slot.orbat.startTime, slot.orbat.endTime);
  if (operationCutoff && operationCutoff < new Date()) {
    return NextResponse.json({ error: 'Operation is in the past. Signups are closed.' }, { status: 400 });
  }

  const alreadySigned = await prisma.signup.findFirst({
    where: {
      slotId,
      userId: currentUserId,
    },
  });

  if (alreadySigned) {
    return NextResponse.json({ error: 'You are already signed up for this slot.' }, { status: 400 });
  }

  const existingSignupInOrbat = await prisma.signup.findFirst({
    where: {
      userId: currentUserId,
      slot: {
        orbatId: slot.orbat.id,
      },
    },
    include: {
      slot: {
        include: {
          squad: true,
          squadRole: true,
        },
      },
    },
  });

  if (existingSignupInOrbat) {
    const roleName = existingSignupInOrbat.slot.squadRole?.name || 'slot';
    return NextResponse.json(
      { error: `You are already signed up for "${roleName}" in ${existingSignupInOrbat.slot.squad.name}.` },
      { status: 400 }
    );
  }

  const absentNote = await prisma.orbatAttendanceNote.findUnique({
    where: {
      orbatId_userId: {
        orbatId: slot.orbat.id,
        userId: currentUserId,
      },
    },
    select: {
      status: true,
    },
  });

  if (absentNote?.status === 'absent') {
    return NextResponse.json(
      {
        error:
          'You marked yourself as absent for this operation. Remove or change that note before signing up.',
      },
      { status: 400 }
    );
  }

  const requiredTrainingIds = slot.squadRole?.requiredTrainingIds || [];
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
        { error: `This slot requires all trainings: ${missingTrainings.map((training) => training.name).join(', ')}.` },
        { status: 400 }
      );
    }
  }

  const requiredRankIds = slot.squadRole?.requiredRankIds || [];
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
      return NextResponse.json({ error: 'Slot rank prerequisite is invalid.' }, { status: 400 });
    }

    const userOrderIndex = userRank?.currentRank?.orderIndex;
    const unmetRanks = requiredRanks.filter(
      (requiredRank) => typeof userOrderIndex !== 'number' || userOrderIndex < requiredRank.orderIndex
    );

    if (unmetRanks.length > 0) {
      return NextResponse.json(
        {
          error: `This slot requires all selected ranks: ${unmetRanks
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((rank) => `[${rank.abbreviation}] ${rank.name}`)
            .join(', ')} or higher.`,
        },
        { status: 400 }
      );
    }
  }

  if (slot.maxSignups !== null && slot.signups.length >= slot.maxSignups) {
    return NextResponse.json({ error: 'This slot is already full.' }, { status: 400 });
  }

  await prisma.signup.create({
    data: {
      slotId,
      userId: currentUserId,
    },
  });

  publishOrbatEvent({
    type: 'signup.created',
    orbatId: slot.orbat.id,
    actorUserId: currentUserId,
    payload: {
      slotId,
    },
  });

  const responseBody = await buildSlotResponse(slotId);
  if (!responseBody) {
    return NextResponse.json({ error: 'Failed to load updated slot.' }, { status: 500 });
  }

  return NextResponse.json(responseBody);
}

export async function DELETE(req: NextRequest, context: RouteParams) {
  const { id } = await context.params;
  const slotId = Number(id);

  if (Number.isNaN(slotId)) {
    return NextResponse.json({ error: 'Invalid slot id' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'You must be logged in to remove a signup.' }, { status: 401 });
  }

  const currentUserId = Number(session.user.id);

  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    include: { orbat: true },
  });

  if (!slot) {
    return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
  }

  const hasOrbatEditPermission = await checkPermission(currentUserId, 'orbat:edit');
  const operationCutoff = getOperationCutoff(slot.orbat.eventDate, slot.orbat.startTime, slot.orbat.endTime);
  if (!hasOrbatEditPermission && operationCutoff && operationCutoff < new Date()) {
    return NextResponse.json({ error: 'Operation is in the past. Signups cannot be modified.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const signupIdToDelete = body.signupId;

  const signup = hasOrbatEditPermission && signupIdToDelete
    ? await prisma.signup.findFirst({
        where: { id: Number(signupIdToDelete), slotId },
      })
    : await prisma.signup.findFirst({
        where: { slotId, userId: currentUserId },
      });

  if (!signup) {
    return NextResponse.json({ error: 'Signup not found.' }, { status: 400 });
  }

  await prisma.signup.delete({ where: { id: signup.id } });

  publishOrbatEvent({
    type: 'signup.deleted',
    orbatId: slot.orbat.id,
    actorUserId: currentUserId,
    payload: {
      slotId,
    },
  });

  const responseBody = await buildSlotResponse(slotId);
  if (!responseBody) {
    return NextResponse.json({ error: 'Failed to load updated slot.' }, { status: 500 });
  }

  return NextResponse.json(responseBody);
}
