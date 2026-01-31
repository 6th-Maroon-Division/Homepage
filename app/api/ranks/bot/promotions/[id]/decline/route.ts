import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Bot Authentication Middleware
 */
function validateBotToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  const expectedToken = process.env.BOT_API_TOKEN;

  if (!expectedToken) {
    console.warn('BOT_API_TOKEN not configured in environment');
    return false;
  }

  return token === expectedToken;
}

/**
 * POST /api/ranks/bot/promotions/[id]/decline - Decline a promotion (called by bot)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!validateBotToken(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const proposalId = parseInt(id);

    const body = await request.json();
    const { reason, discordActorId } = body;

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

    // Decline proposal and create history entry
    await prisma.$transaction(async (tx) => {
      // Update proposal status
      await tx.promotionProposal.update({
        where: { id: proposalId },
        data: { status: 'declined' },
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

      // Create rank history entry with decline
      await tx.rankHistory.create({
        data: {
          userId: proposal.userId,
          previousRankName: currentRank?.name || 'Unknown',
          newRankName: nextRank?.name || 'Unknown',
          attendanceTotalAtChange: proposal.attendanceTotalAtProposal,
          attendanceDeltaSinceLastRank: proposal.attendanceDeltaSinceLastRank,
          triggeredBy: 'bot',
          outcome: 'declined',
          declineReason: reason || null,
          triggeredByDiscordId: discordActorId || null,
        },
      });

      // Create notification for user
      const message = await tx.message.create({
        data: {
          title: `Promotion Declined`,
          body: `Your promotion to ${nextRank?.name || 'a new rank'} has been declined${reason ? ': ' + reason : ''}.`,
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
      message: `Promotion declined for ${proposal.user.username}`,
    });
  } catch (error) {
    console.error('Error declining promotion:', error);
    return NextResponse.json({ error: 'Failed to decline promotion' }, { status: 500 });
  }
}
