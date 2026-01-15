import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import TrainingManagementClient from '@/app/admin/components/trainings/TrainingManagementClient';

export default async function AdminTrainingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    redirect('/');
  }

  const [trainings, trainingRequests] = await Promise.all([
    prisma.training.findMany({
      include: {
        _count: {
          select: {
            userTrainings: true,
            trainingRequests: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.trainingRequest.findMany({
      include: {
        training: true,
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
        handledByAdmin: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    }),
  ]);

  // Serialize for client
  const serializedTrainings = trainings.map((training) => ({
    ...training,
    createdAt: training.createdAt.toISOString(),
    updatedAt: training.updatedAt.toISOString(),
  }));

  const serializedRequests = trainingRequests.map((request) => ({
    ...request,
    requestedAt: request.requestedAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    training: {
      ...request.training,
      createdAt: request.training.createdAt.toISOString(),
      updatedAt: request.training.updatedAt.toISOString(),
    },
    handledByAdmin: request.handledByAdmin
      ? {
          ...request.handledByAdmin,
        }
      : null,
  }));

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <TrainingManagementClient
          trainings={serializedTrainings}
          allRequests={serializedRequests}
        />
      </div>
    </main>
  );
}
