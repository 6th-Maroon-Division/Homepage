import { NextRequest, NextResponse } from 'next/server';
import { authenticateDatabaseBot, botError, parsePositiveId } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, route: Context) {
  if (!(await authenticateDatabaseBot(request))) {
    return botError(401, 'unauthorized', 'Invalid or revoked bot token.');
  }
  const orbatId = parsePositiveId((await route.params).id);
  if (!orbatId) return botError(400, 'invalid_request', 'Invalid ORBAT id.');

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 250);
  const cursor = params.get('cursor') ? parsePositiveId(params.get('cursor')) : null;
  if (params.has('cursor') && !cursor) return botError(400, 'invalid_request', 'cursor must be a positive signup id.');

  const orbat = await prisma.orbat.findUnique({ where: { id: orbatId }, select: { id: true, name: true } });
  if (!orbat) return botError(404, 'not_found', 'ORBAT not found.', { orbatId });

  const rows = await prisma.signup.findMany({
    where: { slot: { orbatId } },
    include: {
      user: {
        include: {
          accounts: { select: { provider: true, providerUserId: true } },
          userRank: { include: { currentRank: { select: { id: true, name: true, abbreviation: true } } } },
        },
      },
      slot: { include: { squad: { select: { id: true, name: true } }, squadRole: { select: { name: true } } } },
    },
    orderBy: { id: 'asc' },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: limit,
  });

  const signups = rows.map((signup) => ({
    signupId: signup.id,
    userId: signup.userId,
    username: signup.user.username,
    discordUserId: signup.user.accounts.find((account) => account.provider === 'discord')?.providerUserId ?? null,
    steamId: signup.user.accounts.find((account) => account.provider === 'steam')?.providerUserId ?? null,
    rank: signup.user.userRank?.currentRank ?? null,
    slotId: signup.slotId,
    slotName: signup.slot.squadRole?.name ?? 'Unknown',
    squadId: signup.slot.squad.id,
    squadName: signup.slot.squad.name,
    createdAt: signup.createdAt.toISOString(),
  }));
  return NextResponse.json({
    orbatId: orbat.id,
    orbatName: orbat.name,
    signups,
    nextCursor: signups.length === limit ? String(signups.at(-1)!.signupId) : null,
  });
}
