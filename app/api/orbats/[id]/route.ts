import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { publishOrbatEvent } from '@/lib/realtime/orbat-events';

type SlotInput = {
  id?: number;
  squadRoleId?: number | null;
  name: string;
  orderIndex: number;
  maxSignups: number;
  _deleted?: boolean;
};

type SquadInput = {
  id?: number;
  name: string;
  orderIndex: number;
  slots: SlotInput[];
  _deleted?: boolean;
};

type OrbatUpdateInput = {
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkPermission(session.user.id, 'orbat:edit');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const orbatId = Number.parseInt(id, 10);

    if (Number.isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid OrbAT ID' }, { status: 400 });
    }

    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
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
      },
    });

    if (!orbat) {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    return NextResponse.json(orbat);
  } catch (error) {
    console.error('Error fetching OrbAT:', error);
    return NextResponse.json({ error: 'Failed to fetch OrbAT' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkPermission(session.user.id, 'orbat:edit');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const orbatId = Number.parseInt(id, 10);

    if (Number.isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid OrbAT ID' }, { status: 400 });
    }

    const body: OrbatUpdateInput = await request.json();

    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'OrbAT name is required' }, { status: 400 });
    }

    const activeSquads = body.squads.filter((squad) => !squad._deleted);
    if (activeSquads.length === 0) {
      return NextResponse.json({ error: 'At least one slot is required' }, { status: 400 });
    }

    const requestedDefinitionIds = Array.from(
      new Set(
        activeSquads
          .flatMap((squad) => squad.slots.filter((slot) => !slot._deleted))
          .map((slot) => slot.squadRoleId)
          .filter((id): id is number => typeof id === 'number')
      )
    );

    const squadRoles = requestedDefinitionIds.length
      ? await prisma.squadRole.findMany({
          where: { id: { in: requestedDefinitionIds } },
          select: { id: true, name: true, isRetired: true },
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

    await prisma.$transaction(async (tx) => {
      const existing = await tx.orbat.findUnique({ where: { id: orbatId }, select: { id: true } });
      if (!existing) {
        throw new Error('ORBAT_NOT_FOUND');
      }

      await tx.orbat.update({
        where: { id: orbatId },
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
          tempFrequencies: body.tempFrequencies || [],
        },
      });

      await tx.signup.deleteMany({ where: { slot: { orbatId } } });
      await tx.slot.deleteMany({ where: { orbatId } });
      await tx.squad.deleteMany({ where: { orbatId } });

      for (const squadInput of activeSquads) {
        const squad = await tx.squad.create({
          data: {
            orbatId,
            name: squadInput.name.trim(),
            orderIndex: squadInput.orderIndex,
          },
        });

        for (const slotInput of squadInput.slots.filter((slot) => !slot._deleted)) {
          await tx.slot.create({
            data: {
              orbatId,
              squadId: squad.id,
              squadRoleId: slotInput.squadRoleId ?? null,
              orderIndex: slotInput.orderIndex,
              maxSignups: slotInput.maxSignups,
            },
          });
        }
      }

      await tx.orbatRadioFrequency.deleteMany({ where: { orbatId } });
      if (body.frequencyIds && body.frequencyIds.length > 0) {
        await tx.orbatRadioFrequency.createMany({
          data: body.frequencyIds.map((frequencyId) => ({ orbatId, radioFrequencyId: frequencyId })),
          skipDuplicates: true,
        });
      }
    });

    const updatedOrbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
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
          include: { radioFrequency: true },
        },
      },
    });

    if (!updatedOrbat) {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    publishOrbatEvent({
      type: 'orbat.updated',
      orbatId,
      actorUserId: Number(session.user.id),
    });

    return NextResponse.json(updatedOrbat);
  } catch (error) {
    if (error instanceof Error && error.message === 'ORBAT_NOT_FOUND') {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    console.error('Error updating OrbAT:', error);
    return NextResponse.json({ error: 'Failed to update OrbAT' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkPermission(session.user.id, 'orbat:delete');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const orbatId = Number.parseInt(id, 10);

    if (Number.isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid OrbAT ID' }, { status: 400 });
    }

    const existingOrbat = await prisma.orbat.findUnique({ where: { id: orbatId } });
    if (!existingOrbat) {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    await prisma.orbat.delete({ where: { id: orbatId } });

    publishOrbatEvent({
      type: 'orbat.deleted',
      orbatId,
      actorUserId: Number(session.user.id),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting OrbAT:', error);
    return NextResponse.json({ error: 'Failed to delete OrbAT' }, { status: 500 });
  }
}
