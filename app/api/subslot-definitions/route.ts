import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { canAccessSubslotReadApi } from '@/lib/permission-api-logic';
import { publishAdminCatalogEvent } from '@/lib/realtime/admin-catalog-events';

type CreateSubslotDefinitionBody = {
  name?: string;
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

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [canViewSubslot, canCreateSubslot, canEditSubslot, canDeleteSubslot, canCreateTemplate, canEditTemplate, canDeleteTemplate, canCreateOrbat, canEditOrbat] = await Promise.all([
      checkPermission(session.user.id, 'subslot:view'),
      checkPermission(session.user.id, 'subslot:create'),
      checkPermission(session.user.id, 'subslot:edit'),
      checkPermission(session.user.id, 'subslot:delete'),
      checkPermission(session.user.id, 'template:create'),
      checkPermission(session.user.id, 'template:edit'),
      checkPermission(session.user.id, 'template:delete'),
      checkPermission(session.user.id, 'orbat:create'),
      checkPermission(session.user.id, 'orbat:edit'),
    ]);

    const canRead = canAccessSubslotReadApi({
      hasSuperAdmin: (session.user.permissions?.['system:super_admin'] ?? 0) > 0,
      canViewSubslot,
      canCreateSubslot,
      canEditSubslot,
      canDeleteSubslot,
      canCreateTemplate,
      canEditTemplate,
      canDeleteTemplate,
      canCreateOrbat,
      canEditOrbat,
    });

    if (!canRead) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const definitions = await prisma.squadRole.findMany({
      orderBy: { name: 'asc' },
    });

    const trainingIds = Array.from(
      new Set(
        definitions.flatMap((definition) => definition.requiredTrainingIds || [])
      )
    );
    const rankIds = Array.from(
      new Set(
        definitions.flatMap((definition) => definition.requiredRankIds || [])
      )
    );

    const [trainings, ranks] = await Promise.all([
      trainingIds.length
        ? prisma.training.findMany({
            where: { id: { in: trainingIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      rankIds.length
        ? prisma.rank.findMany({
            where: { id: { in: rankIds } },
            select: { id: true, name: true, abbreviation: true, orderIndex: true },
          })
        : Promise.resolve([]),
    ]);

    const trainingMap = new Map(trainings.map((training) => [training.id, training]));
    const rankMap = new Map(ranks.map((rank) => [rank.id, rank]));

    const enrichedDefinitions = definitions.map((definition) => {
      const requiredTrainings = (definition.requiredTrainingIds || [])
        .map((id) => trainingMap.get(id))
        .filter((item): item is { id: number; name: string } => Boolean(item));

      const requiredRanks = (definition.requiredRankIds || [])
        .map((id) => rankMap.get(id))
        .filter(
          (item): item is { id: number; name: string; abbreviation: string; orderIndex: number } =>
            Boolean(item)
        );

      return {
        ...definition,
        requiredTrainings,
        requiredRanks,
        requiredTraining: requiredTrainings[0] || null,
        requiredRank: requiredRanks[0] || null,
      };
    });

    return NextResponse.json(enrichedDefinitions);
  } catch (error) {
    console.error('Error fetching role definitions:', error);
    return NextResponse.json({ error: 'Failed to fetch role definitions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkPermission(session.user.id, 'subslot:create');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body: CreateSubslotDefinitionBody = await request.json();
    const name = body.name?.trim();
    const requiredTrainingIds = parseNumericIdArray(body.requiredTrainingIds);
    const requiredRankIds = parseNumericIdArray(body.requiredRankIds);

    if (!requiredTrainingIds.length && typeof body.requiredTrainingId === 'number') {
      requiredTrainingIds.push(body.requiredTrainingId);
    }

    if (!requiredRankIds.length && typeof body.requiredRankId === 'number') {
      requiredRankIds.push(body.requiredRankId);
    }

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const [validTrainingCount, validRankCount] = await Promise.all([
      requiredTrainingIds.length
        ? prisma.training.count({ where: { id: { in: requiredTrainingIds } } })
        : Promise.resolve(0),
      requiredRankIds.length
        ? prisma.rank.count({ where: { id: { in: requiredRankIds } } })
        : Promise.resolve(0),
    ]);

    if (requiredTrainingIds.length > 0 && validTrainingCount !== requiredTrainingIds.length) {
      return NextResponse.json({ error: 'One or more selected training prerequisites are invalid' }, { status: 400 });
    }

    if (requiredRankIds.length > 0 && validRankCount !== requiredRankIds.length) {
      return NextResponse.json({ error: 'One or more selected rank prerequisites are invalid' }, { status: 400 });
    }

    const created = await prisma.squadRole.create({
      data: {
        name,
        requiredTrainingIds,
        requiredRankIds,
      },
    });

    const [createdTrainings, createdRanks] = await Promise.all([
      requiredTrainingIds.length
        ? prisma.training.findMany({
            where: { id: { in: requiredTrainingIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      requiredRankIds.length
        ? prisma.rank.findMany({
            where: { id: { in: requiredRankIds } },
            select: { id: true, name: true, abbreviation: true, orderIndex: true },
          })
        : Promise.resolve([]),
    ]);

    const createdResponse = {
      ...created,
      requiredTrainings: createdTrainings,
      requiredRanks: createdRanks,
      requiredTraining: createdTrainings[0] || null,
      requiredRank: createdRanks[0] || null,
    };

    publishAdminCatalogEvent({
      type: 'role-definition.changed',
      actorUserId: session.user.id,
      payload: {
        action: 'created',
        roleDefinitionId: created.id,
      },
    });

    return NextResponse.json(createdResponse, { status: 201 });
  } catch (error) {
    console.error('Error creating role definition:', error);
    return NextResponse.json({ error: 'Failed to create role definition' }, { status: 500 });
  }
}
