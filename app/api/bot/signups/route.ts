import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';
import {
  formatOrbatTrainingAccessError,
  getOrbatTrainingAccess,
} from '@/lib/training-gating';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { runSerializableTransaction } from '@/lib/serializable-transaction';

function validateBotToken(request: NextRequest): Promise<boolean> {
  return validateBotTokenLegacy(request);
}

export async function POST(request: NextRequest) {
  try {
    if (!(await validateBotToken(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId.trim() : '';
    const steamId = typeof body.steamId === 'string' ? body.steamId.trim() : '';
    const orbatId = Number(body.orbatId);
    const slotId = body.slotId === undefined || body.slotId === null ? null : Number(body.slotId);

    // Validate required fields
    if (!Number.isInteger(orbatId) || orbatId <= 0) {
      return NextResponse.json(
        { error: 'orbatId is required' },
        { status: 400 }
      );
    }

    if (slotId !== null && (!Number.isInteger(slotId) || slotId <= 0)) {
      return NextResponse.json({ error: 'slotId must be a positive integer' }, { status: 400 });
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
                squadRole: {
                  select: {
                    name: true,
                    requiredTrainingIds: true,
                    requiredRankIds: true,
                  },
                },
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

    const operationCutoff = resolveOrbatScheduleWindow(orbat).cutoff;
    if (operationCutoff && operationCutoff < new Date()) {
      return NextResponse.json(
        { error: 'Operation is in the past. Signups are closed.' },
        { status: 409 },
      );
    }

    const absentNote = await prisma.orbatAttendanceNote.findUnique({
      where: { orbatId_userId: { orbatId, userId: user.id } },
      select: { status: true },
    });
    if (absentNote?.status === 'absent') {
      return NextResponse.json(
        { error: 'User is marked absent for this operation.' },
        { status: 409 },
      );
    }

    // Find available slot
    let targetSlot = null;
    let targetSquad = null;
    
    // If specific slotId provided, use that
    if (slotId !== null) {
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
      if (targetSlot.maxSignups !== null && targetSlot.signups.length >= targetSlot.maxSignups) {
        return NextResponse.json(
          { error: 'Slot is full', slotId },
          { status: 400 }
        );
      }
    } else {
      // Find first available slot
      for (const squad of orbat.squads) {
        for (const slot of squad.slots) {
          if (slot.maxSignups === null || slot.signups.length < slot.maxSignups) {
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

    const requiredTrainingIds = targetSlot.squadRole?.requiredTrainingIds || [];
    let temporaryAccess = false;
    if (requiredTrainingIds.length > 0) {
      const trainingAccess = await getOrbatTrainingAccess(user.id, requiredTrainingIds);
      if (!trainingAccess.allowed) {
        const accessError = formatOrbatTrainingAccessError(trainingAccess);
        return NextResponse.json(
          {
            ...accessError,
            requirements: trainingAccess.blockedRequirements,
          },
          { status: 400 }
        );
      }
      temporaryAccess = trainingAccess.hasTemporaryAccess;
    }

    const requiredRankIds = targetSlot.squadRole?.requiredRankIds || [];
    if (requiredRankIds.length > 0) {
      const [userRank, requiredRanks] = await Promise.all([
        prisma.userRank.findUnique({
          where: { userId: user.id },
          select: { currentRank: { select: { orderIndex: true } } },
        }),
        prisma.rank.findMany({
          where: { id: { in: requiredRankIds } },
          select: { id: true, name: true, abbreviation: true, orderIndex: true },
        }),
      ]);
      if (requiredRanks.length !== requiredRankIds.length) {
        return NextResponse.json({ error: 'Slot rank prerequisite is invalid.' }, { status: 409 });
      }
      const userOrderIndex = userRank?.currentRank?.orderIndex;
      const unmetRanks = requiredRanks.filter(
        (rank) => typeof userOrderIndex !== 'number' || userOrderIndex < rank.orderIndex,
      );
      if (unmetRanks.length > 0) {
        return NextResponse.json(
          {
            error: `Slot requires ${unmetRanks
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((rank) => `[${rank.abbreviation}] ${rank.name}`)
              .join(', ')} or higher.`,
          },
          { status: 409 },
        );
      }
    }

    const signupOutcome = await runSerializableTransaction(async (tx) => {
      const [freshSlot, existingSignup] = await Promise.all([
        tx.slot.findUnique({
          where: { id: targetSlot.id },
          select: { orbatId: true, maxSignups: true, _count: { select: { signups: true } } },
        }),
        tx.signup.findFirst({ where: { userId: user.id, slot: { orbatId: orbat.id } } }),
      ]);
      if (existingSignup) {
        return {
          error: 'User already signed up for this ORBAT',
          signupId: existingSignup.id,
          existingSlotId: existingSignup.slotId,
        } as const;
      }
      if (!freshSlot || freshSlot.orbatId !== orbat.id) {
        return { error: 'Slot is no longer part of this ORBAT' } as const;
      }
      if (freshSlot.maxSignups !== null && freshSlot._count.signups >= freshSlot.maxSignups) {
        return { error: 'Slot is full' } as const;
      }

      const signup = await tx.signup.create({
        data: { userId: user.id, slotId: targetSlot.id },
        include: { slot: { include: { squad: true } }, user: true },
      });
      return { signup } as const;
    });

    if ('error' in signupOutcome) {
      return NextResponse.json(
        {
          error: signupOutcome.error,
          ...('signupId' in signupOutcome
            ? { signupId: signupOutcome.signupId, slotId: signupOutcome.existingSlotId, orbatId: orbat.id }
            : {}),
        },
        { status: 409 },
      );
    }
    const signup = signupOutcome.signup;

    return NextResponse.json({
      success: true,
      message: 'User signed up for ORBAT',
      signupId: signup.id,
      userId: user.id,
      username: user.username,
      orbatId: orbat.id,
      orbatName: orbat.name,
      startsAtUtc: orbat.startsAtUtc?.toISOString() || null,
      eventDate: orbat.eventDate?.toISOString() || null,
      slotId: targetSlot.id,
      slotName: targetSlot.squadRole?.name || 'Unknown',
      squadName: targetSquad!.name,
      temporaryTrainingAccess: temporaryAccess,
    });
  } catch (error) {
    console.error('Bot signup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET all signups for an ORBAT (optional helper)
export async function GET(request: NextRequest) {
  try {
    if (!(await validateBotToken(request))) {
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
