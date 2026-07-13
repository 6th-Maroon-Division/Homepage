// app/admin/orbats/[id]/edit/page.tsx
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect, notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import OrbatForm from '@/app/components/orbat/OrbatForm';
import { checkPermission } from '@/lib/auth-middleware';

interface EditOrbatPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditOrbatPage({ params }: EditOrbatPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has ORBAT edit permission
  const hasPermission =
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0 ||
    await checkPermission(session.user.id, 'orbat:edit');
  
  if (!hasPermission) {
    redirect('/admin');
  }

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
            },
          },
        },
      },
    },
  });

  if (!orbat) {
    notFound();
  }

  // Serialize for client component
  const initialData = {
    id: orbat.id,
    name: orbat.name,
    description: orbat.description || '',
    eventDate: orbat.startsAtUtc
      ? orbat.startsAtUtc.toISOString().slice(0, 10)
      : orbat.eventDate
        ? orbat.eventDate.toISOString().slice(0, 10)
        : '',
    eventDateUtc: orbat.startsAtUtc
      ? orbat.startsAtUtc.toISOString()
      : orbat.eventDate
        ? orbat.eventDate.toISOString()
        : null,
    startTime: orbat.startTime || '',
    endTime: orbat.endTime || '',
    startsAtUtc: orbat.startsAtUtc ? orbat.startsAtUtc.toISOString() : null,
    endsAtUtc: orbat.endsAtUtc ? orbat.endsAtUtc.toISOString() : null,
    timezone: orbat.timezone || null,
    // Faction fields
    bluforCountry: orbat.bluforCountry || '',
    bluforRelationship: orbat.bluforRelationship || '',
    opforCountry: orbat.opforCountry || '',
    opforRelationship: orbat.opforRelationship || '',
    indepCountry: orbat.indepCountry || '',
    indepRelationship: orbat.indepRelationship || '',
    // Extra Intel fields
    iedThreat: orbat.iedThreat || '',
    civilianRelationship: orbat.civilianRelationship || '',
    rulesOfEngagement: orbat.rulesOfEngagement || '',
    airspace: orbat.airspace || '',
    inGameTimezone: orbat.inGameTimezone || '',
    operationDay: orbat.operationDay || '',
    slots: orbat.squads.map((squad) => ({
      id: squad.id,
      name: squad.name,
      orderIndex: squad.orderIndex,
      subslots: squad.slots.map((slot) => ({
        id: slot.id,
        squadRoleId: slot.squadRoleId,
        name: slot.squadRole?.name || 'Unassigned Role',
        orderIndex: slot.orderIndex,
        maxSignups: slot.maxSignups ?? 1,
        requiredTrainingIds: slot.squadRole?.requiredTrainingIds || [],
        requiredRankIds: slot.squadRole?.requiredRankIds || [],
        requiredTrainingId: (slot.squadRole?.requiredTrainingIds || [])[0] ?? null,
        requiredRankId: (slot.squadRole?.requiredRankIds || [])[0] ?? null,
      })),
    })),
  };

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <OrbatForm mode="edit" initialData={initialData} />
      </div>
    </main>
  );
}
