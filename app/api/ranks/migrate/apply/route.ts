// app/api/ranks/migrate/apply/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

type MigrationStrategy = 'recalculate' | 'grandfather' | 'map';

type RankMapping = {
  oldRankId: number;
  newRankId: number;
};

type ApplyResult = {
  totalProcessed: number;
  demoted: number;
  promoted: number;
  unchanged: number;
  errors: string[];
};

// POST - Apply migration
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

    const result: ApplyResult = {
      totalProcessed: 0,
      demoted: 0,
      promoted: 0,
      unchanged: 0,
      errors: [],
    };

    // Process each user in a transaction
    for (const userRank of usersWithRanks) {
      const currentRank = userRank.currentRank;
      if (!currentRank) {
        // Skip users without a current rank
        result.totalProcessed++;
        result.unchanged++;
        continue;
      }
      let newRank = currentRank;

      try {
        switch (strategy) {
          case 'recalculate': {
            // Recalculate based on attendance and rank requirements
            const eligibleRanks = allRanks.filter((rank) => {
              if (!rank.attendanceRequiredSinceLastRank) return true;
              return userRank.attendanceSinceLastRank >= rank.attendanceRequiredSinceLastRank;
            });

            if (eligibleRanks.length > 0) {
              newRank = eligibleRanks.reduce((highest, current) =>
                current.orderIndex > highest.orderIndex ? current : highest
              );
            }
            break;
          }

          case 'grandfather': {
            // Keep existing ranks - skip processing
            result.unchanged++;
            result.totalProcessed++;
            continue;
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
            result.errors.push(`Invalid strategy for user ${userRank.userId}`);
            continue;
        }

        // Only update if rank changed and newRank is valid
        if (!newRank) {
          result.unchanged++;
          result.totalProcessed++;
          continue;
        }

        if (newRank.id !== currentRank.id) {
          await prisma.$transaction(async (tx) => {
            // Update UserRank
            await tx.userRank.update({
              where: { userId: userRank.userId },
              data: {
                currentRankId: newRank.id,
                // Reset attendance counter on rank change
                attendanceSinceLastRank: 0,
                lastRankedUpAt: new Date(),
              },
            });

            // Create RankHistory entry
            await tx.rankHistory.create({
              data: {
                userId: userRank.userId,
                previousRankName: currentRank.name,
                newRankName: newRank.name,
                attendanceTotalAtChange: 0, // Unknown during migration
                attendanceDeltaSinceLastRank: userRank.attendanceSinceLastRank,
                triggeredBy: 'system_migration',
                triggeredByUserId: session.user.id,
                triggeredByDiscordId: null,
                outcome: 'approved',
                declineReason: null,
                note: `Migration: ${strategy} strategy applied`,
              },
            });
          });

          // Count change type
          if (newRank.orderIndex < currentRank.orderIndex) {
            result.demoted++;
          } else if (newRank.orderIndex > currentRank.orderIndex) {
            result.promoted++;
          }
        } else {
          result.unchanged++;
        }

        result.totalProcessed++;
      } catch (error) {
        console.error(`Failed to migrate user ${userRank.userId}:`, error);
        result.errors.push(
          `User ${userRank.user.username || userRank.userId}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Migration apply error:', error);
    return NextResponse.json({ error: 'Failed to apply migration' }, { status: 500 });
  }
}
