// app/orbats/[id]/page.tsx
import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import OrbatDetailClient from '../components/OrbatDetailClient';

interface OrbatPageProps {
  params: Promise<{ id: string }>;
}

export default async function OrbatPage({ params }: OrbatPageProps) {
  const { id } = await params;
  const orbatId = Number(id);

  if (Number.isNaN(orbatId)) {
    notFound();
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
                            select: { abbreviation: true, name: true },
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
      createdBy: true,
    },
  });

  if (!orbat) {
    notFound();
  }

  const allSlots = orbat.squads.flatMap((squad) => squad.slots);
  const requiredTrainingIds = Array.from(
    new Set(
      allSlots.flatMap((slot) =>
        slot.squadRole?.requiredTrainingIds?.length
          ? slot.squadRole.requiredTrainingIds
          : []
      )
    )
  );

  const requiredRankIds = Array.from(
    new Set(
      allSlots.flatMap((slot) =>
        slot.squadRole?.requiredRankIds?.length
          ? slot.squadRole.requiredRankIds
          : []
      )
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

  // Serialize for client component
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
        const slotTrainingIds = slot.squadRole?.requiredTrainingIds || [];
        const slotRankIds = slot.squadRole?.requiredRankIds || [];
        const slotRequiredTrainings = slotTrainingIds
          .map((id) => trainingMap.get(id))
          .filter((item): item is { id: number; name: string } => Boolean(item));
        const slotRequiredRanks = slotRankIds
          .map((id) => rankMap.get(id))
          .filter((item): item is { id: number; name: string; abbreviation: string } => Boolean(item));

        return {
        id: slot.id,
        name: slot.squadRole?.name || 'Unassigned Role',
        orderIndex: slot.orderIndex,
        maxSignups: slot.maxSignups ?? 9999,
        squadRoleId: slot.squadRoleId,
        requiredTrainings: slotRequiredTrainings,
        requiredRanks: slotRequiredRanks,
        requiredTraining: slotRequiredTrainings[0] || null,
        requiredRank: slotRequiredRanks[0] || null,
        signups: slot.signups.map((s) => ({
          id: s.id,
          user: s.user
            ? {
                id: s.user.id,
                username: s.user.username ?? 'Unknown',
                rankAbbreviation: s.user.userRank?.currentRank?.abbreviation ?? null,
                rankName: s.user.userRank?.currentRank?.name ?? null,
              }
            : {
                id: null,
                username: 'Unknown',
                rankAbbreviation: null,
                rankName: null,
              },
        })),
      };
      }),
    })),
    frequencies: orbat.frequencies,
    tempFrequencies: orbat.tempFrequencies,
  };

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <OrbatDetailClient orbat={clientOrbat} />
      </div>
    </main>
  );
}
