import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { publishInboxEvent } from '@/lib/realtime/inbox-events';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { checkRankupEligibility } from '@/lib/rank-eligibility';

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
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const hasPermission = await checkPermission(session.user.id, 'rank:manage_promotions');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
            attendanceRequiredSinceLastRank: true,
            autoRankupEnabled: true,
          },
        },
      },
    });

    const results = {
      promoted: [] as PromotionResult[],
      errors: [] as PromotionResult[],
      ineligible: [] as PromotionResult[],
    };

    for (const userRank of usersWithRanks) {
      try {
        const eligibility = await checkRankupEligibility(userRank.userId);

        if (!eligibility.eligible || eligibility.reason !== 'eligible_auto' || !eligibility.nextRank || !eligibility.currentRank) {
          // Keep "ineligible" focused on users who are in an auto-rankup lane but short on attendance.
          if (
            eligibility.reason === 'ineligible_attendance' &&
            userRank.currentRank?.autoRankupEnabled
          ) {
            const required = eligibility.attendance.requiredAttendance ?? 0;
            const delta = eligibility.attendance.delta;
            results.ineligible.push({
              userId: userRank.userId,
              username: userRank.user.username,
              reason: `Need ${Math.max(required - delta, 0)} more attendance (${delta}/${required})`,
            });
          }
          continue;
        }

        const currentRank = eligibility.currentRank;
        const nextRank = eligibility.nextRank;
        const attendance = eligibility.attendance.currentAttendance;
        const attendanceDelta = eligibility.attendance.delta;

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

        publishInboxEvent(userRank.userId);
        publishUserProfileEvent(userRank.userId, {
          source: 'rank.auto-promoted',
          nextRankId: nextRank.id,
        });

        results.promoted.push({
          userId: userRank.userId,
          username: userRank.user.username,
          oldRank: `${currentRank.abbreviation} - ${currentRank.name}`,
          newRank: `${nextRank.abbreviation} - ${nextRank.name}`,
        });
      } catch (error) {
        console.error(`Error promoting user ${userRank.userId}:`, error);
        results.errors.push({
          userId: userRank.userId,
          username: userRank.user.username,
          reason: 'Internal error during promotion',
        });
      }
    }

    return NextResponse.json({
      promoted: results.promoted,
      errors: results.errors,
      ineligible: results.ineligible,
      promotedCount: results.promoted.length,
      errorsCount: results.errors.length,
      ineligibleCount: results.ineligible.length,
    });
  } catch (error) {
    console.error('Error in auto-rankup:', error);
    return NextResponse.json({ error: 'Failed to process auto rankups' }, { status: 500 });
  }
}
