import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

type RouteParams = {
  params: Promise<{ id: string }>;
};

type UpdateSubslotDefinitionBody = {
  name?: string;
  maxSignups?: number;
  requiredTrainingIds?: number[];
  requiredRankIds?: number[];
  requiredTrainingId?: number | null;
  requiredRankId?: number | null;
};

function parseNumericIdArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0)
    )
  );
}

export async function PATCH(request: NextRequest, context: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkPermission(session.user.id, 'subslot:edit');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    const definitionId = Number(id);
    if (Number.isNaN(definitionId)) {
      return NextResponse.json({ error: 'Invalid subslot definition id' }, { status: 400 });
    }

    const body: UpdateSubslotDefinitionBody = await request.json();

    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    if (typeof body.name === 'string' && !name) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }

    const maxSignups =
      typeof body.maxSignups === 'number' ? Number(body.maxSignups) : undefined;
    if (typeof maxSignups === 'number' && (Number.isNaN(maxSignups) || maxSignups < 1)) {
      return NextResponse.json({ error: 'Max signups must be at least 1' }, { status: 400 });
    }

    const hasTrainingArrayUpdate = body.requiredTrainingIds !== undefined || body.requiredTrainingId !== undefined;
    const hasRankArrayUpdate = body.requiredRankIds !== undefined || body.requiredRankId !== undefined;

    let requiredTrainingIds =
      body.requiredTrainingIds !== undefined ? parseNumericIdArray(body.requiredTrainingIds) : undefined;
    let requiredRankIds =
      body.requiredRankIds !== undefined ? parseNumericIdArray(body.requiredRankIds) : undefined;

    if (requiredTrainingIds !== undefined && !requiredTrainingIds.length && typeof body.requiredTrainingId === 'number') {
      requiredTrainingIds = [body.requiredTrainingId];
    }

    if (requiredRankIds !== undefined && !requiredRankIds.length && typeof body.requiredRankId === 'number') {
      requiredRankIds = [body.requiredRankId];
    }

    if (requiredTrainingIds === undefined && typeof body.requiredTrainingId === 'number') {
      requiredTrainingIds = [body.requiredTrainingId];
    }

    if (requiredRankIds === undefined && typeof body.requiredRankId === 'number') {
      requiredRankIds = [body.requiredRankId];
    }

    if (requiredTrainingIds && requiredTrainingIds.length > 0) {
      const validTrainingCount = await prisma.training.count({ where: { id: { in: requiredTrainingIds } } });
      if (validTrainingCount !== requiredTrainingIds.length) {
        return NextResponse.json({ error: 'One or more selected training prerequisites are invalid' }, { status: 400 });
      }
    }

    if (requiredRankIds && requiredRankIds.length > 0) {
      const validRankCount = await prisma.rank.count({ where: { id: { in: requiredRankIds } } });
      if (validRankCount !== requiredRankIds.length) {
        return NextResponse.json({ error: 'One or more selected rank prerequisites are invalid' }, { status: 400 });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const definition = await tx.subslotDefinition.update({
        where: { id: definitionId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(maxSignups !== undefined ? { maxSignups } : {}),
          ...(hasTrainingArrayUpdate
            ? {
                requiredTrainingIds: requiredTrainingIds ?? [],
                requiredTrainingId: (requiredTrainingIds ?? [])[0] ?? null,
              }
            : {}),
          ...(hasRankArrayUpdate
            ? {
                requiredRankIds: requiredRankIds ?? [],
                requiredRankId: (requiredRankIds ?? [])[0] ?? null,
              }
            : {}),
        },
      });

      await tx.subslot.updateMany({
        where: { subslotDefinitionId: definitionId },
        data: {
          name: definition.name,
          maxSignups: definition.maxSignups,
          requiredTrainingIds: definition.requiredTrainingIds,
          requiredRankIds: definition.requiredRankIds,
          requiredTrainingId: definition.requiredTrainingId,
          requiredRankId: definition.requiredRankId,
        },
      });

      const [requiredTrainings, requiredRanks] = await Promise.all([
        definition.requiredTrainingIds.length
          ? tx.training.findMany({
              where: { id: { in: definition.requiredTrainingIds } },
              select: { id: true, name: true },
            })
          : Promise.resolve([]),
        definition.requiredRankIds.length
          ? tx.rank.findMany({
              where: { id: { in: definition.requiredRankIds } },
              select: { id: true, name: true, abbreviation: true, orderIndex: true },
            })
          : Promise.resolve([]),
      ]);

      return {
        ...definition,
        requiredTrainings,
        requiredRanks,
        requiredTraining: requiredTrainings[0] || null,
        requiredRank: requiredRanks[0] || null,
      };
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating subslot definition:', error);
    return NextResponse.json({ error: 'Failed to update subslot definition' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteParams) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkPermission(session.user.id, 'subslot:delete');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    const definitionId = Number(id);
    if (Number.isNaN(definitionId)) {
      return NextResponse.json({ error: 'Invalid subslot definition id' }, { status: 400 });
    }

    const linkedCount = await prisma.subslot.count({
      where: { subslotDefinitionId: definitionId },
    });

    if (linkedCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete a subslot definition that is used by existing ORBAT slots.' },
        { status: 400 }
      );
    }

    await prisma.subslotDefinition.delete({
      where: { id: definitionId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting subslot definition:', error);
    return NextResponse.json({ error: 'Failed to delete subslot definition' }, { status: 500 });
  }
}
