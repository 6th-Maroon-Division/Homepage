import { NextRequest, NextResponse } from 'next/server';
import { authenticateDatabaseBot, botError, parsePositiveId } from '@/lib/bot-api';
import { prisma } from '@/lib/prisma';

type Context = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, route: Context) {
  if (!(await authenticateDatabaseBot(request))) return botError(401, 'unauthorized', 'Invalid or revoked bot token.');
  const userId = parsePositiveId((await route.params).userId);
  if (!userId) return botError(400, 'invalid_request', 'Invalid user id.');
  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit')) || 50, 1), 100);
  const cursor = parsePositiveId(params.get('cursor'));
  const exists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!exists) return botError(404, 'not_found', 'User not found.');
  const history = await prisma.rankHistory.findMany({
    where: { userId, ...(cursor ? { id: { lt: cursor } } : {}) }, orderBy: { id: 'desc' }, take: limit,
  });
  return NextResponse.json({ history, nextCursor: history.length === limit ? history.at(-1)!.id : null });
}
