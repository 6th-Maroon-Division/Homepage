import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';
import { createTrainingNotification } from '@/lib/training-notifications';
import { publishTrainingChatEvent } from '@/lib/realtime/training-chat-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';

type RouteContext = { params: Promise<{ id: string }> };
const userSelect = { id: true, username: true, avatarUrl: true } as const;

async function getRelevantTrainingIds(orbatId: number) {
  const slots = await prisma.slot.findMany({
    where: { orbatId },
    select: { squadRole: { select: { requiredTrainingIds: true } } },
  });
  return Array.from(new Set(slots.flatMap((slot) => slot.squadRole?.requiredTrainingIds ?? [])));
}

async function authorize(context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }
  const actorId = Number(session.user.id);
  if (!(await isTrainingStaff(actorId))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) } as const;
  }
  const { id } = await context.params;
  const orbatId = Number(id);
  if (!Number.isInteger(orbatId) || orbatId <= 0) {
    return { error: NextResponse.json({ error: 'Invalid ORBAT id' }, { status: 400 }) } as const;
  }
  const exists = await prisma.orbat.count({ where: { id: orbatId } });
  if (!exists) {
    return { error: NextResponse.json({ error: 'ORBAT not found' }, { status: 404 }) } as const;
  }
  return { actorId, orbatId } as const;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const access = await authorize(context);
  if ('error' in access) return access.error;

  const trainingIds = await getRelevantTrainingIds(access.orbatId);
  if (trainingIds.length === 0) {
    return NextResponse.json({ groups: [], total: 0 });
  }

  const [credentials, signups, slots] = await Promise.all([
    prisma.userTraining.findMany({
      where: { trainingId: { in: trainingIds }, status: 'needs_qualify' },
      include: {
        training: true,
        user: { select: userSelect },
      },
      orderBy: [{ training: { name: 'asc' } }, { user: { username: 'asc' } }],
    }),
    prisma.signup.findMany({
      where: { slot: { orbatId: access.orbatId } },
      include: {
        slot: {
          include: {
            squad: { select: { id: true, name: true } },
            squadRole: { select: { name: true, requiredTrainingIds: true } },
          },
        },
      },
    }),
    prisma.slot.findMany({
      where: { orbatId: access.orbatId },
      select: {
        id: true,
        maxSignups: true,
        squad: { select: { name: true } },
        squadRole: { select: { name: true, requiredTrainingIds: true } },
        _count: { select: { signups: true } },
      },
      orderBy: [{ squad: { orderIndex: 'asc' } }, { orderIndex: 'asc' }],
    }),
  ]);

  const signupByUserId = new Map(signups.map((signup) => [signup.userId, signup]));
  const groups = trainingIds.map((trainingId) => {
    const rows = credentials.filter((credential) => credential.trainingId === trainingId);
    const training = rows[0]?.training;
    return {
      training: training ? {
        id: training.id,
        name: training.name,
        qualificationNotes: training.orbatQualificationNotes,
      } : { id: trainingId, name: `Training #${trainingId}`, qualificationNotes: null },
      availableSlots: slots
        .filter((slot) =>
          slot.squadRole?.requiredTrainingIds.includes(trainingId)
          && (slot.maxSignups === null || slot._count.signups < slot.maxSignups),
        )
        .map((slot) => ({
          id: slot.id,
          label: `${slot.squad.name} — ${slot.squadRole?.name ?? 'Unassigned Role'}`,
          remainingCapacity: slot.maxSignups === null
            ? null
            : Math.max(0, slot.maxSignups - slot._count.signups),
        })),
      users: rows.map((credential) => {
        const signup = signupByUserId.get(credential.userId);
        const slotRelevant = signup?.slot.squadRole?.requiredTrainingIds.includes(trainingId) ?? false;
        return {
          userTrainingId: credential.id,
          user: credential.user,
          status: credential.status,
          notes: credential.notes,
          assignedSlot: signup && slotRelevant
            ? {
                signupId: signup.id,
                slotId: signup.slotId,
                slotName: signup.slot.squadRole?.name ?? 'Unassigned Role',
                squadName: signup.slot.squad.name,
              }
            : null,
        };
      }),
    };
  }).filter((group) => group.users.length > 0);

  return NextResponse.json({
    groups,
    total: credentials.length,
    orbatId: access.orbatId,
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const access = await authorize(context);
  if ('error' in access) return access.error;

  const body = await request.json();
  const userTrainingId = Number(body.userTrainingId);
  if (!Number.isInteger(userTrainingId) || userTrainingId <= 0) {
    return NextResponse.json({ error: 'userTrainingId is required' }, { status: 400 });
  }
  if (!['qualified', 'failed'].includes(body.status)) {
    return NextResponse.json({ error: 'Status must be qualified or failed' }, { status: 400 });
  }

  const relevantTrainingIds = await getRelevantTrainingIds(access.orbatId);
  const credential = await prisma.userTraining.findUnique({
    where: { id: userTrainingId },
    include: { training: true, user: { select: userSelect } },
  });
  if (!credential || !relevantTrainingIds.includes(credential.trainingId)) {
    return NextResponse.json({ error: 'Qualification is not relevant to this ORBAT' }, { status: 404 });
  }
  if (!credential.training.requiresOrbatQualification) {
    return NextResponse.json(
      { error: 'This training does not use ORBAT qualification' },
      { status: 409 },
    );
  }
  if (credential.status !== 'needs_qualify') {
    return NextResponse.json(
      { error: `Qualification is ${credential.status}; only needs_qualify records can be decided` },
      { status: 409 },
    );
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 4000) || null : null;
  const now = new Date();
  const relatedRequest = await prisma.trainingRequest.findFirst({
    where: {
      userId: credential.userId,
      trainingId: credential.trainingId,
      status: 'needs_qualify',
    },
    orderBy: { requestedAt: 'desc' },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const credentialUpdate = await tx.userTraining.updateMany({
      where: {
        id: userTrainingId,
        status: 'needs_qualify',
        statusUpdatedAt: credential.statusUpdatedAt,
      },
      data: {
        status: body.status,
        trainerId: access.actorId,
        notes,
        needsRetraining: body.status === 'failed',
        statusUpdatedAt: now,
        orbatQualifiedAt: body.status === 'qualified' ? now : null,
        failedAt: body.status === 'failed' ? now : null,
      },
    });
    if (credentialUpdate.count !== 1) {
      return null;
    }
    await tx.userTrainingStatusHistory.create({
      data: {
        userTrainingId,
        fromStatus: 'needs_qualify',
        toStatus: body.status,
        changedById: access.actorId,
        orbatId: access.orbatId,
        notes,
      },
    });
    if (relatedRequest) {
      const requestUpdate = await tx.trainingRequest.updateMany({
        where: { id: relatedRequest.id, status: 'needs_qualify' },
        data: { status: body.status, handledByAdminId: access.actorId },
      });
      if (requestUpdate.count === 1) {
        await tx.trainingRequestMessage.create({
          data: {
            requestId: relatedRequest.id,
            senderRole: 'SYSTEM',
            body: body.status === 'qualified'
              ? `ORBAT qualification passed${notes ? `: ${notes}` : '.'}`
              : `ORBAT qualification failed${notes ? `: ${notes}` : '.'}`,
          },
        });
      }
    }
    return tx.userTraining.findUnique({
      where: { id: userTrainingId },
      include: { training: true, user: { select: userSelect } },
    });
  });

  if (!updated) {
    return NextResponse.json(
      { error: 'This qualification was already updated. Refresh to see the latest status.' },
      { status: 409 },
    );
  }

  await createTrainingNotification({
    recipientUserIds: [credential.userId],
    title: `${credential.training.name} qualification ${body.status}`,
    body: body.status === 'qualified'
      ? `You are now fully qualified for ${credential.training.name}.`
      : `Your ${credential.training.name} qualification was marked as failed. Contact a trainer for another attempt.`,
    actionUrl: relatedRequest ? `/trainings/requests/${relatedRequest.id}` : `/orbats/${access.orbatId}`,
    createdById: access.actorId,
  });
  if (relatedRequest) {
    publishTrainingChatEvent(relatedRequest.id, { source: 'qualification', status: body.status });
  }
  publishUserProfileEvent(credential.userId, {
    source: 'orbat-qualification.updated',
    trainingId: credential.trainingId,
    orbatId: access.orbatId,
    status: body.status,
  });
  return NextResponse.json(updated);
}
