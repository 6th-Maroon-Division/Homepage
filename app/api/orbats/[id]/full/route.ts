// app/api/orbats/[id]/full/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orbatId = parseInt(id);

    if (isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid OrbAT ID' }, { status: 400 });
    }

    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
      include: {
        slots: {
          orderBy: { orderIndex: 'asc' },
          include: {
            subslots: {
              orderBy: { orderIndex: 'asc' },
              include: {
                subslotDefinition: {
                  select: {
                    requiredTrainingIds: true,
                    requiredRankIds: true,
                  },
                },
                signups: {
                  include: { user: true },
                },
              },
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

    if (!orbat) {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    const allSubslots = orbat.slots.flatMap((slot) => slot.subslots);
    const requiredTrainingIds = Array.from(
      new Set(
        allSubslots.flatMap((subslot) => {
          const ownIds = subslot.requiredTrainingIds?.length ? subslot.requiredTrainingIds : [];
          const definitionIds = subslot.subslotDefinition?.requiredTrainingIds || [];
          return [...ownIds, ...definitionIds];
        })
      )
    );

    const requiredRankIds = Array.from(
      new Set(
        allSubslots.flatMap((subslot) => {
          const ownIds = subslot.requiredRankIds?.length ? subslot.requiredRankIds : [];
          const definitionIds = subslot.subslotDefinition?.requiredRankIds || [];
          return [...ownIds, ...definitionIds];
        })
      )
    );

    const [requiredTrainings, requiredRanks] = await Promise.all([
      requiredTrainingIds.length
        ? prisma.training.findMany({
            where: { id: { in: requiredTrainingIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      requiredRankIds.length
        ? prisma.rank.findMany({
            where: { id: { in: requiredRankIds } },
            select: { id: true, name: true, abbreviation: true },
          })
        : Promise.resolve([]),
    ]);

    const trainingMap = new Map(requiredTrainings.map((training) => [training.id, training]));
    const rankMap = new Map(requiredRanks.map((rank) => [rank.id, rank]));

    // Serialize for client
    const clientOrbat = {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      eventDate: orbat.eventDate ? orbat.eventDate.toISOString() : null,
      startTime: orbat.startTime || null,
      endTime: orbat.endTime || null,
      slots: orbat.slots.map((slot) => ({
        id: slot.id,
        name: slot.name,
        orderIndex: slot.orderIndex,
        subslots: slot.subslots.map((sub) => {
          // Merge prerequisites from the subslot itself and its definition
          const definitionTrainingIds = sub.subslotDefinition?.requiredTrainingIds || [];
          const definitionRankIds = sub.subslotDefinition?.requiredRankIds || [];
          
          const combinedTrainingIds = Array.from(
            new Set([...(sub.requiredTrainingIds || []), ...definitionTrainingIds])
          );
          const combinedRankIds = Array.from(
            new Set([...(sub.requiredRankIds || []), ...definitionRankIds])
          );
          
          const subslotRequiredTrainings = combinedTrainingIds
            .map((id) => trainingMap.get(id))
            .filter((item): item is { id: number; name: string } => Boolean(item));
          const subslotRequiredRanks = combinedRankIds
            .map((id) => rankMap.get(id))
            .filter((item): item is { id: number; name: string; abbreviation: string } => Boolean(item));

          return {
          id: sub.id,
          name: sub.name,
          orderIndex: sub.orderIndex,
          maxSignups: sub.maxSignups,
          subslotDefinitionId: sub.subslotDefinitionId,
          requiredTrainings: subslotRequiredTrainings,
          requiredRanks: subslotRequiredRanks,
          requiredTraining: subslotRequiredTrainings[0] || null,
          requiredRank: subslotRequiredRanks[0] || null,
          signups: sub.signups.map((s) => ({
            id: s.id,
            user: s.user
              ? {
                  id: s.user.id,
                  username: s.user.username ?? 'Unknown',
                }
              : null,
          })),
        };
        }),
      })),
      frequencies: orbat.frequencies,
      tempFrequencies: orbat.tempFrequencies,
    };

    return NextResponse.json(clientOrbat);
  } catch (error) {
    console.error('Error fetching OrbAT:', error);
    return NextResponse.json({ error: 'Failed to fetch OrbAT' }, { status: 500 });
  }
}
