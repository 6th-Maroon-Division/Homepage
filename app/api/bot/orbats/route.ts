import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function validateBotToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  return token === process.env.BOT_API_TOKEN;
}

export async function GET(request: NextRequest) {
  try {
    if (!validateBotToken(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '10');
    const includePast = searchParams.get('includePast') === 'true';

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: { eventDate?: { gte: Date } } = !includePast ? { eventDate: { gte: today } } : {};

    const orbats = await prisma.orbat.findMany({
      where,
      include: {
        squads: {
          orderBy: { orderIndex: 'asc' },
          include: {
            slots: {
              orderBy: { orderIndex: 'asc' },
              include: {
                squadRole: { select: { name: true } },
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
      orderBy: { eventDate: 'asc' },
      take: limit,
    });

    const formattedOrbats = orbats.map((orbat) => ({
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      eventDate: orbat.eventDate?.toISOString() || null,
      startTime: orbat.startTime,
      endTime: orbat.endTime,
      isActive: !includePast && orbat.eventDate && new Date(orbat.eventDate) >= today,
      squads: orbat.squads.map((squad) => ({
        id: squad.id,
        name: squad.name,
        slots: squad.slots.map((slot) => ({
          id: slot.id,
          name: slot.squadRole?.name || 'Unknown',
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

    return NextResponse.json({ success: true, orbats: formattedOrbats, total: formattedOrbats.length });
  } catch (error) {
    console.error('Bot orbats error:', error);
    return NextResponse.json({ error: 'Failed to fetch ORBATs' }, { status: 500 });
  }
}
