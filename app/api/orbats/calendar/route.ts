import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { isTrainingStaff } from '@/lib/training-staff';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ? Number(session.user.id) : null;
    const staffViewer = userId ? await isTrainingStaff(userId) : false;
    const [orbats, trainingSessions] = await Promise.all([
      prisma.orbat.findMany({
        orderBy: [{ startsAtUtc: 'asc' }, { eventDate: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          startsAtUtc: true,
          eventDate: true,
          createdAt: true,
        },
      }),
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
                where: staffViewer ? undefined : { userId },
                select: { trainingRequestId: true },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const items = orbats.map((orbat) => {
      const date = orbat.startsAtUtc ?? orbat.eventDate ?? orbat.createdAt;
      return {
        id: orbat.id,
        kind: 'orbat' as const,
        name: orbat.name,
        description: orbat.description,
        eventDate: date.toISOString(),
        dateKey: date.toISOString().slice(0, 10),
        href: `/orbats/${orbat.id}`,
      };
    });

    const trainingItems = trainingSessions.map((trainingSession) => {
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
        eventDate: trainingSession.startsAt!.toISOString(),
        dateKey: trainingSession.startsAt!.toISOString().slice(0, 10),
        status: trainingSession.status,
        trainerName: trainingSession.trainer?.username ?? null,
        href: staffViewer
          ? `/admin/trainings?tab=sessions&session=${trainingSession.id}`
          : requestId ? `/trainings/requests/${requestId}` : '/profile?tab=trainings',
      };
    });
    return NextResponse.json([...items, ...trainingItems]);
  } catch (error) {
    console.error('Error fetching unified calendar feed:', error);
    return NextResponse.json({ error: 'Failed to fetch calendar feed' }, { status: 500 });
  }
}
