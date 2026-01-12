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
      createdBy: true,
    },
  });

  if (!orbat) {
    notFound();
  }

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
      subslots: slot.subslots.map((sub) => ({
        id: sub.id,
        name: sub.name,
        orderIndex: sub.orderIndex,
        maxSignups: sub.maxSignups,
        signups: sub.signups.map((s) => ({
          id: s.id,
          user: s.user
            ? {
                id: s.user.id,
                username: s.user.username ?? 'Unknown',
              }
            : {
                id: null,
                username: 'Unknown',
              },
        })),
      })),
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
