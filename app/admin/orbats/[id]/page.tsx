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
                select: { name: true },
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
      slots: squad.slots.map((slot) => ({
        id: slot.id,
        name: slot.squadRole?.name || 'Unassigned Role',
        orderIndex: slot.orderIndex,
        maxSignups: slot.maxSignups ?? 9999,
        signups: slot.signups.map((signup) => ({
          id: signup.id,
          user: signup.user
            ? {
                id: signup.user.id,
                username: signup.user.username ?? 'Unknown',
                rankAbbreviation: signup.user.userRank?.currentRank?.abbreviation,
                rankName: signup.user.userRank?.currentRank?.name,
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
