import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function validateBotToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  return token === process.env.BOT_API_TOKEN;
}

export async function GET(request: NextRequest) {
  try {
    if (!validateBotToken(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');

    const pendingPromotions = await prisma.promotionProposal.findMany({
      where: {
        status: 'pending',
      },
      include: {
        user: {
          include: {
            accounts: true,
            userRank: { include: { currentRank: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    // Get rank details for current and next ranks
    const rankIds = [
      ...pendingPromotions.map(p => p.currentRankId),
      ...pendingPromotions.map(p => p.nextRankId),
    ].filter((id): id is number => id !== null);

    const ranks = await prisma.rank.findMany({
      where: { id: { in: rankIds } },
    });

    const rankMap = new Map(ranks.map(r => [r.id, r]));

    const formatted = pendingPromotions.map((proposal) => ({
      id: proposal.id,
      userId: proposal.user.id,
      username: proposal.user.username,
      discordId: proposal.user.accounts.find(a => a.provider === 'discord')?.providerUserId || null,
      steamId: proposal.user.accounts.find(a => a.provider === 'steam')?.providerUserId || null,
      currentRank: proposal.user.userRank?.currentRank || rankMap.get(proposal.currentRankId) || null,
      proposedRank: rankMap.get(proposal.nextRankId) || null,
      attendanceTotalAtProposal: proposal.attendanceTotalAtProposal,
      attendanceDeltaSinceLastRank: proposal.attendanceDeltaSinceLastRank,
      createdAt: proposal.createdAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      pendingPromotions: formatted,
      total: formatted.length,
    });
  } catch (error) {
    console.error('Bot promotions pending error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
