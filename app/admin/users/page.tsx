// app/admin/users/page.tsx
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import UserManagementClient from '../components/user/UserManagementClient';

export default async function UsersManagementPage() {
  const session = await getServerSession(authOptions);

  if (!session || !session.user?.isAdmin) {
    redirect('/');
  }

  const users = await prisma.user.findMany({
    orderBy: [
      { isAdmin: 'desc' },
      { createdAt: 'desc' },
    ],
    include: {
      accounts: true,
      userTrainings: {
        include: {
          training: true,
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
  const serializedUsers = users.map((user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    avatarUrl: user.avatarUrl,
    isAdmin: user.isAdmin,
    createdAt: user.createdAt.toISOString(),
    providers: user.accounts.map((acc) => acc.provider),
    signupCount: user._count.signups,
    orbatCount: user._count.orbats,
    trainingCount: user._count.userTrainings,
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
  }));

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <UserManagementClient users={serializedUsers} currentUserId={session.user.id} />
      </div>
    </main>
  );
}
