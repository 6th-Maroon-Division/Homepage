import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';
import { Prisma } from '@/generated/prisma/client';

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
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 250);
    const cursor = searchParams.get('cursor') ? Number(searchParams.get('cursor')) : null;
    if (cursor !== null && (!Number.isInteger(cursor) || cursor <= 0)) {
      return NextResponse.json({ error: 'cursor must be a positive user id' }, { status: 400 });
    }

    const where: Prisma.UserWhereInput = {
      ...(activeOnly ? { userRank: { retired: false } } : {}),
      AND: [
        ...(hasDiscord ? [{ accounts: { some: { provider: 'discord' as const } } }] : []),
        ...(hasSteam ? [{ accounts: { some: { provider: 'steam' as const } } }] : []),
      ],
    };

    const users = await prisma.user.findMany({
      where,
      include: {
        accounts: { select: { provider: true, providerUserId: true } },
        userRank: { include: { currentRank: { select: { id: true, name: true, abbreviation: true } } } },
      },
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit,
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

    return NextResponse.json({
      success: true, users: formattedUsers, total: formattedUsers.length,
      nextCursor: formattedUsers.length === limit ? String(formattedUsers.at(-1)!.id) : null,
    });
  } catch (error) {
    console.error('Bot users error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
