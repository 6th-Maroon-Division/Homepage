// app/orbats/page.tsx
import { prisma } from '@/lib/prisma';
import CalendarWithOps from './components/CalendarWithOps';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { isTrainingStaff } from '@/lib/training-staff';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OrbatWithDates = {
  id: number;
  name: string;
  description: string | null;
  startsAtUtc: Date | null;
  eventDate: Date | null;
  createdAt: Date;
};

export default async function OrbatsPage() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ? Number(session.user.id) : null;
  const staffViewer = userId ? await isTrainingStaff(userId) : false;
  const [orbats, trainingSessions] = await Promise.all([
    prisma.orbat.findMany({
      orderBy: [
        { startsAtUtc: 'asc' },
        { eventDate: 'asc' },
        { createdAt: 'asc' },
      ],
    }) as Promise<OrbatWithDates[]>,
    userId
      ? prisma.trainingSession.findMany({
          where: {
            ...(staffViewer
              ? {}
              : {
                  attendees: { some: { userId, status: { not: 'cancelled' } } },
                  status: { notIn: ['proposed', 'cancelled'] },
                }),
            startsAt: { not: null },
          },
          include: {
            training: { select: { name: true } },
            trainer: { select: { username: true } },
            attendees: {
              where: staffViewer ? undefined : { userId, status: { not: 'cancelled' } },
              select: { trainingRequestId: true },
            },
          },
          orderBy: { startsAt: 'asc' },
        })
      : Promise.resolve([]),
  ]);

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
      href: `/orbats/${orbat.id}`,
    };
  });

  const trainingItems = trainingSessions.map((trainingSession) => {
    const date = trainingSession.startsAt!;
    const dateKey = date.toISOString().slice(0, 10);
    const requestId = trainingSession.attendees.find((item) => item.trainingRequestId)?.trainingRequestId;
    return {
      id: trainingSession.id,
      kind: 'training_session' as const,
      name: `${trainingSession.training.name} Training`,
      description: [
        trainingSession.status.replaceAll('_', ' '),
        trainingSession.trainer?.username ? `Trainer: ${trainingSession.trainer.username}` : null,
        'Arma3 Training Server',
      ].filter(Boolean).join(' · '),
      eventDate: date.toISOString(),
      dateKey,
      status: trainingSession.status,
      trainerName: trainingSession.trainer?.username ?? null,
      href: staffViewer
        ? `/admin/trainings?tab=sessions&session=${trainingSession.id}`
        : requestId ? `/trainings/requests/${requestId}` : '/profile?tab=trainings',
    };
  });

  const now = new Date();
  const initialYear = now.getFullYear();
  const initialMonth = now.getMonth(); // 0-based

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <CalendarWithOps 
          initialYear={initialYear} 
          initialMonth={initialMonth} 
          ops={[...uiOps, ...trainingItems]}
          helpText="Operations and your scheduled training sessions share this calendar. Training sessions use the secondary colour."
        />
      </div>
    </main>
  );
}
