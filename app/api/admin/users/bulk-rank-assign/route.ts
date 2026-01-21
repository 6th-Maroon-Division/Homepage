import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userIds, rankId } = await request.json();
  if (!Array.isArray(userIds) || !rankId || isNaN(Number(rankId))) {
    return NextResponse.json({ error: 'userIds (array) and rankId required' }, { status: 400 });
  }

  const rank = await prisma.rank.findUnique({ where: { id: Number(rankId) } });
  if (!rank) {
    return NextResponse.json({ error: 'Rank not found' }, { status: 404 });
  }

  const attendanceData = await prisma.attendance.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _count: { id: true },
  });

  const attendanceMap = new Map(attendanceData.map((a) => [a.userId, a._count.id]));

  await prisma.$transaction(
    userIds.map((userId) =>
      prisma.userRank.upsert({
        where: { userId },
        update: {
          currentRankId: rank.id,
          lastRankedUpAt: new Date(),
          attendanceSinceLastRank: attendanceMap.get(userId) || 0,
        },
        create: {
          userId,
          currentRankId: rank.id,
          lastRankedUpAt: new Date(),
          attendanceSinceLastRank: attendanceMap.get(userId) || 0,
        },
      })
    )
  );

  return NextResponse.json({ success: true, assignedCount: userIds.length });
}
