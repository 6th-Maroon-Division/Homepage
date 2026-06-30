import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ discordId: string }> }
) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { discordId } = await params;

    const discordAccount = await prisma.authAccount.findUnique({
      where: { provider_providerUserId: { provider: 'discord', providerUserId: discordId } },
      include: {
        user: {
          include: {
            userRank: { include: { currentRank: true } },
            accounts: true,
          },
        },
      },
    });

    if (!discordAccount) {
      return NextResponse.json({ error: 'User with this Discord ID not found', discordId }, { status: 404 });
    }

    const user = discordAccount.user;

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        isRetired: user.userRank?.retired || false,
        currentRank: user.userRank?.currentRank || null,
        providers: user.accounts.map(a => ({ type: a.provider, userId: a.providerUserId })),
        steamId: user.accounts.find(a => a.provider === 'steam')?.providerUserId || null,
        createdAt: user.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('Bot user by Discord ID error:', error);
    return NextResponse.json({ error: 'Failed to fetch user' }, { status: 500 });
  }
}
