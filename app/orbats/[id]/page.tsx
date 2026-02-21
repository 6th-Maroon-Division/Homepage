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
      slots: {
        orderBy: { orderIndex: 'asc' },
        include: {
          subslots: {
            orderBy: { orderIndex: 'asc' },
            include: {
              subslotDefinition: {
                include: {
                  requiredTraining: {
                    select: { id: true, name: true },
                  },
                  requiredRank: {
                    select: { id: true, name: true, abbreviation: true },
                  },
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

  const allSubslots = orbat.slots.flatMap((slot) => slot.subslots);
  const requiredTrainingIds = Array.from(
    new Set(
      allSubslots.flatMap((subslot) =>
        subslot.requiredTrainingIds?.length
          ? subslot.requiredTrainingIds
          : subslot.requiredTrainingId
            ? [subslot.requiredTrainingId]
            : []
      )
    )
  );

  const requiredRankIds = Array.from(
    new Set(
      allSubslots.flatMap((subslot) =>
        subslot.requiredRankIds?.length
          ? subslot.requiredRankIds
          : subslot.requiredRankId
            ? [subslot.requiredRankId]
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
    slots: orbat.slots.map((slot) => ({
      id: slot.id,
      name: slot.name,
      orderIndex: slot.orderIndex,
      subslots: slot.subslots.map((sub) => {
        const subslotTrainingIds = sub.requiredTrainingIds?.length
          ? sub.requiredTrainingIds
          : sub.requiredTrainingId
            ? [sub.requiredTrainingId]
            : [];
        const subslotRankIds = sub.requiredRankIds?.length
          ? sub.requiredRankIds
          : sub.requiredRankId
            ? [sub.requiredRankId]
            : [];
        const subslotRequiredTrainings = subslotTrainingIds
          .map((id) => trainingMap.get(id))
          .filter((item): item is { id: number; name: string } => Boolean(item));
        const subslotRequiredRanks = subslotRankIds
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
