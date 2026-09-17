import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';
import { appendBotEvent } from '@/lib/bot-events';

/**
 * Bot Authentication Middleware
 */
function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

/**
 * POST /api/ranks/bot/promotions/approve - Approve a promotion (called by bot)
 */
export async function POST(request: NextRequest) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { proposalId, discordActorId } = body;

    if (!proposalId) {
      return NextResponse.json({ error: 'proposalId is required' }, { status: 400 });
    }

    const proposal = await prisma.promotionProposal.findUnique({
      where: { id: proposalId },
      include: {
        user: {
          select: { id: true, username: true },
        },
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (proposal.status !== 'pending') {
      return NextResponse.json({ error: 'Proposal is not pending' }, { status: 400 });
    }

    // Approve and apply rankup
    await prisma.$transaction(async (tx) => {
      // Update proposal status
      await tx.promotionProposal.update({
        where: { id: proposalId },
        data: { status: 'approved' },
      });

      // Update user rank
      await tx.userRank.update({
        where: { userId: proposal.userId },
        data: {
          currentRankId: proposal.nextRankId,
          lastRankedUpAt: new Date(),
          attendanceSinceLastRank: proposal.attendanceTotalAtProposal,
        },
      });

      // Get rank names for history
      const [currentRank, nextRank] = await Promise.all([
        tx.rank.findUnique({
          where: { id: proposal.currentRankId },
          select: { name: true },
        }),
        tx.rank.findUnique({
          where: { id: proposal.nextRankId },
          select: { name: true },
        }),
      ]);

      // Create rank history entry
      const history = await tx.rankHistory.create({
        data: {
          userId: proposal.userId,
          previousRankName: currentRank?.name || 'Unknown',
          newRankName: nextRank?.name || 'Unknown',
          attendanceTotalAtChange: proposal.attendanceTotalAtProposal,
          attendanceDeltaSinceLastRank: proposal.attendanceDeltaSinceLastRank,
          triggeredBy: 'bot',
          outcome: 'approved',
          triggeredByDiscordId: discordActorId || null,
        },
      });
      const discord = await tx.authAccount.findFirst({ where: { userId: proposal.userId, provider: 'discord' }, select: { providerUserId: true } });
      await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: {
        rankHistoryId: history.id, userId: proposal.userId, discordUserId: discord?.providerUserId ?? null,
        oldRankId: proposal.currentRankId, newRankId: proposal.nextRankId, changeType: 'promotion', source: 'manual_approval',
      } }, tx);

      // Create notification for user
      const message = await tx.message.create({
        data: {
          title: `Promoted to ${nextRank?.name || 'New Rank'}`,
          body: `Your promotion has been approved! You are now ${nextRank?.name || 'a new rank'}.`,
          type: 'rankup',
          createdById: null,
        },
      });

      await tx.messageRecipient.create({
        data: {
          messageId: message.id,
          userId: proposal.userId,
          audienceType: 'user',
          channel: 'web',
          isRead: false,
        },
      });
    });

    return NextResponse.json({
      success: true,
      message: `Promotion approved for ${proposal.user.username}`,
    });
  } catch (error) {
    console.error('Error approving promotion:', error);
    return NextResponse.json({ error: 'Failed to approve promotion' }, { status: 500 });
  }
}
