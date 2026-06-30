import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

// Helper to handle duplicate events: check last event and only store if different
async function shouldStoreEvent(steamId: string | null | undefined, discordId: string | null | undefined, isJoin: boolean, eventTime: Date): Promise<boolean> {
  if (!steamId && !discordId) return true;

  // Find the last UNPROCESSED event for this user identifier
  const lastEvent = await prisma.attendanceEvent.findFirst({
    where: {
      OR: [
        steamId ? { steamId, processed: false } : {},
        discordId ? { discordId, processed: false } : {},
      ],
    },
    orderBy: { eventTime: 'desc' },
  });

  // If no previous event, or if the event type is different, store it
  if (!lastEvent) return true;
  
  // If same event type consecutively (join-join or leave-leave), skip the duplicate
  if (lastEvent.isJoin === isJoin) {
    return false;
  }

  return true;
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

    // Parse timestamp first
    const eventTime = new Date(timestamp);
    if (isNaN(eventTime.getTime())) {
      return NextResponse.json(
        { error: 'Invalid timestamp format. Use ISO 8601 (e.g., 2024-01-15T12:00:00Z)' },
        { status: 400 }
      );
    }

    // Check for duplicate consecutive events (join-join, leave-leave)
    const storeEvent = await shouldStoreEvent(steamId, discordUserId, isJoin, eventTime);
    if (!storeEvent) {
      return NextResponse.json({
        success: true,
        message: 'Duplicate consecutive event skipped',
        steamId,
        discordId: discordUserId,
        isJoin,
        eventTime: eventTime.toISOString(),
        processed: true,
        duplicate: true,
      });
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

    // Always store the event in AttendanceEvent
    // If user exists, link it and mark as processed; otherwise store with steamId/discordId
    const event = await prisma.attendanceEvent.create({
      data: {
        userId: user?.id,
        steamId,
        discordId: discordUserId,
        isJoin,
        eventTime,
        processed: user !== null, // true if user found, false if pending
      },
    });

    return NextResponse.json({
      success: true,
      eventId: event.id,
      userId: user?.id,
      username: user?.username,
      steamId,
      discordId: discordUserId,
      isJoin,
      eventTime: event.eventTime.toISOString(),
      processed: event.processed,
      message: user 
        ? 'Event recorded and processed'
        : 'Event stored - will be matched to user when account is created',
    });
  } catch (error) {
    console.error('Bot events error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
