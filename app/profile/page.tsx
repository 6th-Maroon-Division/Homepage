import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getTotalAttendanceWithLegacy, getRecentAttendanceWithLegacy, getSixMonthTrendWithLegacy } from '@/lib/attendance-stats';
import UserSelfDetailClient from '@/app/settings/UserSelfDetailClient';
import { canRetryFailedTraining } from '@/lib/training-retry';

function formatMonth(date: Date): string {
  return date.toLocaleString('en-GB', { month: 'short' });
}

function buildLastSixMonthsTrend(dates: Date[]) {
  const now = new Date();
  const months: Array<{ key: string; label: string; count: number }> = [];

  for (let i = 5; i >= 0; i -= 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${monthDate.getFullYear()}-${monthDate.getMonth()}`;
    months.push({ key, label: formatMonth(monthDate), count: 0 });
  }

  const indexMap = new Map(months.map((m) => [m.key, m]));
  for (const date of dates) {
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const item = indexMap.get(key);
    if (item) item.count += 1;
  }

  return months.map((m) => ({ month: m.label, count: m.count }));
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }

  const query = await searchParams;
  const requestedTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;

  const userId = session.user.id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      accounts: true,
      userRank: {
        include: {
          currentRank: true,
        },
      },
      userTrainings: {
        where: { isHidden: false },
        include: {
          training: {
            include: {
              category: {
                select: {
                  name: true,
                },
              },
            },
          },
          trainer: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: { statusUpdatedAt: 'desc' },
      },
      _count: {
        select: {
          signups: true,
          orbats: true,
          userTrainings: {
            where: { isHidden: false },
          },
        },
      },
    },
  });

  if (!user) {
    redirect('/');
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(now.getDate() - 90);

  // (sixMonthsAgo no longer needed; trend dates are provided by getSixMonthTrendWithLegacy)

  const [totalCount, count30d, count90d, recentAttendance, trendRecords] = await Promise.all([
    getTotalAttendanceWithLegacy(userId), // Total including legacy data
    prisma.attendance.count({ where: { userId, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.attendance.count({ where: { userId, createdAt: { gte: ninetyDaysAgo } } }),
    getRecentAttendanceWithLegacy(userId, 15), // Recent attendance including legacy
    getSixMonthTrendWithLegacy(userId), // 6-month trend (legacy excluded)
  ]);

  const [trainingRequests, allTrainings, loaEntries] = await Promise.all([
    prisma.trainingRequest.findMany({
      where: { userId },
      include: {
        training: true,
        assignedTrainer: {
          select: { id: true, username: true },
        },
        sessionAttendee: {
          include: {
            session: {
              include: {
                trainer: {
                  select: { id: true, username: true },
                },
              },
            },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
    }),
    prisma.training.findMany({
      where: { isActive: true },
      include: {
        category: {
          select: {
            name: true,
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
    prisma.leaveOfAbsence.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const completedTrainingIds = new Set(
    user.userTrainings
      .filter((userTraining) =>
        userTraining.status === 'qualified'
        || (userTraining.status === 'finished' && !userTraining.training.requiresOrbatQualification)
      )
      .map((userTraining) => userTraining.trainingId)
  );
  const nonRetryableTrainingIds = new Set(
    user.userTrainings
      .filter((userTraining) => (
        userTraining.status !== 'failed'
        || !canRetryFailedTraining(userTraining.failedAt, userTraining.statusUpdatedAt, now)
      ))
      .map((userTraining) => userTraining.trainingId),
  );
  const activeRequestTrainingIds = new Set(
    trainingRequests
      .filter((request) => ['pending', 'approved', 'in_training', 'needs_qualify'].includes(request.status))
      .map((request) => request.trainingId)
  );

  const availableTrainings = allTrainings
    .filter((training) => !nonRetryableTrainingIds.has(training.id))
    .map((training) => {
      let meetsRankRequirement = true;
      let missingRank: { id: number; name: string; abbreviation: string } | null = null;

      if (training.rankRequirement?.minimumRank) {
        const minRank = training.rankRequirement.minimumRank;
        if (!user.userRank?.currentRank || user.userRank.currentRank.orderIndex < minRank.orderIndex) {
          meetsRankRequirement = false;
          missingRank = minRank;
        }
      }

      const missingTrainings = training.requiresTrainings
        .filter((requirement) => !completedTrainingIds.has(requirement.requiredTraining.id))
        .map((requirement) => requirement.requiredTraining);

      return {
        id: training.id,
        name: training.name,
        description: training.description,
        duration: training.duration,
        categoryName: training.category?.name ?? null,
        requiresTrainingSession: training.requiresTrainingSession,
        requiresOrbatQualification: training.requiresOrbatQualification,
        qualificationNotes: training.orbatQualificationNotes,
        canRequest: meetsRankRequirement && missingTrainings.length === 0 && !activeRequestTrainingIds.has(training.id),
        missingRank,
        missingTrainings,
      };
    });

  const serializedRequests = trainingRequests.map((request) => {
    const session = request.sessionAttendee?.session ?? null;
    const isConfirmed = Boolean(session && ['scheduled', 'in_progress', 'completed'].includes(session.status));
    const trainer = session?.trainer ?? request.assignedTrainer;

    return {
      id: request.id,
      trainingId: request.trainingId,
      trainingName: request.training.name,
      status: request.status,
      requestMessage: request.requestMessage,
      adminResponse: request.adminResponse,
      requestedAt: request.requestedAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      session: isConfirmed && session
        ? {
            id: session.id,
            startsAt: session.startsAt?.toISOString() ?? null,
            endsAt: null,
            durationMinutes: session.durationMinutes,
            status: session.status,
            confirmedAt: session.status === 'proposed' ? null : session.updatedAt.toISOString(),
            instructions: session.specialInstructions,
            trainer: trainer
              ? { id: trainer.id, username: trainer.username, avatarUrl: null }
              : null,
          }
        : null,
    };
  });

  const serializedLoaEntries = loaEntries.map((entry) => ({
    id: entry.id,
    startDate: entry.startDate.toISOString(),
    returnDate: entry.returnDate ? entry.returnDate.toISOString() : null,
    cancelledAt: entry.cancelledAt ? entry.cancelledAt.toISOString() : null,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }));

  const confirmedTrainerByTrainingId = new Map<
    number,
    { id: number; username: string | null }
  >();
  for (const request of trainingRequests) {
    const sessionItem = request.sessionAttendee?.session;
    if (
      sessionItem?.trainer
      && request.sessionAttendee?.status !== 'cancelled'
      && ['scheduled', 'in_progress', 'completed'].includes(sessionItem.status)
      && !confirmedTrainerByTrainingId.has(request.trainingId)
    ) {
      confirmedTrainerByTrainingId.set(request.trainingId, sessionItem.trainer);
    }
  }

  const userData = {
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt.toISOString(),
    providers: user.accounts.map((account) => account.provider),
    signupCount: user._count.signups,
    orbatCount: user._count.orbats,
    trainingCount: user._count.userTrainings,
    currentRank: user.userRank?.currentRank?.name ?? null,
    attendanceSinceLastRank: user.userRank?.attendanceSinceLastRank ?? 0,
    trainings: user.userTrainings.map((ut) => {
      const confirmedTrainer = confirmedTrainerByTrainingId.get(ut.trainingId) ?? null;
      const visibleTrainer = confirmedTrainer
        ?? (['finished', 'needs_qualify', 'qualified', 'failed'].includes(ut.status) ? ut.trainer : null);
      return {
      id: ut.id,
      trainingId: ut.trainingId,
      trainingName: ut.training.name,
      trainingDescription: ut.training.description,
      trainingDuration: ut.training.duration,
      trainingCategoryName: ut.training.category?.name ?? null,
      requiresTrainingSession: ut.training.requiresTrainingSession,
      requiresOrbatQualification: ut.training.requiresOrbatQualification,
      qualificationNotes: ut.training.orbatQualificationNotes,
      completedAt: ut.completedAt.toISOString(),
      needsRetraining: ut.needsRetraining,
      status: ut.status,
      trainingSessionCompletedAt: ut.trainingSessionCompletedAt?.toISOString() ?? null,
      orbatQualifiedAt: ut.orbatQualifiedAt?.toISOString() ?? null,
      failedAt: ut.failedAt?.toISOString() ?? null,
      isHidden: ut.isHidden,
      notes: ut.notes,
      trainerId: visibleTrainer?.id ?? null,
      trainerUsername: visibleTrainer?.username ?? null,
    };
    }),
  };

  const attendanceData = {
    totalCount,
    lastAttendanceDate: recentAttendance[0]?.createdAt.toISOString() ?? null,
    count30d,
    count90d,
    trend: buildLastSixMonthsTrend(trendRecords),
    recent: recentAttendance.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      status: entry.status,
      orbatName: entry.orbatName || 'Legacy Attendance',
      orbatDate: (entry.orbatDate instanceof Date ? entry.orbatDate : new Date(entry.orbatDate ?? entry.createdAt)).toISOString(),
      isLegacy: entry.isLegacy || false,
    })),
  };

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <UserSelfDetailClient
          user={userData}
          attendance={attendanceData}
          availableTrainings={availableTrainings}
          initialTab={requestedTab === 'trainings' ? 'trainings' : 'overview'}
          preferInitialTab={requestedTab === 'trainings'}
          trainingRequests={serializedRequests}
          loaEntries={serializedLoaEntries}
        />
      </div>
    </main>
  );
}
