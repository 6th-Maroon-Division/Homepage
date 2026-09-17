import { parseCursorPagination } from '@/lib/api/validation';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

export async function GET(request: NextRequest) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pagination = parseCursorPagination(searchParams, { defaultLimit: 50, maxLimit: 100 });
    if (pagination.error !== undefined) return NextResponse.json({ error: pagination.error }, { status: 400 });
    const { limit, cursor } = pagination.data;

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
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
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
      nextCursor: formatted.length === limit ? String(formatted.at(-1)!.id) : null,
    });
  } catch (error) {
    console.error('Bot promotions pending error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
