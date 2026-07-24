import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';
import { formatOrbatTrainingAccessError, getOrbatTrainingAccess } from '@/lib/training-gating';
import { publishOrbatEvent } from '@/lib/realtime/orbat-events';
import { runSerializableTransaction } from '@/lib/serializable-transaction';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const actorId = Number(session.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;
  const orbatId = Number(id);
  const body = await request.json();
  const userTrainingId = Number(body.userTrainingId);
  const targetSlotId = Number(body.targetSlotId);
  if (![orbatId, userTrainingId, targetSlotId].every((value) => Number.isInteger(value) && value > 0)) {
    return NextResponse.json({ error: 'Valid ORBAT, user training, and target slot IDs are required' }, { status: 400 });
  }

  const [credential, targetSlot] = await Promise.all([
    prisma.userTraining.findUnique({ where: { id: userTrainingId } }),
    prisma.slot.findUnique({
      where: { id: targetSlotId },
      include: {
        orbat: true,
        squadRole: { select: { name: true, requiredTrainingIds: true, requiredRankIds: true } },
      },
    }),
  ]);
  if (!credential || credential.status !== 'needs_qualify') {
    return NextResponse.json({ error: 'User is not awaiting qualification' }, { status: 409 });
  }
  if (!targetSlot || targetSlot.orbatId !== orbatId) {
    return NextResponse.json({ error: 'Target slot is not part of this ORBAT' }, { status: 404 });
  }
  if (!targetSlot.squadRole?.requiredTrainingIds.includes(credential.trainingId)) {
    return NextResponse.json({ error: 'Target slot does not evaluate this qualification' }, { status: 409 });
  }
  const operationCutoff = resolveOrbatScheduleWindow(targetSlot.orbat).cutoff;
  if (operationCutoff && operationCutoff < new Date()) {
    return NextResponse.json({ error: 'Operation is in the past. Signups are closed.' }, { status: 409 });
  }
  const absentNote = await prisma.orbatAttendanceNote.findUnique({
    where: { orbatId_userId: { orbatId, userId: credential.userId } },
    select: { status: true },
  });
  if (absentNote?.status === 'absent') {
    return NextResponse.json(
      { error: 'The user is marked absent for this operation.' },
      { status: 409 },
    );
  }

  const trainingAccess = await getOrbatTrainingAccess(
    credential.userId,
    targetSlot.squadRole.requiredTrainingIds,
  );
  if (!trainingAccess.allowed) {
    const accessError = formatOrbatTrainingAccessError(trainingAccess);
    return NextResponse.json(
      { error: accessError?.error ?? 'User does not meet this slot’s training requirements' },
      { status: 409 },
    );
  }

  const requiredRankIds = targetSlot.squadRole.requiredRankIds;
  if (requiredRankIds.length > 0) {
    const [userRank, requiredRanks] = await Promise.all([
      prisma.userRank.findUnique({
        where: { userId: credential.userId },
        select: { currentRank: { select: { orderIndex: true } } },
      }),
      prisma.rank.findMany({
        where: { id: { in: requiredRankIds } },
        select: { id: true, name: true, abbreviation: true, orderIndex: true },
      }),
    ]);
    if (requiredRanks.length !== requiredRankIds.length) {
      return NextResponse.json({ error: 'Slot rank prerequisite is invalid' }, { status: 409 });
    }
    const userOrderIndex = userRank?.currentRank?.orderIndex;
    const unmetRanks = requiredRanks.filter(
      (rank) => typeof userOrderIndex !== 'number' || userOrderIndex < rank.orderIndex,
    );
    if (unmetRanks.length > 0) {
      return NextResponse.json(
        {
          error: `User does not meet required ranks: ${unmetRanks
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((rank) => `[${rank.abbreviation}] ${rank.name}`)
            .join(', ')} or higher`,
        },
        { status: 409 },
      );
    }
  }

  const assignment = await runSerializableTransaction(async (tx) => {
    const [freshCredential, freshSlot, existingSignup] = await Promise.all([
      tx.userTraining.findUnique({ where: { id: userTrainingId }, select: { status: true } }),
      tx.slot.findUnique({
        where: { id: targetSlotId },
        select: { maxSignups: true, orbatId: true, _count: { select: { signups: true } } },
      }),
      tx.signup.findFirst({ where: { userId: credential.userId, slot: { orbatId } } }),
    ]);

    if (freshCredential?.status !== 'needs_qualify') {
      return { error: 'Qualification status changed; refresh and try again' } as const;
    }
    if (!freshSlot || freshSlot.orbatId !== orbatId) {
      return { error: 'Target slot is no longer available' } as const;
    }
    if (
      existingSignup?.slotId !== targetSlotId
      && freshSlot.maxSignups !== null
      && freshSlot._count.signups >= freshSlot.maxSignups
    ) {
      return { error: 'Target slot is full' } as const;
    }

    const signup = existingSignup
      ? await tx.signup.update({ where: { id: existingSignup.id }, data: { slotId: targetSlotId } })
      : await tx.signup.create({ data: { userId: credential.userId, slotId: targetSlotId } });
    return { signup, moved: Boolean(existingSignup) } as const;
  });

  if ('error' in assignment) {
    return NextResponse.json({ error: assignment.error }, { status: 409 });
  }
  const { signup } = assignment;

  publishOrbatEvent({
    type: assignment.moved ? 'signup.moved' : 'signup.created',
    orbatId,
    actorUserId: actorId,
    payload: {
      signupId: signup.id,
      userId: credential.userId,
      slotId: targetSlotId,
      qualificationTrainingId: credential.trainingId,
    },
  });
  return NextResponse.json({ signup, temporaryAccess: true });
}
