// app/api/orbats/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

type SubslotInput = {
  id?: number;
  subslotDefinitionId?: number | null;
  name: string;
  orderIndex: number;
  maxSignups: number;
  radioFrequencyId?: number | null;
  _deleted?: boolean;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '5', 10);
    const maxLimit = Math.min(limit, 50); // Cap at 50 to prevent excessive queries

    const orbats = await prisma.orbat.findMany({
      take: maxLimit,
      orderBy: {
        createdAt: 'desc',
      },
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


type SlotInput = {
  name: string;
  orderIndex: number;
  subslots: SubslotInput[];
};

type OrbatInput = {
  name: string;
  description?: string;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  slots: SlotInput[];
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

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const hasPermission = await checkPermission(session.user.id, 'orbat:create');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body: OrbatInput = await request.json();

    // Validate input
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'OrbAT name is required' }, { status: 400 });
    }

    if (!body.slots || body.slots.length === 0) {
      return NextResponse.json({ error: 'At least one slot is required' }, { status: 400 });
    }

    // Prevent creating operations in the past
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
        body.slots
          .flatMap((slot) => slot.subslots)
          .map((subslot) => subslot.subslotDefinitionId)
          .filter((id): id is number => typeof id === 'number')
      )
    );

    const subslotDefinitions = requestedDefinitionIds.length
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

    const subslotDefinitionMap = new Map(subslotDefinitions.map((definition) => [definition.id, definition]));

    if (subslotDefinitions.length !== requestedDefinitionIds.length) {
      return NextResponse.json({ error: 'One or more selected subslot definitions do not exist.' }, { status: 400 });
    }

    // Create the OrbAT with all nested data in a transaction
    const orbat = await prisma.$transaction(async (tx) => {
      // Create the OrbAT
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
          createdById: session.user.id,
          tempFrequencies: body.tempFrequencies || [],
          slots: {
            create: body.slots.map((slot) => ({
              name: slot.name.trim(),
              orderIndex: slot.orderIndex,
              subslots: {
                create: slot.subslots.map((subslot) => ({
                  name: (subslot.subslotDefinitionId
                    ? subslotDefinitionMap.get(subslot.subslotDefinitionId)?.name
                    : subslot.name
                  )?.trim() || 'Unnamed Subslot',
                  orderIndex: subslot.orderIndex,
                  maxSignups: subslot.subslotDefinitionId
                    ? (subslotDefinitionMap.get(subslot.subslotDefinitionId)?.maxSignups ?? 1)
                    : subslot.maxSignups,
                  subslotDefinitionId: subslot.subslotDefinitionId ?? null,
                  requiredTrainingIds: subslot.subslotDefinitionId
                    ? (subslotDefinitionMap.get(subslot.subslotDefinitionId)?.requiredTrainingIds ?? [])
                    : [],
                  requiredRankIds: subslot.subslotDefinitionId
                    ? (subslotDefinitionMap.get(subslot.subslotDefinitionId)?.requiredRankIds ?? [])
                    : [],
                  requiredTrainingId: subslot.subslotDefinitionId
                    ? (subslotDefinitionMap.get(subslot.subslotDefinitionId)?.requiredTrainingId ?? null)
                    : null,
                  requiredRankId: subslot.subslotDefinitionId
                    ? (subslotDefinitionMap.get(subslot.subslotDefinitionId)?.requiredRankId ?? null)
                    : null,
                })),
              },
            })),
          },
          frequencies: {
            create: (body.frequencyIds || []).map((freqId) => ({
              radioFrequencyId: freqId,
            })),
          },
        },
        include: {
          slots: {
            include: {
              subslots: true,
            },
          },
          frequencies: {
            include: {
              radioFrequency: true,
            },
          },
        },
      });

      return newOrbat;
    });

    return NextResponse.json(orbat, { status: 201 });
  } catch (error) {
    console.error('Error creating OrbAT:', error);
    return NextResponse.json({ error: 'Failed to create OrbAT' }, { status: 500 });
  }
}
