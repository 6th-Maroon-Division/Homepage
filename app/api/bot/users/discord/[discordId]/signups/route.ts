import { NextRequest, NextResponse } from 'next/server';
import { authenticateDatabaseBot, botError, parsePositiveId, resolveDiscordUser } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';
import { resolveOrbatScheduleWindow } from '@/lib/orbat-schedule';

type Context = { params: Promise<{ discordId: string }> };

export async function GET(request: NextRequest, route: Context) {
  if (!(await authenticateDatabaseBot(request))) {
    return botError(401, 'unauthorized', 'Invalid or revoked bot token.');
  }
  const discordUserId = decodeURIComponent((await route.params).discordId).trim();
  const user = await resolveDiscordUser(discordUserId);
  if (!user) return botError(404, 'not_found', 'Linked Discord user not found.', { discordUserId });

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 100);
  const cursor = params.get('cursor') ? parsePositiveId(params.get('cursor')) : null;
  if (params.has('cursor') && !cursor) return botError(400, 'invalid_request', 'cursor must be a positive signup id.');
  const includePast = params.get('includePast') === 'true';

  const rows = await prisma.signup.findMany({
    where: { userId: user.id },
    include: {
      slot: {
        include: {
          orbat: true,
          squad: { select: { id: true, name: true } },
          squadRole: { select: { name: true } },
        },
      },
    },
    orderBy: { id: 'desc' },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit,
  });

  const now = new Date();
  const signups = rows
    .map((signup) => {
      const schedule = resolveOrbatScheduleWindow(signup.slot.orbat);
      return {
        signupId: signup.id,
        orbatId: signup.slot.orbat.id,
        orbatName: signup.slot.orbat.name,
        startsAtUtc: schedule.startsAtUtc?.toISOString() ?? null,
        endsAtUtc: schedule.endsAtUtc?.toISOString() ?? null,
        slotId: signup.slotId,
        slotName: signup.slot.squadRole?.name ?? 'Unknown',
        squadId: signup.slot.squad.id,
        squadName: signup.slot.squad.name,
        createdAt: signup.createdAt.toISOString(),
        isPast: Boolean(schedule.cutoff && schedule.cutoff < now),
      };
    })
    .filter((signup) => includePast || !signup.isPast);

  return NextResponse.json({
    userId: user.id,
    discordUserId,
    signups,
    nextCursor: rows.length === limit ? String(rows.at(-1)!.id) : null,
  });
}
