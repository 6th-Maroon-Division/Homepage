import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

function validateBotToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  return token === process.env.BOT_API_TOKEN;
}

export async function POST(request: NextRequest) {
  try {
    if (!validateBotToken(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { discordUserId, steamId, orbatId, slotId } = body;

    // Validate required fields
    if (!orbatId) {
      return NextResponse.json(
        { error: 'orbatId is required' },
        { status: 400 }
      );
    }

    if (!discordUserId && !steamId) {
      return NextResponse.json(
        { error: 'At least one of discordUserId or steamId is required' },
        { status: 400 }
      );
    }

    // Look up user
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

    // Find ORBAT
    const orbat = await prisma.orbat.findUnique({
      where: { id: orbatId },
      include: {
        squads: {
          include: {
            slots: {
              include: { 
                signups: true,
                squadRole: { select: { name: true } },
              },
              orderBy: { orderIndex: 'asc' },
            },
          },
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!orbat) {
      return NextResponse.json(
        { error: 'ORBAT not found', orbatId },
        { status: 404 }
      );
    }

    // Find available slot
    let targetSlot = null;
    let targetSquad = null;
    
    // If specific slotId provided, use that
    if (slotId) {
      for (const squad of orbat.squads) {
        targetSlot = squad.slots.find(slot => slot.id === slotId);
        if (targetSlot) {
          targetSquad = squad;
          break;
        }
      }
      
      if (!targetSlot) {
        return NextResponse.json(
          { error: 'Slot not found in this ORBAT', slotId },
          { status: 400 }
        );
      }
      
      // Check if slot has capacity
      const maxSignups = targetSlot.maxSignups || 1;
      if (targetSlot.signups.length >= maxSignups) {
        return NextResponse.json(
          { error: 'Slot is full', slotId },
          { status: 400 }
        );
      }
    } else {
      // Find first available slot
      for (const squad of orbat.squads) {
        for (const slot of squad.slots) {
          const maxSignups = slot.maxSignups || 1;
          if (slot.signups.length < maxSignups) {
            targetSlot = slot;
            targetSquad = squad;
            break;
          }
        }
        if (targetSlot) break;
      }
      
      if (!targetSlot) {
        return NextResponse.json(
          { error: 'ORBAT is full - no available slots' },
          { status: 400 }
        );
      }
    }

    // Check if user is already signed up
    const existingSignup = await prisma.signup.findFirst({
      where: {
        userId: user.id,
        slot: { orbatId: orbat.id },
      },
    });

    if (existingSignup) {
      return NextResponse.json(
        { 
          error: 'User already signed up for this ORBAT',
          signupId: existingSignup.id,
          slotId: existingSignup.slotId,
          orbatId: orbat.id
        },
        { status: 409 }
      );
    }

    // Create signup
    const signup = await prisma.signup.create({
      data: {
        userId: user.id,
        slotId: targetSlot.id,
      },
      include: {
        slot: {
          include: {
            squad: true,
          },
        },
        user: true,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'User signed up for ORBAT',
      signupId: signup.id,
      userId: user.id,
      username: user.username,
      orbatId: orbat.id,
      orbatName: orbat.name,
      eventDate: orbat.eventDate?.toISOString() || null,
      slotId: targetSlot.id,
      slotName: targetSlot.squadRole?.name || 'Unknown',
      squadName: targetSquad!.name,
    });
  } catch (error) {
    console.error('Bot signup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET all signups for an ORBAT (optional helper)
export async function GET(request: NextRequest) {
  try {
    if (!validateBotToken(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const orbatId = searchParams.get('orbatId');

    if (!orbatId) {
      return NextResponse.json(
        { error: 'orbatId query parameter is required' },
        { status: 400 }
      );
    }

    const signups = await prisma.signup.findMany({
      where: { slot: { orbatId: parseInt(orbatId) } },
      include: {
        user: {
          include: {
            accounts: true,
            userRank: { include: { currentRank: { select: { name: true, abbreviation: true } } } },
          },
        },
        slot: {
          include: {
            squad: true,
            squadRole: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const formattedSignups = signups.map((signup) => ({
      id: signup.id,
      userId: signup.user.id,
      username: signup.user.username,
      discordId: signup.user.accounts.find(a => a.provider === 'discord')?.providerUserId || null,
      steamId: signup.user.accounts.find(a => a.provider === 'steam')?.providerUserId || null,
      rank: signup.user.userRank?.currentRank || null,
      slotId: signup.slot.id,
      slotName: signup.slot.squadRole?.name || 'Unknown',
      squadName: signup.slot.squad.name,
      createdAt: signup.createdAt.toISOString(),
    }));

    return NextResponse.json({
      success: true,
      orbatId: parseInt(orbatId),
      signups: formattedSignups,
      total: formattedSignups.length,
    });
  } catch (error) {
    console.error('Bot signups list error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
