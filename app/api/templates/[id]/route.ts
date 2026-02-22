import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { NextResponse } from 'next/server';
import { checkPermission } from '@/lib/auth-middleware';
import { canAccessTemplateReadApi } from '@/lib/permission-api-logic';

type TemplateRoleSlotInput = {
  name: string;
  orderIndex: number;
  maxSignups: number;
  squadRoleId?: number | null;
  requiredTrainingIds?: number[];
  requiredRankIds?: number[];
  requiredTrainingId?: number | null;
  requiredRankId?: number | null;
};

type TemplateSquadInput = {
  name: string;
  orderIndex: number;
  slots: TemplateRoleSlotInput[];
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const templateId = parseInt(id);
    
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
    const template = await (prisma as any).orbatTemplate.findUnique({
      where: { id: templateId },
      include: {
        createdBy: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    if (!template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { error: 'Failed to fetch template' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const hasPermission = await checkPermission(session.user.id, 'template:edit');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const templateId = parseInt(id);

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
      isActive,
    } = data;

    let normalizedSlotsJson = slotsJson;
    if (slotsJson) {
      const inputSlots = slotsJson as TemplateSquadInput[];
      const requestedDefinitionIds = Array.from(
        new Set(
          inputSlots
            .flatMap((squad) => squad.slots)
            .map((slot) => slot.squadRoleId)
            .filter((id): id is number => typeof id === 'number')
        )
      );

      const definitions = requestedDefinitionIds.length
        ? await prisma.squadRole.findMany({
            where: { id: { in: requestedDefinitionIds } },
            select: {
              id: true,
              name: true,
              requiredTrainingIds: true,
              requiredRankIds: true,
              isRetired: true,
            },
          })
        : [];

      if (definitions.length !== requestedDefinitionIds.length) {
        return NextResponse.json(
          { error: 'One or more selected role definitions do not exist.' },
          { status: 400 }
        );
      }

      const retiredRoleNames = definitions.filter((role) => role.isRetired).map((role) => role.name);
      if (retiredRoleNames.length > 0) {
        return NextResponse.json(
          { error: `Cannot use retired role definitions: ${retiredRoleNames.join(', ')}. Restore them or choose active roles.` },
          { status: 400 }
        );
      }

      const definitionMap = new Map(definitions.map((definition) => [definition.id, definition]));
      normalizedSlotsJson = inputSlots.map((squad) => ({
        ...squad,
        slots: squad.slots.map((slot) => {
          const definition =
            typeof slot.squadRoleId === 'number'
              ? definitionMap.get(slot.squadRoleId)
              : null;

          return {
            ...slot,
            name: definition?.name ?? slot.name,
            requiredTrainingIds: definition?.requiredTrainingIds ?? [],
            requiredRankIds: definition?.requiredRankIds ?? [],
            requiredTrainingId: (definition?.requiredTrainingIds ?? [])[0] ?? null,
            requiredRankId: (definition?.requiredRankIds ?? [])[0] ?? null,
          };
        }),
      }));
    }

    // Verify template exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existingTemplate = await (prisma as any).orbatTemplate.findUnique({
      where: { id: templateId },
    });

    if (!existingTemplate) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template = await (prisma as any).orbatTemplate.update({
      where: { id: templateId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(tagsJson !== undefined && { tagsJson }),
        ...(normalizedSlotsJson && { slotsJson: normalizedSlotsJson }),
        ...(frequencyIds && { frequencyIds }),
        ...(bluforCountry !== undefined && { bluforCountry }),
        ...(bluforRelationship !== undefined && { bluforRelationship }),
        ...(opforCountry !== undefined && { opforCountry }),
        ...(opforRelationship !== undefined && { opforRelationship }),
        ...(indepCountry !== undefined && { indepCountry }),
        ...(indepRelationship !== undefined && { indepRelationship }),
        ...(iedThreat !== undefined && { iedThreat }),
        ...(civilianRelationship !== undefined && { civilianRelationship }),
        ...(rulesOfEngagement !== undefined && { rulesOfEngagement }),
        ...(airspace !== undefined && { airspace }),
        ...(inGameTimezone !== undefined && { inGameTimezone }),
        ...(operationDay !== undefined && { operationDay }),
        ...(startTime !== undefined && { startTime }),
        ...(endTime !== undefined && { endTime }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      },
      include: {
        createdBy: {
          select: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    return NextResponse.json(
      { error: 'Failed to update template' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const hasPermission = await checkPermission(session.user.id, 'template:delete');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const templateId = parseInt(id);

    // Soft delete by marking as inactive instead of hard delete
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).orbatTemplate.update({
      where: { id: templateId },
      data: { isActive: false },
    });

    return NextResponse.json(
      { message: 'Template deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting template:', error);
    return NextResponse.json(
      { error: 'Failed to delete template' },
      { status: 500 }
    );
  }
}
