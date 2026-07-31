import { NextRequest, NextResponse } from 'next/server';
import { authenticateDatabaseBot, botError, parsePositiveId, resolveDiscordUser } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';
import { getOrbatTrainingAccess } from '@/lib/training-gating';

type Context = { params: Promise<{ id: string }> };

type Reason = { code: string; message: string };

export async function GET(request: NextRequest, route: Context) {
  if (!(await authenticateDatabaseBot(request))) return botError(401, 'unauthorized', 'Invalid or revoked bot token.');
  const orbatId = parsePositiveId((await route.params).id);
  const discordUserId = new URL(request.url).searchParams.get('discordUserId')?.trim() ?? '';
  if (!orbatId || !discordUserId) return botError(400, 'invalid_request', 'A valid ORBAT id and discordUserId are required.');

  const [orbat, user] = await Promise.all([
    prisma.orbat.findUnique({
      where: { id: orbatId },
      include: {
        squads: { orderBy: { orderIndex: 'asc' }, include: {
          slots: { orderBy: { orderIndex: 'asc' }, include: {
            squadRole: { select: { name: true, requiredTrainingIds: true, requiredRankIds: true } },
            _count: { select: { signups: true } },
          } },
        } },
      },
    }),
    resolveDiscordUser(discordUserId),
  ]);
  if (!orbat) return botError(404, 'not_found', 'ORBAT not found.', { orbatId });
  if (!user) return botError(404, 'not_found', 'Linked Discord user not found.', { discordUserId });

  const [currentSignup, note, userRank, ranks] = await Promise.all([
    prisma.signup.findFirst({ where: { userId: user.id, slot: { orbatId } }, select: { id: true, slotId: true } }),
    prisma.orbatAttendanceNote.findUnique({ where: { orbatId_userId: { orbatId, userId: user.id } }, select: { status: true } }),
    prisma.userRank.findUnique({ where: { userId: user.id }, select: { currentRank: { select: { orderIndex: true } } } }),
    prisma.rank.findMany({ select: { id: true, orderIndex: true, name: true, abbreviation: true } }),
  ]);
  const rankById = new Map(ranks.map((rank) => [rank.id, rank]));
  const closed = Boolean(resolveOrbatScheduleWindow(orbat).cutoff && resolveOrbatScheduleWindow(orbat).cutoff! < new Date());

  const slots = [];
  for (const squad of orbat.squads) {
    for (const slot of squad.slots) {
      const reasons: Reason[] = [];
      const isCurrent = currentSignup?.slotId === slot.id;
      if (closed) reasons.push({ code: 'signup_closed', message: 'Signups are closed.' });
      if (note?.status === 'absent') reasons.push({ code: 'marked_absent', message: 'User is marked absent.' });
      if (!isCurrent && slot.maxSignups !== null && slot._count.signups >= slot.maxSignups) {
        reasons.push({ code: 'slot_full', message: 'The slot is full.' });
      }
      const requiredRanks = (slot.squadRole?.requiredRankIds ?? []).map((id) => rankById.get(id)).filter(Boolean);
      const rankInvalid = requiredRanks.length !== (slot.squadRole?.requiredRankIds.length ?? 0);
      const unmetRanks = requiredRanks.filter((rank) =>
        typeof userRank?.currentRank?.orderIndex !== 'number' || userRank.currentRank.orderIndex < rank!.orderIndex,
      );
      if (rankInvalid || unmetRanks.length) reasons.push({ code: 'rank_required', message: 'The required rank has not been met.' });

      const requiredTrainingIds = slot.squadRole?.requiredTrainingIds ?? [];
      if (requiredTrainingIds.length) {
        const access = await getOrbatTrainingAccess(user.id, requiredTrainingIds);
        if (!access.allowed) reasons.push({ code: 'training_required', message: 'The required training has not been met.' });
      }
      slots.push({
        slotId: slot.id,
        slotName: slot.squadRole?.name ?? 'Unknown',
        squadId: squad.id,
        squadName: squad.name,
        capacity: slot.maxSignups,
        signupCount: slot._count.signups,
        available: isCurrent || slot.maxSignups === null || slot._count.signups < slot.maxSignups,
        eligible: reasons.length === 0,
        reasons,
      });
    }
  }
  return NextResponse.json({
    orbatId, userId: user.id,
    currentSignup: currentSignup ? { signupId: currentSignup.id, slotId: currentSignup.slotId } : null,
    slots,
  });
}
