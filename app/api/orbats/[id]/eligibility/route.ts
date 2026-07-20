import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import {
  evaluateOrbatTrainingAccess,
  formatOrbatTrainingAccessError,
  type OrbatTrainingRequirement,
  type UserTrainingStatusRecord,
} from '@/lib/orbat-training-access';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const orbatId = Number(id);
  if (!Number.isInteger(orbatId) || orbatId <= 0) {
    return NextResponse.json({ error: 'Invalid ORBAT id' }, { status: 400 });
  }

  const slots = await prisma.slot.findMany({
    where: { orbatId },
    select: {
      id: true,
      squadRole: { select: { requiredTrainingIds: true } },
    },
  });
  if (slots.length === 0) {
    const exists = await prisma.orbat.count({ where: { id: orbatId } });
    if (!exists) return NextResponse.json({ error: 'ORBAT not found' }, { status: 404 });
  }

  const requiredIds = Array.from(new Set(
    slots.flatMap((slot) => slot.squadRole?.requiredTrainingIds ?? []),
  ));
  const [trainings, userTrainings] = await Promise.all([
    prisma.training.findMany({
      where: { id: { in: requiredIds } },
      select: { id: true, name: true, requiresOrbatQualification: true },
    }),
    prisma.userTraining.findMany({
      where: { userId: Number(session.user.id), trainingId: { in: requiredIds } },
      select: { trainingId: true, status: true },
    }),
  ]);
  const trainingById = new Map(trainings.map((training) => [training.id, training]));
  const statusRecords = userTrainings as UserTrainingStatusRecord[];

  const eligibility = Object.fromEntries(slots.map((slot) => {
    const requirements: OrbatTrainingRequirement[] = (slot.squadRole?.requiredTrainingIds ?? []).map(
      (trainingId) => trainingById.get(trainingId) ?? {
        id: trainingId,
        name: `Training #${trainingId}`,
        requiresOrbatQualification: true,
      },
    );
    const access = evaluateOrbatTrainingAccess(requirements, statusRecords);
    const error = formatOrbatTrainingAccessError(access);
    return [slot.id, {
      allowed: access.allowed,
      temporary: access.hasTemporaryAccess,
      temporaryTrainings: access.temporaryRequirements.map((item) => ({ id: item.id, name: item.name })),
      error: error?.error ?? null,
      code: error?.code ?? null,
    }];
  }));

  return NextResponse.json({ eligibility });
}
