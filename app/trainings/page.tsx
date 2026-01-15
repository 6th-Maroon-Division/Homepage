import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import UserTrainingsClient from './components/UserTrainingsClient';

// Disable caching for this page to always get fresh data
export const dynamic = 'force-dynamic';

export default async function TrainingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/');
  }

  const userId = session.user.id;

  // Fetch user's trainings (non-hidden only)
  const userTrainings = await prisma.userTraining.findMany({
    where: {
      userId,
      isHidden: false,
    },
    include: {
      training: true,
    },
    orderBy: { assignedAt: 'desc' },
  });

  // Fetch user's training requests
  const trainingRequests = await prisma.trainingRequest.findMany({
    where: { userId },
    include: {
      training: true,
    },
    orderBy: { requestedAt: 'desc' },
  });

  // Fetch all available trainings (active only)
  const allTrainings = await prisma.training.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  // Serialize dates
  const serializedUserTrainings = userTrainings.map((ut) => ({
    ...ut,
    completedAt: ut.completedAt.toISOString(),
    assignedAt: ut.assignedAt.toISOString(),
    training: {
      ...ut.training,
      createdAt: ut.training.createdAt.toISOString(),
      updatedAt: ut.training.updatedAt.toISOString(),
    },
  }));

  const serializedRequests = trainingRequests.map((tr) => ({
    ...tr,
    requestedAt: tr.requestedAt.toISOString(),
    updatedAt: tr.updatedAt.toISOString(),
    training: {
      ...tr.training,
      createdAt: tr.training.createdAt.toISOString(),
      updatedAt: tr.training.updatedAt.toISOString(),
    },
  }));

  const serializedAllTrainings = allTrainings.map((training) => ({
    ...training,
    createdAt: training.createdAt.toISOString(),
    updatedAt: training.updatedAt.toISOString(),
  }));

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <UserTrainingsClient
          currentUserId={userId}
          userTrainings={serializedUserTrainings}
          trainingRequests={serializedRequests}
          allTrainings={serializedAllTrainings}
        />
      </div>
    </main>
  );
}
