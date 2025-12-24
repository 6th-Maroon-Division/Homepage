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
      _count: {
        select: {
          signups: true,
          orbats: true,
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
  }));

  return (
    <main className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold">User Management</h1>
          <p className="text-sm sm:text-base" style={{ color: 'var(--muted-foreground)' }}>
            Manage user accounts, roles, and permissions
          </p>
        </header>

        <UserManagementClient users={serializedUsers} currentUserId={session.user.id} />
      </div>
    </main>
  );
}
