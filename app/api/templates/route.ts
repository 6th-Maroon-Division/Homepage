import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { NextResponse } from 'next/server';
import { checkPermission } from '@/lib/auth-middleware';
import { canAccessTemplateReadApi } from '@/lib/permission-api-logic';
import type { NextRequest } from 'next/server';

type TemplateSubslotInput = {
  name: string;
  orderIndex: number;
  maxSignups: number;
  subslotDefinitionId?: number | null;
  requiredTrainingIds?: number[];
  requiredRankIds?: number[];
  requiredTrainingId?: number | null;
  requiredRankId?: number | null;
};

type TemplateSlotInput = {
  name: string;
  orderIndex: number;
  subslots: TemplateSubslotInput[];
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    
    // Require authentication for template access
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Allow access if user has any template or ORBAT permission
    const [canCreateTemplate, canEditTemplate, canDeleteTemplate, canCreateOrbat, canEditOrbat] = await Promise.all([
      checkPermission(session.user.id, 'template:create'),
      checkPermission(session.user.id, 'template:edit'),
      checkPermission(session.user.id, 'template:delete'),
      checkPermission(session.user.id, 'orbat:create'),
      checkPermission(session.user.id, 'orbat:edit'),
    ]);

    if (!canAccessTemplateReadApi({
      isAdmin: Boolean(session.user.isAdmin),
      canCreateTemplate,
      canEditTemplate,
      canDeleteTemplate,
      canCreateOrbat,
      canEditOrbat,
    })) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const templates = await (prisma as any).orbatTemplate.findMany({
      where: { isActive: true },
      include: {
        createdBy: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return NextResponse.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const hasPermission = await checkPermission(session.user.id, 'template:create');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const data = await request.json();

    const {
      name,
      description,
      category,
      tagsJson,
      slotsJson,
      frequencyIds,
      bluforCountry,
      bluforRelationship,
      opforCountry,
      opforRelationship,
      indepCountry,
      indepRelationship,
      iedThreat,
      civilianRelationship,
      rulesOfEngagement,
      airspace,
      inGameTimezone,
      operationDay,
      startTime,
      endTime,
    } = data;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: 'Template name is required' },
        { status: 400 }
      );
    }

    if (!slotsJson) {
      return NextResponse.json(
        { error: 'Slot structure is required' },
        { status: 400 }
      );
    }

    const inputSlots = slotsJson as TemplateSlotInput[];
    const requestedDefinitionIds = Array.from(
      new Set(
        inputSlots
          .flatMap((slot) => slot.subslots)
          .map((subslot) => subslot.subslotDefinitionId)
          .filter((id): id is number => typeof id === 'number')
      )
    );

    const definitions = requestedDefinitionIds.length
      ? await prisma.subslotDefinition.findMany({
          where: { id: { in: requestedDefinitionIds } },
          select: {
            id: true,
            name: true,
            maxSignups: true,
            requiredTrainingIds: true,
            requiredRankIds: true,
            requiredTrainingId: true,
            requiredRankId: true,
          },
        })
      : [];

    if (definitions.length !== requestedDefinitionIds.length) {
      return NextResponse.json(
        { error: 'One or more selected subslot definitions do not exist.' },
        { status: 400 }
      );
    }

    const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));
    const normalizedSlotsJson = inputSlots.map((slot) => ({
      ...slot,
      subslots: slot.subslots.map((subslot) => {
        const definition =
          typeof subslot.subslotDefinitionId === 'number'
            ? definitionMap.get(subslot.subslotDefinitionId)
            : null;

        return {
          ...subslot,
          name: definition?.name ?? subslot.name,
          maxSignups: definition?.maxSignups ?? subslot.maxSignups,
          requiredTrainingIds: definition?.requiredTrainingIds ?? [],
          requiredRankIds: definition?.requiredRankIds ?? [],
          requiredTrainingId: definition?.requiredTrainingId ?? null,
          requiredRankId: definition?.requiredRankId ?? null,
        };
      }),
    }));

    // Get admin user ID from session
    const userId = session.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID not found in session' },
        { status: 403 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template = await (prisma as any).orbatTemplate.create({
      data: {
        name,
        description: description || null,
        category: category || null,
        tagsJson: tagsJson || null,
        slotsJson: normalizedSlotsJson,
        frequencyIds: frequencyIds || [],
        bluforCountry: bluforCountry || null,
        bluforRelationship: bluforRelationship || null,
        opforCountry: opforCountry || null,
        opforRelationship: opforRelationship || null,
        indepCountry: indepCountry || null,
        indepRelationship: indepRelationship || null,
        iedThreat: iedThreat || null,
        civilianRelationship: civilianRelationship || null,
        rulesOfEngagement: rulesOfEngagement || null,
        airspace: airspace || null,
        inGameTimezone: inGameTimezone || null,
        operationDay: operationDay || null,
        startTime: startTime || null,
        endTime: endTime || null,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    console.error('Error creating template:', error);
    return NextResponse.json(
      { error: 'Failed to create template' },
      { status: 500 }
    );
  }
}
