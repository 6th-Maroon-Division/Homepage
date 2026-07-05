// app/admin/users/page.tsx
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import UserManagementClient from '../components/user/UserManagementClient';
import { checkPermission } from '@/lib/auth-middleware';

export default async function UsersManagementPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }
  
  // Check if user can manage users or trainings on user profiles
  const [canManageUsers, canMarkTrainings, canApproveTrainingRequests] = await Promise.all([
    checkPermission(session.user.id, 'user:manage'),
    checkPermission(session.user.id, 'training:mark'),
    checkPermission(session.user.id, 'training:approve_request'),
  ]);
  const hasPermission =
    (session.user.permissions?.['system:super_admin'] ?? 0) > 0 ||
    canManageUsers ||
    canMarkTrainings ||
    canApproveTrainingRequests;
  
  if (!hasPermission) {
    redirect('/admin');
  }

  const now = new Date();

  const users = await prisma.user.findMany({
    orderBy: [
      { createdAt: 'desc' },
    ],
    include: {
      accounts: true,
      userPermissions: {
        where: {
          value: { gt: 0 },
          permission: { key: 'system:super_admin' },
        },
        select: {
          id: true,
        },
      },
      userTrainings: {
        include: {
          training: true,
        },
      },
      leaveOfAbsences: {
        where: {
          cancelledAt: null,
          OR: [
            {
              startDate: { lte: now },
              OR: [
                { returnDate: null },
                { returnDate: { gte: now } },
              ],
            },
            { startDate: { gt: now } },
          ],
        },
        select: {
          id: true,
          startDate: true,
          returnDate: true,
        },
      },
      _count: {
        select: {
          signups: true,
          orbats: true,
          userTrainings: true,
        },
      },
    },
  });

  // Serialize for client
  const serializedUsers = users.map((user) => {
    const activeLoaEntries = user.leaveOfAbsences.filter((entry) =>
      entry.startDate <= now && (!entry.returnDate || entry.returnDate >= now)
    );

    const upcomingLoaEntries = user.leaveOfAbsences
      .filter((entry) => entry.startDate > now)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const activeLatestStart = activeLoaEntries
      .map((entry) => entry.startDate)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const activeLatestReturn = activeLoaEntries
      .map((entry) => entry.returnDate)
      .filter((date): date is Date => date instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

    const nextUpcoming = upcomingLoaEntries[0] ?? null;

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      avatarUrl: user.avatarUrl,
      isSuperAdmin: user.userPermissions.length > 0,
      createdAt: user.createdAt.toISOString(),
      providers: user.accounts.map((acc) => acc.provider),
      signupCount: user._count.signups,
      orbatCount: user._count.orbats,
      trainingCount: user._count.userTrainings,
      hasActiveLoa: activeLoaEntries.length > 0,
      activeLoaStartDate: activeLatestStart?.toISOString() ?? null,
      activeLoaUntil: activeLatestReturn?.toISOString() ?? null,
      hasUpcomingLoa: upcomingLoaEntries.length > 0,
      upcomingLoaStartDate: nextUpcoming?.startDate.toISOString() ?? null,
      upcomingLoaUntil: nextUpcoming?.returnDate?.toISOString() ?? null,
      trainings: user.userTrainings.map((ut) => ({
        id: ut.id,
        trainingId: ut.trainingId,
        trainingName: ut.training.name,
        needsRetraining: ut.needsRetraining,
        isHidden: ut.isHidden,
        notes: ut.notes,
        completedAt: ut.completedAt.toISOString(),
        assignedAt: ut.assignedAt.toISOString(),
      })),
    };
  });

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <UserManagementClient
          users={serializedUsers}
          currentUserId={session.user.id}
          initialTab="all"
        />
      </div>
    </main>
  );
}
