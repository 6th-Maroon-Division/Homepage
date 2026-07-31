import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';
import { appendBotEvent } from '@/lib/bot-events';

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const promotionId = parseInt(id);

    if (isNaN(promotionId)) {
      return NextResponse.json(
        { error: 'Invalid promotion ID' },
        { status: 400 }
      );
    }

    const promotion = await prisma.promotionProposal.findUnique({
      where: { id: promotionId },
      include: {
        user: {
          include: {
            userRank: true,
            accounts: true,
          },
        },
      },
    });

    if (!promotion) {
      return NextResponse.json(
        { error: 'Promotion not found', id: promotionId },
        { status: 404 }
      );
    }

    if (promotion.status !== 'pending') {
      return NextResponse.json(
        { error: `Promotion already ${promotion.status}` },
        { status: 400 }
      );
    }

    // Get rank details
    const currentRank = await prisma.rank.findUnique({ where: { id: promotion.currentRankId } });
    const nextRank = await prisma.rank.findUnique({ where: { id: promotion.nextRankId } });

    if (!nextRank) {
      return NextResponse.json(
        { error: 'Proposed rank not found' },
        { status: 400 }
      );
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.promotionProposal.updateMany({
        where: { id: promotionId, status: 'pending' }, data: { status: 'approved' },
      });
      if (claimed.count !== 1) throw new Error('PROMOTION_ALREADY_HANDLED');
      await tx.userRank.update({
        where: { userId: promotion.user.id }, data: { currentRankId: promotion.nextRankId, lastRankedUpAt: new Date() },
      });
      const history = await tx.rankHistory.create({ data: {
        userId: promotion.user.id,
        previousRankName: currentRank?.name || null,
        newRankName: nextRank.name,
        attendanceTotalAtChange: promotion.user.userRank?.attendanceSinceLastRank || 0,
        attendanceDeltaSinceLastRank: 0,
        triggeredBy: 'bot',
        triggeredByDiscordId: null,
        outcome: 'approved',
      } });
      const discordUserId = promotion.user.accounts.find((account) => account.provider === 'discord')?.providerUserId ?? null;
      await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: {
        rankHistoryId: history.id, userId: promotion.user.id, discordUserId,
        oldRankId: promotion.currentRankId, newRankId: promotion.nextRankId, changeType: 'promotion', source: 'manual_approval',
      } }, tx);
    });

    // Create message for user
    await prisma.message.create({
      data: {
        title: 'Promotion Approved',
        body: `You have been promoted to ${nextRank.name}!`,
        type: 'rankup',
        actionUrl: '/profile',
        audienceType: 'user',
        audienceValue: promotion.user.id.toString(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Promotion approved',
      promotionId: promotion.id,
      userId: promotion.user.id,
      username: promotion.user.username,
      discordId: promotion.user.accounts.find(a => a.provider === 'discord')?.providerUserId || null,
      previousRank: currentRank,
      newRank: nextRank,
    });
  } catch (error) {
    console.error('Bot promotion approve error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
