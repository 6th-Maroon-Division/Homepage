import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

export async function POST(request: NextRequest) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { steamId, discordUserId, isJoin, timestamp } = body;

    // Validate required fields
    if (isJoin === undefined || isJoin === null) {
      return NextResponse.json(
        { error: 'isJoin is required (true for join/check-in, false for leave/check-out)' },
        { status: 400 }
      );
    }

    if (!timestamp) {
      return NextResponse.json(
        { error: 'timestamp is required in ISO 8601 format (e.g., 2024-01-15T12:00:00Z)' },
        { status: 400 }
      );
    }

    if (!steamId && !discordUserId) {
      return NextResponse.json(
        { error: 'At least one of steamId or discordUserId is required' },
        { status: 400 }
      );
    }

    // Look up user by Steam ID or Discord ID
    let user = null;
    if (steamId) {
      const steamAccount = await prisma.authAccount.findUnique({
        where: { provider_providerUserId: { provider: 'steam', providerUserId: steamId } },
        include: { user: true },
      });
      if (steamAccount) user = steamAccount.user;
    }

    if (!user && discordUserId) {
      const discordAccount = await prisma.authAccount.findUnique({
        where: { provider_providerUserId: { provider: 'discord', providerUserId: discordUserId } },
        include: { user: true },
      });
      if (discordAccount) user = discordAccount.user;
    }

    if (!user) {
      return NextResponse.json(
        { error: 'User not found', steamId, discordUserId },
        { status: 404 }
      );
    }

    // Parse timestamp
    const eventTime = new Date(timestamp);
    if (isNaN(eventTime.getTime())) {
      return NextResponse.json(
        { error: 'Invalid timestamp format. Use ISO 8601 (e.g., 2024-01-15T12:00:00Z)' },
        { status: 400 }
      );
    }

    // Store the raw event
    const event = await prisma.attendanceEvent.create({
      data: {
        userId: user.id,
        isJoin,
        eventTime,
      },
    });

    return NextResponse.json({
      success: true,
      eventId: event.id,
      userId: user.id,
      username: user.username,
      isJoin,
      eventTime: event.eventTime.toISOString(),
    });
  } catch (error) {
    console.error('Bot events error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
