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
    const days = parseInt(searchParams.get('days') || '7');
    const limit = parseInt(searchParams.get('limit') || '100');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

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
      orderBy: { createdAt: 'desc' },
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
    });
  } catch (error) {
    console.error('Bot promotions auto error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
