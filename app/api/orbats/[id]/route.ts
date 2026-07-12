import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { publishOrbatEvent } from '@/lib/realtime/orbat-events';
import { publishAdminCatalogEvent } from '@/lib/realtime/admin-catalog-events';

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
  eventDateUtc?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  startsAtUtc?: string | null;
  endsAtUtc?: string | null;
  timezone?: string | null;
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

const parseUtcDate = (value?: string | null): Date | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatUtcTime = (value: Date | null): string | null => {
  if (!value) {
    return null;
  }

  const hour = String(value.getUTCHours()).padStart(2, '0');
  const minute = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hour}:${minute}`;
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

    const startsAtUtc = parseUtcDate(body.startsAtUtc);
    const endsAtUtc = parseUtcDate(body.endsAtUtc);
    const eventDateUtc = parseUtcDate(body.eventDateUtc);

    if (body.startsAtUtc && !startsAtUtc) {
      return NextResponse.json({ error: 'Invalid start datetime' }, { status: 400 });
    }

    if (body.endsAtUtc && !endsAtUtc) {
      return NextResponse.json({ error: 'Invalid end datetime' }, { status: 400 });
    }

    if (body.eventDateUtc && !eventDateUtc) {
      return NextResponse.json({ error: 'Invalid event date' }, { status: 400 });
    }

    if (startsAtUtc && endsAtUtc && endsAtUtc <= startsAtUtc) {
      return NextResponse.json({ error: 'End datetime must be after start datetime' }, { status: 400 });
    }

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
      const existing = await tx.orbat.findUnique({
        where: { id: orbatId },
        select: {
          id: true,
          squads: {
            select: {
              id: true,
              slots: {
                select: {
                  id: true,
                  squadId: true,
                },
              },
            },
          },
        },
      });
      if (!existing) {
        throw new Error('ORBAT_NOT_FOUND');
      }

      const existingSquadIds = new Set(existing.squads.map((squad) => squad.id));
      const existingSlotMap = new Map(
        existing.squads
          .flatMap((squad) => squad.slots)
          .map((slot) => [slot.id, slot])
      );

      const invalidSquadId = body.squads.find(
        (squad) => typeof squad.id === 'number' && !existingSquadIds.has(squad.id)
      );
      if (invalidSquadId) {
        throw new Error('INVALID_SQUAD_ID');
      }

      const invalidSlotId = body.squads
        .flatMap((squad) => squad.slots)
        .find((slot) => typeof slot.id === 'number' && !existingSlotMap.has(slot.id));
      if (invalidSlotId) {
        throw new Error('INVALID_SLOT_ID');
      }

      await tx.orbat.update({
        where: { id: orbatId },
        data: {
          name: body.name.trim(),
          description: body.description?.trim() || null,
          eventDate: startsAtUtc || eventDateUtc || (body.eventDate ? new Date(`${body.eventDate}T00:00:00Z`) : null),
          startTime: formatUtcTime(startsAtUtc) || body.startTime || null,
          endTime: formatUtcTime(endsAtUtc) || body.endTime || null,
          startsAtUtc,
          endsAtUtc,
          timezone: body.timezone || null,
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

      const squadIdMap = new Map<number, number>();

      for (let index = 0; index < activeSquads.length; index += 1) {
        const squadInput = activeSquads[index];
        let persistedSquadId: number;

        if (typeof squadInput.id === 'number') {
          const updatedSquad = await tx.squad.update({
            where: { id: squadInput.id },
            data: {
              name: squadInput.name.trim(),
              orderIndex: squadInput.orderIndex,
            },
            select: { id: true },
          });
          persistedSquadId = updatedSquad.id;
        } else {
          const createdSquad = await tx.squad.create({
            data: {
              orbatId,
              name: squadInput.name.trim(),
              orderIndex: squadInput.orderIndex,
            },
            select: { id: true },
          });
          persistedSquadId = createdSquad.id;
        }

        squadIdMap.set(index, persistedSquadId);
      }

      const incomingSlotInputs = activeSquads.flatMap((squad, squadIndex) =>
        squad.slots
          .filter((slot) => !slot._deleted)
          .map((slot) => ({ slot, squadIndex }))
      );

      const desiredSlotPlacements = incomingSlotInputs.map(({ slot, squadIndex }) => {
        const persistedSquadId = squadIdMap.get(squadIndex);
        if (!persistedSquadId) {
          throw new Error('SQUAD_MAPPING_ERROR');
        }

        return {
          slot,
          persistedSquadId,
          placementKey: `${persistedSquadId}:${slot.orderIndex}`,
        };
      });

      const placementKeySet = new Set<string>();
      for (const placement of desiredSlotPlacements) {
        if (placementKeySet.has(placement.placementKey)) {
          throw new Error('DUPLICATE_SLOT_ORDER');
        }
        placementKeySet.add(placement.placementKey);
      }

      const retainedSlotIds = new Set(
        desiredSlotPlacements
          .map(({ slot }) => slot.id)
          .filter((slotId): slotId is number => typeof slotId === 'number')
      );

      if (retainedSlotIds.size !== desiredSlotPlacements.filter(({ slot }) => typeof slot.id === 'number').length) {
        throw new Error('DUPLICATE_SLOT_ID');
      }

      const slotsToDelete = Array.from(existingSlotMap.keys()).filter((slotId) => !retainedSlotIds.has(slotId));

      if (slotsToDelete.length > 0) {
        await tx.slot.deleteMany({ where: { id: { in: slotsToDelete } } });
      }

      const existingRetainedSlotIds = Array.from(retainedSlotIds);
      if (existingRetainedSlotIds.length > 0) {
        // Move retained slots out of the way first so final updates do not hit (squadId, orderIndex) uniqueness.
        await tx.slot.updateMany({
          where: { id: { in: existingRetainedSlotIds } },
          data: { orderIndex: { increment: 10000 } },
        });
      }

      for (const { slot, persistedSquadId } of desiredSlotPlacements) {
        if (typeof slot.id === 'number') {
          await tx.slot.update({
            where: { id: slot.id },
            data: {
              squadId: persistedSquadId,
              squadRoleId: slot.squadRoleId ?? null,
              orderIndex: slot.orderIndex,
              maxSignups: slot.maxSignups,
            },
          });
        }
      }

      for (const { slot, persistedSquadId } of desiredSlotPlacements) {
        if (typeof slot.id !== 'number') {
          await tx.slot.create({
            data: {
              orbatId,
              squadId: persistedSquadId,
              squadRoleId: slot.squadRoleId ?? null,
              orderIndex: slot.orderIndex,
              maxSignups: slot.maxSignups,
            },
          });
        }
      }

      const retainedSquadIds = new Set(
        activeSquads
          .map((squad) => squad.id)
          .filter((squadId): squadId is number => typeof squadId === 'number')
      );
      const squadsToDelete = Array.from(existingSquadIds).filter((squadId) => !retainedSquadIds.has(squadId));

      if (squadsToDelete.length > 0) {
        await tx.squad.deleteMany({ where: { id: { in: squadsToDelete } } });
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
          orderBy: { id: 'asc' },
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

    publishAdminCatalogEvent({
      type: 'orbat.changed',
      actorUserId: Number(session.user.id),
      payload: {
        action: 'updated',
        orbatId,
      },
    });

    return NextResponse.json(updatedOrbat);
  } catch (error) {
    if (error instanceof Error && error.message === 'ORBAT_NOT_FOUND') {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    if (error instanceof Error && error.message === 'INVALID_SQUAD_ID') {
      return NextResponse.json({ error: 'One or more squads are invalid for this ORBAT.' }, { status: 400 });
    }

    if (error instanceof Error && error.message === 'INVALID_SLOT_ID') {
      return NextResponse.json({ error: 'One or more roles are invalid for this ORBAT.' }, { status: 400 });
    }

    if (error instanceof Error && error.message === 'DUPLICATE_SLOT_ORDER') {
      return NextResponse.json({ error: 'Two or more roles in the same squad share the same order index.' }, { status: 400 });
    }

    if (error instanceof Error && error.message === 'DUPLICATE_SLOT_ID') {
      return NextResponse.json({ error: 'The same existing role cannot be submitted more than once in a single update.' }, { status: 400 });
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

    publishAdminCatalogEvent({
      type: 'orbat.changed',
      actorUserId: Number(session.user.id),
      payload: {
        action: 'deleted',
        orbatId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting OrbAT:', error);
    return NextResponse.json({ error: 'Failed to delete OrbAT' }, { status: 500 });
  }
}
