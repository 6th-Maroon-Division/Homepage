import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const orbatId = parseInt(id);

    if (isNaN(orbatId)) {
      return NextResponse.json({ error: 'Invalid ORBAT ID' }, { status: 400 });
    }

    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
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
    });

    if (!orbat) {
      return NextResponse.json({ error: 'ORBAT not found', orbatId }, { status: 404 });
    }

    const formattedOrbat = {
      id: orbat.id,
      name: orbat.name,
      description: orbat.description,
      startsAtUtc: orbat.startsAtUtc?.toISOString() || null,
      endsAtUtc: orbat.endsAtUtc?.toISOString() || null,
      eventDate: orbat.eventDate?.toISOString() || null,
      startTime: orbat.startTime,
      endTime: orbat.endTime,
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
            steamId: s.user.accounts.find(a => a.provider === 'steam')?.providerUserId || null,
            rank: s.user.userRank?.currentRank || null,
          })),
        })),
      })),
      totalSignups: orbat.squads.reduce((sum, squad) => sum + squad.slots.reduce((s, slot) => s + slot.signups.length, 0), 0),
    };

    return NextResponse.json({ success: true, orbat: formattedOrbat });
  } catch (error) {
    console.error('Bot orbat details error:', error);
    return NextResponse.json({ error: 'Failed to fetch ORBAT' }, { status: 500 });
  }
}
