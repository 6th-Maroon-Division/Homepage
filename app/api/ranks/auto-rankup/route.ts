import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

type PromotionResult = {
  userId: number;
  username: string | null;
  oldRank?: string;
  newRank?: string;
  reason?: string;
};

// POST /api/ranks/auto-rankup - Automatically promote all eligible users
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Get all users with ranks and current rank details
    const usersWithRanks = await prisma.userRank.findMany({
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        currentRank: {
          select: {
            id: true,
            name: true,
            abbreviation: true,
            orderIndex: true,
          },
        },
      },
    });

    const results = {
      promoted: [] as PromotionResult[],
      failed: [] as PromotionResult[],
    };

    for (const userRank of usersWithRanks) {
      try {
        if (userRank.retired) continue;
        if (!userRank.interviewDone) continue;

        const currentRank = userRank.currentRank;
        if (!currentRank) {
          results.failed.push({
            userId: userRank.userId,
            username: userRank.user.username,
            reason: 'No current rank assigned',
          });
          continue;
        }

        // Get next rank
        const nextRank = await prisma.rank.findFirst({
          where: {
            orderIndex: { gt: currentRank.orderIndex },
          },
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            name: true,
            abbreviation: true,
            attendanceRequiredSinceLastRank: true,
          },
        });

        if (!nextRank) {
          // User is already at max rank
          continue;
        }

        if (!nextRank.attendanceRequiredSinceLastRank) {
          results.failed.push({
            userId: userRank.userId,
            username: userRank.user.username,
            reason: 'Next rank has no attendance requirement configured',
          });
          continue;
        }

        // For now, skip training requirement check
        // This will be checked through rank transition requirements when the schema is ready

        // Check attendance requirement
        const attendance = await prisma.attendance.count({
          where: {
            userId: userRank.userId,
            status: 'present',
            orbat: { isMainOp: true },
          },
        });

        const attendanceSinceLastRank = userRank.attendanceSinceLastRank;
        const attendanceDelta = attendance - attendanceSinceLastRank;

        if (attendanceDelta < nextRank.attendanceRequiredSinceLastRank) {
          results.failed.push({
            userId: userRank.userId,
            username: userRank.user.username,
            reason: `Need ${nextRank.attendanceRequiredSinceLastRank - attendanceDelta} more attendance ops`,
          });
          continue;
        }

        // Promote user
        await prisma.$transaction(async (tx) => {
          // Update user rank
          await tx.userRank.update({
            where: { userId: userRank.userId },
            data: {
              currentRankId: nextRank.id,
              lastRankedUpAt: new Date(),
              attendanceSinceLastRank: attendance,
            },
          });

          // Create rank history entry
          await tx.rankHistory.create({
            data: {
              userId: userRank.userId,
              previousRankName: currentRank.name,
              newRankName: nextRank.name,
              attendanceTotalAtChange: attendance,
              attendanceDeltaSinceLastRank: attendanceDelta,
              triggeredBy: 'auto',
              outcome: 'approved',
            },
          });

          // Create notification message for rankup
          const message = await tx.message.create({
            data: {
              title: `Promoted to ${nextRank.name}`,
              body: `You have been promoted from ${currentRank.name} to ${nextRank.name}!`,
              type: 'rankup',
              createdById: null,
            },
          });

          // Add recipient for the user
          await tx.messageRecipient.create({
            data: {
              messageId: message.id,
              userId: userRank.userId,
              audienceType: 'user',
              channel: 'web',
              isRead: false,
            },
          });
        });

        results.promoted.push({
          userId: userRank.userId,
          username: userRank.user.username,
          oldRank: `${currentRank.abbreviation} - ${currentRank.name}`,
          newRank: `${nextRank.abbreviation} - ${nextRank.name}`,
        });
      } catch (error) {
        console.error(`Error promoting user ${userRank.userId}:`, error);
        results.failed.push({
          userId: userRank.userId,
          username: userRank.user.username,
          reason: 'Internal error during promotion',
        });
      }
    }

    return NextResponse.json({
      promoted: results.promoted,
      failed: results.failed,
      promotedCount: results.promoted.length,
      failedCount: results.failed.length,
    });
  } catch (error) {
    console.error('Error in auto-rankup:', error);
    return NextResponse.json({ error: 'Failed to process auto rankups' }, { status: 500 });
  }
}
