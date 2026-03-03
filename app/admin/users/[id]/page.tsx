import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import UserDetailClient from './UserDetailClient';

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

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/');
  }

  const [canManageUsers, canManagePermissions, canMarkTrainings] = await Promise.all([
    checkPermission(session.user.id, 'user:manage'),
    checkPermission(session.user.id, 'user:manage_permissions'),
    checkPermission(session.user.id, 'training:mark'),
  ]);

  const hasSuperAdmin = (session.user.permissions?.['system:super_admin'] ?? 0) > 0;
  const canAccessPage = hasSuperAdmin || canManageUsers || canManagePermissions || canMarkTrainings;

  if (!canAccessPage) {
    redirect('/admin');
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    notFound();
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      accounts: true,
      userRank: {
        include: {
          currentRank: true,
        },
      },
      userTrainings: {
        include: {
          training: true,
          trainer: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: { completedAt: 'desc' },
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

  if (!targetUser) {
    notFound();
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(now.getDate() - 90);

  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [
    totalCount,
    count30d,
    count90d,
    recentAttendance,
    trendRecords,
    allPermissions,
    assignedPermissions,
  ] =
    await Promise.all([
      prisma.attendance.count({ where: { userId } }),
      prisma.attendance.count({ where: { userId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.attendance.count({ where: { userId, createdAt: { gte: ninetyDaysAgo } } }),
      prisma.attendance.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: {
          orbat: {
            select: {
              name: true,
              eventDate: true,
            },
          },
        },
      }),
      prisma.attendance.findMany({
        where: { userId, createdAt: { gte: sixMonthsAgo } },
        select: { createdAt: true },
      }),
      prisma.permission.findMany({
        orderBy: { key: 'asc' },
        select: {
          id: true,
          key: true,
          description: true,
          maxValue: true,
        },
      }),
      prisma.userPermission.findMany({
        where: { userId, value: { gt: 0 } },
        include: { permission: true },
        orderBy: { permissionId: 'asc' },
      }),
    ]);

  const userData = {
    id: targetUser.id,
    username: targetUser.username,
    email: targetUser.email,
    avatarUrl: targetUser.avatarUrl,
    createdAt: targetUser.createdAt.toISOString(),
    providers: targetUser.accounts.map((account) => account.provider),
    signupCount: targetUser._count.signups,
    orbatCount: targetUser._count.orbats,
    trainingCount: targetUser._count.userTrainings,
    currentRank: targetUser.userRank?.currentRank?.name ?? null,
    attendanceSinceLastRank: targetUser.userRank?.attendanceSinceLastRank ?? 0,
    trainings: targetUser.userTrainings.map((ut) => ({
      id: ut.id,
      trainingId: ut.trainingId,
      trainingName: ut.training.name,
      completedAt: ut.completedAt.toISOString(),
      needsRetraining: ut.needsRetraining,
      isHidden: ut.isHidden,
      notes: ut.notes,
      trainerId: ut.trainerId,
      trainerUsername: ut.trainer?.username ?? null,
    })),
  };

  const attendanceData = {
    totalCount,
    lastAttendanceDate: recentAttendance[0]?.createdAt.toISOString() ?? null,
    count30d,
    count90d,
    trend: buildLastSixMonthsTrend(trendRecords.map((record) => record.createdAt)),
    recent: recentAttendance.map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      status: entry.status,
      orbatName: entry.orbat.name,
      orbatDate: (entry.orbat.eventDate ?? entry.createdAt).toISOString(),
    })),
  };

  const assignedPermissionMap = new Map(assignedPermissions.map((entry) => [entry.permissionId, entry.value]));

  const permissions = allPermissions.map((permission) => ({
    id: permission.id,
    key: permission.key,
    description: permission.description ?? '',
    currentValue: assignedPermissionMap.get(permission.id) ?? 0,
    maxValue: permission.maxValue,
  }));

  const canViewTrainings = hasSuperAdmin || canManageUsers || canMarkTrainings;
  const canViewPermissions = hasSuperAdmin || canManagePermissions;
  const canEditPermissions = canManagePermissions;
  const canViewActions = hasSuperAdmin || canManageUsers;

  const availableTrainings = canMarkTrainings
    ? await prisma.training.findMany({
        where: {
          isActive: true,
          userTrainings: {
            none: {
              userId,
            },
          },
        },
        orderBy: { name: 'asc' },
        take: 12,
        select: {
          id: true,
          name: true,
          categoryId: true,
          duration: true,
        },
      })
    : [];

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <Link
          href="/admin/users"
          className="text-sm"
          style={{ color: 'var(--primary)' }}
        >
          ← Back to users
        </Link>

        <UserDetailClient
          user={userData}
          attendance={attendanceData}
          permissions={permissions}
          availableTrainings={availableTrainings}
          canViewTrainings={canViewTrainings}
          canAssignTrainings={canMarkTrainings}
          canViewPermissions={canViewPermissions}
          canEditPermissions={canEditPermissions}
          canViewActions={canViewActions}
          isSelfUser={session.user.id === targetUser.id}
        />
      </div>
    </main>
  );
}
