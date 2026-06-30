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
    const activeOnly = searchParams.get('activeOnly') === 'true';
    const hasDiscord = searchParams.get('hasDiscord') === 'true';
    const hasSteam = searchParams.get('hasSteam') === 'true';

    const where: { userRank?: { retired: boolean } } = activeOnly ? { userRank: { retired: false } } : {};

    const users = await prisma.user.findMany({
      where,
      include: {
        accounts: { select: { provider: true, providerUserId: true } },
        userRank: { include: { currentRank: { select: { id: true, name: true, abbreviation: true } } } },
      },
      orderBy: { username: 'asc' },
    });

    const formattedUsers = users
      .filter((user) => {
        if (hasDiscord && !user.accounts.some(a => a.provider === 'discord')) return false;
        if (hasSteam && !user.accounts.some(a => a.provider === 'steam')) return false;
        return true;
      })
      .map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        avatarUrl: user.avatarUrl,
        isRetired: user.userRank?.retired || false,
        currentRank: user.userRank?.currentRank || null,
        discordId: user.accounts.find(a => a.provider === 'discord')?.providerUserId || null,
        steamId: user.accounts.find(a => a.provider === 'steam')?.providerUserId || null,
        createdAt: user.createdAt.toISOString(),
      }));

    return NextResponse.json({ success: true, users: formattedUsers, total: formattedUsers.length });
  } catch (error) {
    console.error('Bot users error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
