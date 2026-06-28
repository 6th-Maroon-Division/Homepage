import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

type RefreshProvider = 'discord' | 'steam';

function isRefreshProvider(value: unknown): value is RefreshProvider {
  return value === 'discord' || value === 'steam';
}

function buildDiscordAvatarUrl(discordUserId: string, avatarHash: string | null): string {
  if (avatarHash) {
    const extension = avatarHash.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordUserId}/${avatarHash}.${extension}?size=256`;
  }

  const numericTail = Number(discordUserId.slice(-6));
  const fallbackIndex = Number.isFinite(numericTail) ? numericTail % 6 : 0;
  return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const provider = body?.provider;

    if (!isRefreshProvider(provider)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    const account = await prisma.authAccount.findFirst({
      where: {
        userId: session.user.id,
        provider,
      },
    });

    if (!account) {
      return NextResponse.json({ error: `No linked ${provider} account found` }, { status: 400 });
    }

    let avatarUrl: string | null = null;

    if (provider === 'steam') {
      const apiKey = process.env.STEAM_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: 'STEAM_API_KEY is not configured' }, { status: 500 });
      }

      const response = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${apiKey}&steamids=${account.providerUserId}`
      );

      if (!response.ok) {
        return NextResponse.json({ error: 'Failed to reach Steam API' }, { status: 502 });
      }

      const data = await response.json();
      const player = data?.response?.players?.[0];

      if (!player) {
        return NextResponse.json({ error: 'Steam profile not found' }, { status: 404 });
      }

      avatarUrl = player.avatarfull || player.avatarmedium || player.avatar || null;
    }

    if (provider === 'discord') {
      const botToken = process.env.DISCORD_BOT_TOKEN;
      if (!botToken) {
        return NextResponse.json(
          { error: 'DISCORD_BOT_TOKEN is not configured for Discord avatar refresh' },
          { status: 500 }
        );
      }

      const response = await fetch(`https://discord.com/api/v10/users/${account.providerUserId}`, {
        headers: {
          Authorization: `Bot ${botToken}`,
        },
      });

      if (!response.ok) {
        return NextResponse.json({ error: 'Failed to fetch Discord profile' }, { status: 502 });
      }

      const discordUser = await response.json();
      avatarUrl = buildDiscordAvatarUrl(account.providerUserId, discordUser?.avatar ?? null);
    }

    if (!avatarUrl) {
      return NextResponse.json({ error: 'No avatar available from selected provider' }, { status: 404 });
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { avatarUrl },
      select: {
        avatarUrl: true,
      },
    });

    return NextResponse.json({
      success: true,
      avatarUrl: updatedUser.avatarUrl,
    });
  } catch (error) {
    console.error('Error refreshing avatar:', error);
    return NextResponse.json({ error: 'Failed to refresh avatar' }, { status: 500 });
  }
}