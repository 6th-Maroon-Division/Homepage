import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const proposals = await prisma.promotionProposal.findMany({
    where: { status: 'pending' },
    include: {
      user: { select: { id: true, username: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const rankIds = Array.from(new Set(proposals.flatMap((p) => [p.currentRankId, p.nextRankId])));
  const ranks = await prisma.rank.findMany({ where: { id: { in: rankIds } } });
  const rankMap = new Map(ranks.map((r) => [r.id, r]));

  const payload = proposals.map((p) => ({
    ...p,
    currentRank: rankMap.get(p.currentRankId) || null,
    nextRank: rankMap.get(p.nextRankId) || null,
  }));

  return NextResponse.json({ proposals: payload });
}