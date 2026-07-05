import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
              include: {
                squadRole: {
                  select: {
                    id: true,
                    name: true,
                    requiredTrainingIds: true,
                    requiredRankIds: true,
                  },
                },
                signups: {
                  include: {
                    user: {
                      include: {
                        userRank: {
                          include: {
                            currentRank: {
                              select: {
                                abbreviation: true,
                                name: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        frequencies: {
          orderBy: { id: 'asc' },
          include: {
            radioFrequency: true,
          },
        },
        attendanceNotes: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: {
              include: {
                userRank: {
                  include: {
                    currentRank: {
                      select: {
                        abbreviation: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!orbat) {
      return NextResponse.json({ error: 'OrbAT not found' }, { status: 404 });
    }

    const allTrainingIds = Array.from(
      new Set(
        orbat.squads.flatMap((squad) =>
          squad.slots.flatMap((slot) => slot.squadRole?.requiredTrainingIds || [])
        )
      )
    );
    const allRankIds = Array.from(
      new Set(
        orbat.squads.flatMap((squad) =>
          squad.slots.flatMap((slot) => slot.squadRole?.requiredRankIds || [])
        )
      )
    );

    const [requiredTrainings, requiredRanks] = await Promise.all([
      allTrainingIds.length
        ? prisma.training.findMany({
            where: { id: { in: allTrainingIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      allRankIds.length
        ? prisma.rank.findMany({
            where: { id: { in: allRankIds } },
            select: { id: true, name: true, abbreviation: true },
          })
        : Promise.resolve([]),
    ]);

    const trainingMap = new Map(requiredTrainings.map((training) => [training.id, training]));
    const rankMap = new Map(requiredRanks.map((rank) => [rank.id, rank]));

    const clientOrbat = {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      eventDate: orbat.eventDate ? orbat.eventDate.toISOString() : null,
      startTime: orbat.startTime || null,
      endTime: orbat.endTime || null,
      bluforCountry: orbat.bluforCountry || null,
      bluforRelationship: orbat.bluforRelationship || null,
      opforCountry: orbat.opforCountry || null,
      opforRelationship: orbat.opforRelationship || null,
      indepCountry: orbat.indepCountry || null,
      indepRelationship: orbat.indepRelationship || null,
      iedThreat: orbat.iedThreat || null,
      civilianRelationship: orbat.civilianRelationship || null,
      rulesOfEngagement: orbat.rulesOfEngagement || null,
      airspace: orbat.airspace || null,
      inGameTimezone: orbat.inGameTimezone || null,
      operationDay: orbat.operationDay || null,
      squads: orbat.squads.map((squad) => ({
        id: squad.id,
        name: squad.name,
        orderIndex: squad.orderIndex,
        slots: squad.slots.map((slot) => {
          const requiredTrainingIds = slot.squadRole?.requiredTrainingIds || [];
          const requiredRankIds = slot.squadRole?.requiredRankIds || [];

          const subslotRequiredTrainings = requiredTrainingIds
            .map((trainingId) => trainingMap.get(trainingId))
            .filter((item): item is { id: number; name: string } => Boolean(item));

          const subslotRequiredRanks = requiredRankIds
            .map((rankId) => rankMap.get(rankId))
            .filter((item): item is { id: number; name: string; abbreviation: string } => Boolean(item));

          return {
            id: slot.id,
            name: slot.squadRole?.name || 'Unassigned Role',
            orderIndex: slot.orderIndex,
            maxSignups: slot.maxSignups ?? 9999,
            squadRoleId: slot.squadRoleId,
            requiredTrainings: subslotRequiredTrainings,
            requiredRanks: subslotRequiredRanks,
            requiredTraining: subslotRequiredTrainings[0] || null,
            requiredRank: subslotRequiredRanks[0] || null,
            signups: slot.signups.map((signup) => ({
              id: signup.id,
              user: signup.user
                ? {
                    id: signup.user.id,
                    username: signup.user.username ?? 'Unknown',
                    rankAbbreviation: signup.user.userRank?.currentRank?.abbreviation ?? null,
                    rankName: signup.user.userRank?.currentRank?.name ?? null,
                  }
                : null,
            })),
          };
        }),
      })),
      frequencies: orbat.frequencies,
      attendanceNotes: orbat.attendanceNotes,
      tempFrequencies: orbat.tempFrequencies,
    };

    return NextResponse.json(clientOrbat);
  } catch (error) {
    console.error('Error fetching OrbAT:', error);
    return NextResponse.json({ error: 'Failed to fetch OrbAT' }, { status: 500 });
  }
}
