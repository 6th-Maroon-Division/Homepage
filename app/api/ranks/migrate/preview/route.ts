// app/api/ranks/migrate/preview/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

type MigrationStrategy = 'recalculate' | 'grandfather' | 'map';

type RankMapping = {
  oldRankId: number;
  newRankId: number;
};

type PreviewResult = {
  totalUsers: number;
  demoted: number;
  promoted: number;
  unchanged: number;
  changes: Array<{
    userId: number;
    username: string;
    currentRankName: string;
    newRankName: string;
    changeType: 'demotion' | 'promotion' | 'unchanged';
    attendanceSinceLastRank: number;
  }>;
};

// POST - Preview migration impact
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { strategy, rankMappings } = body as {
      strategy: MigrationStrategy;
      rankMappings?: RankMapping[];
    };

    if (!strategy) {
      return NextResponse.json({ error: 'Strategy is required' }, { status: 400 });
    }

    // Get all users with ranks
    const usersWithRanks = await prisma.userRank.findMany({
      include: {
        user: { select: { id: true, username: true } },
        currentRank: true,
      },
    });

    // Get all ranks ordered by orderIndex
    const allRanks = await prisma.rank.findMany({
      orderBy: { orderIndex: 'asc' },
    });

    const result: PreviewResult = {
      totalUsers: usersWithRanks.length,
      demoted: 0,
      promoted: 0,
      unchanged: 0,
      changes: [],
    };

    for (const userRank of usersWithRanks) {
      const currentRank = userRank.currentRank;
      if (!currentRank) {
        // Skip users without a current rank
        continue;
      }
      let newRank = currentRank;

      switch (strategy) {
        case 'recalculate': {
          // Recalculate based on attendance and rank requirements
          // Find the highest eligible rank based on attendance
          const eligibleRanks = allRanks.filter((rank) => {
            if (!rank.attendanceRequiredSinceLastRank) return true;
            return userRank.attendanceSinceLastRank >= rank.attendanceRequiredSinceLastRank;
          });

          if (eligibleRanks.length > 0) {
            // Find the highest eligible rank by orderIndex
            newRank = eligibleRanks.reduce((highest, current) =>
              current.orderIndex > highest.orderIndex ? current : highest
            );
          }
          break;
        }

        case 'grandfather': {
          // Keep existing ranks - no changes
          newRank = currentRank;
          break;
        }

        case 'map': {
          // Map old rank to new rank based on provided mappings
          if (!rankMappings || rankMappings.length === 0) {
            return NextResponse.json(
              { error: 'Rank mappings are required for map strategy' },
              { status: 400 }
            );
          }

          const mapping = rankMappings.find((m) => m.oldRankId === currentRank.id);
          if (mapping) {
            const mappedRank = allRanks.find((r) => r.id === mapping.newRankId);
            if (mappedRank) {
              newRank = mappedRank;
            }
          }
          break;
        }

        default:
          return NextResponse.json({ error: 'Invalid strategy' }, { status: 400 });
      }

      // Determine change type
      let changeType: 'demotion' | 'promotion' | 'unchanged' = 'unchanged';
      if (!newRank) {
        // Skip if no new rank determined
        continue;
      }
      if (newRank.orderIndex < currentRank.orderIndex) {
        changeType = 'demotion';
        result.demoted++;
      } else if (newRank.orderIndex > currentRank.orderIndex) {
        changeType = 'promotion';
        result.promoted++;
      } else {
        result.unchanged++;
      }

      result.changes.push({
        userId: userRank.userId,
        username: userRank.user.username || 'Unknown',
        currentRankName: currentRank.name,
        newRankName: newRank.name,
        changeType,
        attendanceSinceLastRank: userRank.attendanceSinceLastRank,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Migration preview error:', error);
    return NextResponse.json({ error: 'Failed to preview migration' }, { status: 500 });
  }
}
