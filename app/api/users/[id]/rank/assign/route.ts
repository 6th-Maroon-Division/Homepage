// app/api/users/[id]/rank/assign/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const userId = parseInt(id);
    if (isNaN(userId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rankId } = await request.json();
    if (!rankId || isNaN(parseInt(String(rankId)))) {
      return NextResponse.json({ error: 'rankId required' }, { status: 400 });
    }

    const rank = await prisma.rank.findUnique({ where: { id: Number(rankId) } });
    if (!rank) return NextResponse.json({ error: 'Rank not found' }, { status: 404 });

    const attendanceTotal = await prisma.attendance.count({
      where: { userId, status: 'present', orbat: { isMainOp: true } },
    });

    const existing = await prisma.userRank.findUnique({ where: { userId } });
    const previousRankName = existing?.currentRankId
      ? (await prisma.rank.findUnique({ where: { id: existing.currentRankId } }))?.name || null
      : null;

    if (existing) {
      await prisma.userRank.update({
        where: { userId },
        data: {
          currentRankId: rank.id,
          lastRankedUpAt: new Date(),
          attendanceSinceLastRank: attendanceTotal,
        },
      });
    } else {
      await prisma.userRank.create({
        data: {
          userId,
          currentRankId: rank.id,
          lastRankedUpAt: new Date(),
          attendanceSinceLastRank: attendanceTotal,
        },
      });
    }

    await prisma.rankHistory.create({
      data: {
        userId,
        previousRankName: previousRankName,
        newRankName: rank.name,
        attendanceTotalAtChange: attendanceTotal,
        attendanceDeltaSinceLastRank: Math.max(0, attendanceTotal - (existing?.attendanceSinceLastRank || 0)),
        triggeredBy: 'admin',
        triggeredByUserId: session.user.id,
        outcome: 'approved',
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error assigning rank:', error);
    return NextResponse.json({ error: 'Failed to assign rank' }, { status: 500 });
  }
}
