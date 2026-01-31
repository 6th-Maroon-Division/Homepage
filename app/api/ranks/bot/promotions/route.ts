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
 * GET /api/ranks/bot/promotions - Get all pending promotion proposals
 */
export async function GET(request: NextRequest) {
  try {
    if (!validateBotToken(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const proposals = await prisma.promotionProposal.findMany({
      where: { status: 'pending' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Fetch rank names for display
    const ranksToFetch = new Set<number>();
    proposals.forEach((p) => {
      ranksToFetch.add(p.currentRankId);
      ranksToFetch.add(p.nextRankId);
    });

    const ranks = await prisma.rank.findMany({
      where: { id: { in: Array.from(ranksToFetch) } },
      select: { id: true, name: true, abbreviation: true },
    });

    const rankMap = new Map(ranks.map((r) => [r.id, r]));

    const serialized = proposals.map((p) => ({
      id: p.id,
      userId: p.userId,
      username: p.user.username,
      currentRank: rankMap.get(p.currentRankId),
      nextRank: rankMap.get(p.nextRankId),
      attendanceTotalAtProposal: p.attendanceTotalAtProposal,
      attendanceDeltaSinceLastRank: p.attendanceDeltaSinceLastRank,
      createdAt: p.createdAt.toISOString(),
    }));

    return NextResponse.json(serialized);
  } catch (error) {
    console.error('Error fetching pending promotions:', error);
    return NextResponse.json({ error: 'Failed to fetch promotions' }, { status: 500 });
  }
}

/**
 * POST /api/ranks/bot/promotions/approve - Approve a promotion (called by bot)
 */
export async function POST(request: NextRequest) {
  try {
    if (!validateBotToken(request)) {
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
      await tx.rankHistory.create({
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
