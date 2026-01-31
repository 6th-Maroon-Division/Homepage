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

  // Fetch all available trainings (active only) with requirements
  const allTrainings = await prisma.training.findMany({
    where: { isActive: true },
    include: {
      rankRequirement: {
        include: {
          minimumRank: {
            select: {
              id: true,
              name: true,
              abbreviation: true,
              orderIndex: true,
            },
          },
        },
      },
      requiresTrainings: {
        include: {
          requiredTraining: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  // Get user's rank
  const userRank = await prisma.userRank.findUnique({
    where: { userId },
    include: {
      currentRank: {
        select: {
          id: true,
          name: true,
          abbreviation: true,
          orderIndex: true,
        },
      },
    },
  });

  // Get user's completed trainings
  const completedTrainingIds = new Set(
    userTrainings.map((ut) => ut.trainingId)
  );

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

  const serializedAllTrainings = allTrainings.map((training) => {
    // Check if user meets requirements
    let meetsRankRequirement = true;
    let missingRank: { id: number; name: string; abbreviation: string } | null = null;
    
    if (training.rankRequirement?.minimumRank) {
      const minRank = training.rankRequirement.minimumRank;
      if (!userRank?.currentRank || userRank.currentRank.orderIndex < minRank.orderIndex) {
        meetsRankRequirement = false;
        missingRank = minRank;
      }
    }

    const missingTrainings = training.requiresTrainings
      .filter((req) => !completedTrainingIds.has(req.requiredTraining.id))
      .map((req) => req.requiredTraining);

    const canRequest = meetsRankRequirement && missingTrainings.length === 0;

    return {
      ...training,
      createdAt: training.createdAt.toISOString(),
      updatedAt: training.updatedAt.toISOString(),
      minimumRank: training.rankRequirement?.minimumRank || null,
      requiredTrainings: training.requiresTrainings.map((req) => req.requiredTraining),
      canRequest,
      missingRank,
      missingTrainings,
    };
  });

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
