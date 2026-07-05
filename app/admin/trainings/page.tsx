import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import TrainingManagementClient from '@/app/admin/components/trainings/TrainingManagementClient';
import { checkPermission } from '@/lib/auth-middleware';

export default async function AdminTrainingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user has any training permission
  const [canCreateTraining, canEditTraining, canDeleteTraining, canMarkTraining, canApproveTrainingRequests] = await Promise.all([
    checkPermission(session.user.id, 'training:create'),
    checkPermission(session.user.id, 'training:edit'),
    checkPermission(session.user.id, 'training:delete'),
    checkPermission(session.user.id, 'training:mark'),
    checkPermission(session.user.id, 'training:approve_request'),
  ]);
  const hasSuperAdmin = (session.user.permissions?.['system:super_admin'] ?? 0) > 0;
  const hasPermission =
    hasSuperAdmin || canCreateTraining || canEditTraining || canDeleteTraining || canMarkTraining || canApproveTrainingRequests;
  
  if (!hasPermission) {
    redirect('/admin');
  }

  const [trainings, trainingRequests, ranks] = await Promise.all([
    prisma.training.findMany({
      include: {
        _count: {
          select: {
            userTrainings: true,
            trainingRequests: true,
          },
        },
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
    prisma.rank.findMany({
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        name: true,
        abbreviation: true,
        orderIndex: true,
      },
    }),
  ]);

  // Serialize for client
  const serializedTrainings = trainings.map((training) => ({
    ...training,
    createdAt: training.createdAt.toISOString(),
    updatedAt: training.updatedAt.toISOString(),
    minimumRank: training.rankRequirement?.minimumRank || null,
    requiredTrainings: training.requiresTrainings.map((r) => r.requiredTraining),
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
          ranks={ranks}
          trainings={serializedTrainings}
          allRequests={serializedRequests}
        />
      </div>
    </main>
  );
}
