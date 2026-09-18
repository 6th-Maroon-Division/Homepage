import { prisma } from '@/lib/prisma';
const publicOrbatUserSelect = { id: true, username: true, userRank: { select: { currentRank: { select: { abbreviation: true, name: true } } } } } as const;

/** Shared public projection for API and server-rendered ORBAT pages. */
export async function getPublicOrbat(id: number) {
  const orbat = await prisma.orbat.findUnique({
    where: { id },
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
                  user: { select: publicOrbatUserSelect },
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
        select: { id: true, orbatId: true, userId: true, status: true, reason: true, lateMinutes: true, leaveEarlyMinutes: true, createdAt: true, updatedAt: true, user: { select: publicOrbatUserSelect } },
      },
    },
  });

  if (!orbat) return null;

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

  const fallbackEventDate = orbat.startsAtUtc ?? orbat.eventDate;
  const fallbackStartTime = orbat.startsAtUtc
    ? `${String(orbat.startsAtUtc.getUTCHours()).padStart(2, '0')}:${String(orbat.startsAtUtc.getUTCMinutes()).padStart(2, '0')}`
    : orbat.startTime;
  const fallbackEndTime = orbat.endsAtUtc
    ? `${String(orbat.endsAtUtc.getUTCHours()).padStart(2, '0')}:${String(orbat.endsAtUtc.getUTCMinutes()).padStart(2, '0')}`
    : orbat.endTime;

  const clientOrbat = {
    isSideOp: orbat.isSideOp,
    id: orbat.id,
    name: orbat.name,
    description: orbat.description,
    eventDate: fallbackEventDate ? fallbackEventDate.toISOString() : null,
    startTime: fallbackStartTime || null,
    endTime: fallbackEndTime || null,
    startsAtUtc: orbat.startsAtUtc ? orbat.startsAtUtc.toISOString() : null,
    endsAtUtc: orbat.endsAtUtc ? orbat.endsAtUtc.toISOString() : null,
    timezone: orbat.timezone || null,
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
        const requiredTrainingIds = orbat.isSideOp ? [] : (slot.squadRole?.requiredTrainingIds || []);
        const requiredRankIds = orbat.isSideOp ? [] : (slot.squadRole?.requiredRankIds || []);

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
    frequencies: orbat.frequencies.map(link => ({ ...link, radioFrequency: { ...link.radioFrequency, createdAt: link.radioFrequency.createdAt.toISOString() } })),
    attendanceNotes: orbat.attendanceNotes.map(note => ({ ...note, createdAt: note.createdAt.toISOString(), updatedAt: note.updatedAt.toISOString() })),
    tempFrequencies: orbat.tempFrequencies,
  };

  return clientOrbat;
}
