import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function validateBotToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  return token === process.env.BOT_API_TOKEN;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!validateBotToken(request)) {
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

    // Update promotion status
    await prisma.promotionProposal.update({
      where: { id: promotionId },
      data: { status: 'approved' },
    });

    // Update user's rank
    await prisma.userRank.update({
      where: { userId: promotion.user.id },
      data: {
        currentRankId: promotion.nextRankId,
        lastRankedUpAt: new Date(),
      },
    });

    // Create rank history entry
    await prisma.rankHistory.create({
      data: {
        userId: promotion.user.id,
        previousRankName: currentRank?.name || null,
        newRankName: nextRank.name,
        attendanceTotalAtChange: promotion.user.userRank?.attendanceSinceLastRank || 0,
        attendanceDeltaSinceLastRank: 0,
        triggeredBy: 'bot',
        triggeredByDiscordId: null,
        outcome: 'approved',
      },
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
