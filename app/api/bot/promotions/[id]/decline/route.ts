import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';

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

    const body = await request.json();
    const { reason } = body;

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
    const nextRank = await prisma.rank.findUnique({ where: { id: promotion.nextRankId } });

    // Update promotion status
    await prisma.promotionProposal.update({
      where: { id: promotionId },
      data: {
        status: 'rejected',
      },
    });

    // Create message for user
    await prisma.message.create({
      data: {
        title: 'Promotion Declined',
        body: `Your promotion request to ${nextRank?.name || 'the next rank'} has been declined.${reason ? ` Reason: ${reason}` : ''}`,
        type: 'rankup',
        actionUrl: '/profile',
        audienceType: 'user',
        audienceValue: promotion.user.id.toString(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Promotion declined',
      promotionId: promotion.id,
      userId: promotion.user.id,
      username: promotion.user.username,
      discordId: promotion.user.accounts.find(a => a.provider === 'discord')?.providerUserId || null,
      proposedRank: nextRank,
      reason: reason || null,
    });
  } catch (error) {
    console.error('Bot promotion decline error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
