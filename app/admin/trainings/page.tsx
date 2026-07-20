import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import TrainingManagementClient from '@/app/admin/components/trainings/TrainingManagementClient';
import { checkPermission } from '@/lib/auth-middleware';

export default async function AdminTrainingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; session?: string | string[] }>;
}) {
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

  const query = await searchParams;
  const rawSessionId = Array.isArray(query.session) ? query.session[0] : query.session;
  const parsedSessionId = Number(rawSessionId);
  const initialSessionId = Number.isInteger(parsedSessionId) && parsedSessionId > 0
    ? parsedSessionId
    : null;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const canManageSessions = hasSuperAdmin || canMarkTraining || canApproveTrainingRequests;
  const initialView = canManageSessions && (requestedTab === 'sessions' || initialSessionId)
    ? 'sessions' as const
    : 'trainings' as const;

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
        assignedTrainer: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
        sessionAttendee: {
          include: {
            session: {
              include: {
                trainer: {
                  select: {
                    id: true,
                    username: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            sender: {
              select: { id: true, username: true, avatarUrl: true },
            },
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
    assignedTrainer: request.assignedTrainer,
    session: request.sessionAttendee?.session
      ? {
          id: request.sessionAttendee.session.id,
          startsAt: request.sessionAttendee.session.startsAt?.toISOString() ?? null,
          endsAt: null,
          durationMinutes: request.sessionAttendee.session.durationMinutes,
          status: request.sessionAttendee.session.status,
          confirmedAt:
            request.sessionAttendee.session.status === 'proposed'
              ? null
              : request.sessionAttendee.session.updatedAt.toISOString(),
          instructions: request.sessionAttendee.session.specialInstructions,
          trainer: request.sessionAttendee.session.trainer,
        }
      : null,
    lastMessage: request.messages[0]
      ? {
          id: request.messages[0].id,
          content: request.messages[0].body,
          createdAt: request.messages[0].createdAt.toISOString(),
          senderId: request.messages[0].senderId,
          senderRole: request.messages[0].senderRole === 'SYSTEM'
            ? ('system' as const)
            : request.messages[0].senderRole === 'STAFF'
              ? ('staff' as const)
              : ('user' as const),
          sender: request.messages[0].sender,
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
          initialView={initialView}
          initialSessionId={initialSessionId}
        />
      </div>
    </main>
  );
}
