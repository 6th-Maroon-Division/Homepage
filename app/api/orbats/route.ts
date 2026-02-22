import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

type SlotInput = {
  id?: number;
  squadRoleId?: number | null;
  name: string;
  orderIndex: number;
  maxSignups: number;
  radioFrequencyId?: number | null;
  _deleted?: boolean;
};

type SquadInput = {
  name: string;
  orderIndex: number;
  slots: SlotInput[];
};

type OrbatInput = {
  name: string;
  description?: string;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  squads: SquadInput[];
  frequencyIds?: number[];
  tempFrequencies?: Array<{
    frequency: string;
    type: 'SR' | 'LR';
    isAdditional: boolean;
    channel: string;
    callsign: string;
  }>;
  bluforCountry?: string | null;
  bluforRelationship?: string | null;
  opforCountry?: string | null;
  opforRelationship?: string | null;
  indepCountry?: string | null;
  indepRelationship?: string | null;
  iedThreat?: string | null;
  civilianRelationship?: string | null;
  rulesOfEngagement?: string | null;
  airspace?: string | null;
  inGameTimezone?: string | null;
  operationDay?: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number.parseInt(searchParams.get('limit') || '5', 10);
    const maxLimit = Math.min(limit, 50);

    const orbats = await prisma.orbat.findMany({
      take: maxLimit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
      },
    });

    return NextResponse.json(orbats);
  } catch (error) {
    console.error('Error fetching OrbATs:', error);
    return NextResponse.json({ error: 'Failed to fetch OrbATs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = Number(session.user.id);

    // Verify user exists in database (should be created during auth)
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User profile not found. Please sign out and sign in again.' },
        { status: 401 }
      );
    }

    const hasPermission = await checkPermission(userId, 'orbat:create');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body: OrbatInput = await request.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'OrbAT name is required' }, { status: 400 });
    }

    if (!body.squads || body.squads.length === 0) {
      return NextResponse.json({ error: 'At least one slot is required' }, { status: 400 });
    }

    if (body.eventDate) {
      const eventDate = new Date(body.eventDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      eventDate.setHours(0, 0, 0, 0);

      if (eventDate < today) {
        return NextResponse.json({ error: 'Cannot create operations with past dates' }, { status: 400 });
      }
    }

    const requestedDefinitionIds = Array.from(
      new Set(
        body.squads
          .flatMap((squad) => squad.slots)
          .map((slot) => slot.squadRoleId)
          .filter((id): id is number => typeof id === 'number')
      )
    );

    const squadRoles = requestedDefinitionIds.length
      ? await prisma.squadRole.findMany({
          where: { id: { in: requestedDefinitionIds } },
          select: { id: true, name: true, requiredTrainingIds: true, requiredRankIds: true, isRetired: true },
        })
      : [];

    if (squadRoles.length !== requestedDefinitionIds.length) {
      return NextResponse.json({ error: 'One or more selected role definitions do not exist.' }, { status: 400 });
    }

    const retiredRoleNames = squadRoles.filter((role) => role.isRetired).map((role) => role.name);
    if (retiredRoleNames.length > 0) {
      return NextResponse.json(
        { error: `Cannot use retired role definitions: ${retiredRoleNames.join(', ')}. Restore them or choose active roles.` },
        { status: 400 }
      );
    }

    const squadRoleMap = new Map(squadRoles.map((role) => [role.id, role]));

    const orbat = await prisma.$transaction(async (tx) => {
      const newOrbat = await tx.orbat.create({
        data: {
          name: body.name.trim(),
          description: body.description?.trim() || null,
          eventDate: body.eventDate ? new Date(body.eventDate) : null,
          startTime: body.startTime || null,
          endTime: body.endTime || null,
          bluforCountry: body.bluforCountry || null,
          bluforRelationship: body.bluforRelationship || null,
          opforCountry: body.opforCountry || null,
          opforRelationship: body.opforRelationship || null,
          indepCountry: body.indepCountry || null,
          indepRelationship: body.indepRelationship || null,
          iedThreat: body.iedThreat || null,
          civilianRelationship: body.civilianRelationship || null,
          rulesOfEngagement: body.rulesOfEngagement || null,
          airspace: body.airspace || null,
          inGameTimezone: body.inGameTimezone || null,
          operationDay: body.operationDay || null,
          createdById: userId,
          tempFrequencies: body.tempFrequencies || [],
        },
      });

      for (const squadInput of body.squads) {
        const squad = await tx.squad.create({
          data: {
            orbatId: newOrbat.id,
            name: squadInput.name.trim(),
            orderIndex: squadInput.orderIndex,
          },
        });

        for (const slotInput of squadInput.slots) {
          const role = typeof slotInput.squadRoleId === 'number'
            ? squadRoleMap.get(slotInput.squadRoleId)
            : null;

          await tx.slot.create({
            data: {
              orbatId: newOrbat.id,
              squadId: squad.id,
              squadRoleId: role?.id ?? null,
              orderIndex: slotInput.orderIndex,
              maxSignups: slotInput.maxSignups,
            },
          });
        }
      }

      if (body.frequencyIds && body.frequencyIds.length > 0) {
        await tx.orbatRadioFrequency.createMany({
          data: body.frequencyIds.map((frequencyId) => ({
            orbatId: newOrbat.id,
            radioFrequencyId: frequencyId,
          })),
          skipDuplicates: true,
        });
      }

      return tx.orbat.findUnique({
        where: { id: newOrbat.id },
        include: {
          squads: {
            orderBy: { orderIndex: 'asc' },
            include: {
              slots: {
                orderBy: { orderIndex: 'asc' },
                include: { squadRole: true },
              },
            },
          },
          frequencies: {
            include: {
              radioFrequency: true,
            },
          },
        },
      });
    });

    return NextResponse.json(orbat, { status: 201 });
  } catch (error) {
    console.error('Error creating OrbAT:', error);
    return NextResponse.json({ error: 'Failed to create OrbAT' }, { status: 500 });
  }
}
