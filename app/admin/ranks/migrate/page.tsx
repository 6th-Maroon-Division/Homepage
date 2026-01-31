// app/admin/ranks/migrate/page.tsx
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import RankMigrationWizard from '@/app/admin/components/ranks/RankMigrationWizard';

export default async function RankMigrationPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    redirect('/');
  }

  // Get current ranks for display
  const ranks = await prisma.rank.findMany({
    orderBy: { orderIndex: 'asc' },
  });

  // Get user count per rank
  const userCounts = await prisma.userRank.groupBy({
    by: ['currentRankId'],
    _count: true,
  });

  const ranksWithCounts = ranks.map((rank) => ({
    ...rank,
    userCount: userCounts.find((uc) => uc.currentRankId === rank.id)?._count || 0,
  }));

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold" style={{ color: 'var(--foreground)' }}>
            Rank System Migration
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Migrate or restructure the rank system with preview and rollback capabilities
          </p>
        </div>

        <RankMigrationWizard ranks={ranksWithCounts} />
      </div>
    </main>
  );
}
