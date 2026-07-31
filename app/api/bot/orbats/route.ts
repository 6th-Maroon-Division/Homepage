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
    const requestedLimit = Number(searchParams.get('limit') || '10');
    const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 10, 1), 100);
    const includePast = searchParams.get('includePast') === 'true';
    const startAtRaw = searchParams.get('startAt');
    const endBeforeRaw = searchParams.get('endBefore');
    const cursorRaw = searchParams.get('cursor');
    const startAt = startAtRaw ? new Date(startAtRaw) : null;
    const endBefore = endBeforeRaw ? new Date(endBeforeRaw) : null;
    const cursorId = cursorRaw ? Number(cursorRaw) : null;
    if ((startAt && Number.isNaN(startAt.getTime())) || (endBefore && Number.isNaN(endBefore.getTime()))) {
      return NextResponse.json({ error: 'startAt and endBefore must be ISO timestamps' }, { status: 400 });
    }
    if (startAt && endBefore && startAt >= endBefore) {
      return NextResponse.json({ error: 'startAt must be before endBefore' }, { status: 400 });
    }
    if (cursorRaw && (!Number.isInteger(cursorId) || cursorId! <= 0)) {
      return NextResponse.json({ error: 'cursor must be a positive ORBAT id' }, { status: 400 });
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const scheduleRange = startAt || endBefore ? {
      OR: [
        { startsAtUtc: { ...(startAt ? { gte: startAt } : {}), ...(endBefore ? { lt: endBefore } : {}) } },
        { startsAtUtc: null, eventDate: { ...(startAt ? { gte: startAt } : {}), ...(endBefore ? { lt: endBefore } : {}) } },
      ],
    } : !includePast
      ? {
          OR: [
            { startsAtUtc: { gte: today } },
            { startsAtUtc: null, eventDate: { gte: today } },
          ],
        }
      : {};

    const orbats = await prisma.orbat.findMany({
      where: scheduleRange,
      include: {
        squads: {
          orderBy: { orderIndex: 'asc' },
          include: {
            slots: {
              orderBy: { orderIndex: 'asc' },
              include: {
                squadRole: { select: { name: true, requiredTrainingIds: true, requiredRankIds: true } },
                signups: {
                  include: {
                    user: {
                      include: {
                        accounts: true,
                        userRank: { include: { currentRank: { select: { name: true, abbreviation: true } } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [
        { startsAtUtc: 'asc' },
        { eventDate: 'asc' },
        { id: 'asc' },
      ],
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: limit,
    });

    const formattedOrbats = orbats.map((orbat) => ({
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      startsAtUtc: orbat.startsAtUtc?.toISOString() || null,
      endsAtUtc: orbat.endsAtUtc?.toISOString() || null,
      eventDate: orbat.eventDate?.toISOString() || null,
      startTime: orbat.startTime,
      endTime: orbat.endTime,
      isActive: !includePast && ((orbat.startsAtUtc && orbat.startsAtUtc >= today) || (!orbat.startsAtUtc && orbat.eventDate && orbat.eventDate >= today)),
      squads: orbat.squads.map((squad) => ({
        id: squad.id,
        name: squad.name,
        slots: squad.slots.map((slot) => ({
          id: slot.id,
          name: slot.squadRole?.name || 'Unknown',
          requiredTrainingIds: slot.squadRole?.requiredTrainingIds ?? [],
          requiredRankIds: slot.squadRole?.requiredRankIds ?? [],
          maxSignups: slot.maxSignups || 1,
          available: (slot.maxSignups || 1) - slot.signups.length,
          signups: slot.signups.map((s) => ({
            userId: s.user.id,
            username: s.user.username,
            discordId: s.user.accounts.find(a => a.provider === 'discord')?.providerUserId || null,
            rank: s.user.userRank?.currentRank || null,
          })),
        })),
      })),
      signupCount: orbat.squads.reduce((sum, squad) => sum + squad.slots.reduce((s, slot) => s + slot.signups.length, 0), 0),
    }));

    return NextResponse.json({
      success: true,
      orbats: formattedOrbats,
      total: formattedOrbats.length,
      nextCursor: formattedOrbats.length === limit ? String(formattedOrbats.at(-1)!.id) : null,
    });
  } catch (error) {
    console.error('Bot orbats error:', error);
    return NextResponse.json({ error: 'Failed to fetch ORBATs' }, { status: 500 });
  }
}
