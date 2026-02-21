// app/admin/orbats/[id]/page.tsx
import { prisma } from '@/lib/prisma';
import { notFound, redirect } from 'next/navigation';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import AdminOrbatView from '@/app/components/orbat/AdminOrbatView';
import { checkPermission } from '@/lib/auth-middleware';

interface AdminOrbatPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrbatPage({ params }: AdminOrbatPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has ORBAT edit permission (viewing admin-side requires edit)
  const hasPermission = session.user.isAdmin || await checkPermission(session.user.id, 'orbat:edit');
  
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
                        include: { currentRank: { select: { abbreviation: true, name: true } } },
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

  // Serialize for client component
  const clientOrbat = {
    id: orbat.id,
    name: orbat.name,
    description: orbat.description,
    eventDate: orbat.eventDate ? orbat.eventDate.toISOString() : null,
    startTime: orbat.startTime || null,
    endTime: orbat.endTime || null,
    // Faction fields
    bluforCountry: orbat.bluforCountry || null,
    bluforRelationship: orbat.bluforRelationship || null,
    opforCountry: orbat.opforCountry || null,
    opforRelationship: orbat.opforRelationship || null,
    indepCountry: orbat.indepCountry || null,
    indepRelationship: orbat.indepRelationship || null,
    // Extra Intel fields
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
        subslotDefinitionId: sub.subslotDefinitionId,
        requiredTraining: sub.subslotDefinition?.requiredTraining
          ? {
              id: sub.subslotDefinition.requiredTraining.id,
              name: sub.subslotDefinition.requiredTraining.name,
            }
          : null,
        requiredRank: sub.subslotDefinition?.requiredRank
          ? {
              id: sub.subslotDefinition.requiredRank.id,
              name: sub.subslotDefinition.requiredRank.name,
              abbreviation: sub.subslotDefinition.requiredRank.abbreviation,
            }
          : null,
        signups: sub.signups.map((s) => ({
          id: s.id,
          user: s.user
            ? {
                id: s.user.id,
                username: s.user.username ?? 'Unknown',
                rankAbbreviation: s.user.userRank?.currentRank?.abbreviation,
                rankName: s.user.userRank?.currentRank?.name,
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
        <AdminOrbatView orbat={clientOrbat} />
      </div>
    </main>
  );
}
