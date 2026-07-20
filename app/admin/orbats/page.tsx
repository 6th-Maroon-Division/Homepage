import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import CalendarWithOps from '@/app/orbats/components/CalendarWithOps';
import OrbatManagementClient from '@/app/admin/components/orbat/OrbatManagementClient';
import { checkPermission } from '@/lib/auth-middleware';

export default async function AdminOrbatsPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.id) {
    redirect('/');
  }

  const hasPermission =
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0 ||
    await checkPermission(session.user.id, 'orbat:edit');

  if (!hasPermission) {
    redirect('/');
  }

  const [orbats, trainingSessions] = await Promise.all([prisma.orbat.findMany({
    include: {
      createdBy: {
        select: {
          id: true,
          username: true,
        },
      },
      squads: {
        include: {
          slots: {
            include: {
              signups: true,
            },
          },
        },
      },
    },
    orderBy: [
      { startsAtUtc: 'asc' },
      { eventDate: 'asc' },
      { createdAt: 'asc' },
    ],
  }), prisma.trainingSession.findMany({
    where: { startsAt: { not: null } },
    include: {
      training: { select: { name: true } },
      trainer: { select: { username: true } },
    },
    orderBy: { startsAt: 'asc' },
  })]);

  // For calendar view
  const uiOps = orbats.map((orbat) => {
    const date = orbat.startsAtUtc ?? orbat.eventDate ?? orbat.createdAt;
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    const dateKey = `${year}-${month}-${day}`;

    return {
      id: orbat.id,
      kind: 'orbat' as const,
      name: orbat.name,
      description: orbat.description,
      eventDate: date.toISOString(),
      dateKey,
      href: `/admin/orbats/${orbat.id}`,
    };
  });

  const trainingItems = trainingSessions.map((trainingSession) => ({
    id: trainingSession.id,
    kind: 'training_session' as const,
    name: `${trainingSession.training.name} Training`,
    description: [
      trainingSession.status.replaceAll('_', ' '),
      trainingSession.trainer?.username ? `Trainer: ${trainingSession.trainer.username}` : null,
      'Arma3 Training Server',
    ].filter(Boolean).join(' · '),
    eventDate: trainingSession.startsAt!.toISOString(),
    dateKey: trainingSession.startsAt!.toISOString().slice(0, 10),
    status: trainingSession.status,
    trainerName: trainingSession.trainer?.username ?? null,
    href: `/admin/trainings?tab=sessions&session=${trainingSession.id}`,
  }));

  // For table view
  const orbatsWithCounts = orbats.map((orbat) => {
    const totalSubslots = orbat.squads.reduce((acc: number, squad) => acc + squad.slots.length, 0);
    const totalSignups = orbat.squads.reduce(
      (acc: number, squad) => acc + squad.slots.reduce((slotAcc: number, slot) => slotAcc + slot.signups.length, 0),
      0
    );
    
    return {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      eventDate: orbat.eventDate ? orbat.eventDate.toISOString() : null,
      startTime: orbat.startTime || null,
      endTime: orbat.endTime || null,
      createdAt: orbat.createdAt.toISOString(),
      createdBy: {
        id: orbat.createdBy.id,
        username: orbat.createdBy.username || 'Unknown',
      },
      slotCount: orbat.squads.length,
      totalSubslots,
      totalSignups,
    };
  });

  const now = new Date();
  const initialYear = now.getFullYear();
  const initialMonth = now.getMonth(); // 0-based

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Table View with Filters */}
        <OrbatManagementClient orbats={orbatsWithCounts} />

        {/* Calendar View */}
        <div className="pt-6" style={{ borderTop: '1px solid var(--border)' }}>
          <CalendarWithOps 
            initialYear={initialYear} 
            initialMonth={initialMonth} 
            ops={[...uiOps, ...trainingItems]}
            isAdmin={true}
            helpText="Operations and all training sessions share this calendar. Click an empty day to create an operation."
          />
        </div>
      </div>
    </main>
  );
}
