import { parseCursorPagination } from '@/lib/api/validation';
import { parsePromotionLookback } from '@/lib/api/bot-query-validation';
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
    const lookback = parsePromotionLookback(searchParams);
    if (lookback.error !== undefined) return NextResponse.json({ error: lookback.error }, { status: 400 });
    const { days, cutoffDate } = lookback.data;
    const pagination = parseCursorPagination(searchParams, { defaultLimit: 100, maxLimit: 100 });
    if (pagination.error !== undefined) return NextResponse.json({ error: pagination.error }, { status: 400 });
    const { limit, cursor } = pagination.data;

    // Get users who were auto-ranked up (triggeredBy contains 'auto' or 'system')
    const autoPromotions = await prisma.rankHistory.findMany({
      where: {
        createdAt: { gte: cutoffDate },
        triggeredBy: { contains: 'auto', mode: 'insensitive' },
      },
      include: {
        user: {
          include: {
            accounts: true,
            userRank: { include: { currentRank: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit,
    });

    // Get all rank IDs from the promotions
    const rankNames = [
      ...autoPromotions.map(h => h.previousRankName),
      ...autoPromotions.map(h => h.newRankName),
    ].filter((name): name is string => name !== null);

    const ranks = await prisma.rank.findMany({
      where: { name: { in: rankNames } },
    });

    const rankMap = new Map(ranks.map(r => [r.name, r]));

    const formatted = autoPromotions.map((history) => ({
      id: history.id,
      userId: history.user.id,
      username: history.user.username,
      discordId: history.user.accounts.find(a => a.provider === 'discord')?.providerUserId || null,
      steamId: history.user.accounts.find(a => a.provider === 'steam')?.providerUserId || null,
      previousRank: rankMap.get(history.previousRankName || '') || null,
      newRank: rankMap.get(history.newRankName || '') || null,
      changedAt: history.createdAt.toISOString(),
      triggeredBy: history.triggeredBy,
      outcome: history.outcome,
    }));

    return NextResponse.json({
      success: true,
      autoPromotions: formatted,
      total: formatted.length,
      daysBack: days,
      nextCursor: formatted.length === limit ? String(formatted.at(-1)!.id) : null,
    });
  } catch (error) {
    console.error('Bot promotions auto error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
