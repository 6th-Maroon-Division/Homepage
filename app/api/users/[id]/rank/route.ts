// app/api/users/[id]/rank/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = parseInt(id);
    if (isNaN(userId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const userRank = await prisma.userRank.findUnique({
      where: { userId },
      include: { currentRank: true },
    });
    if (!userRank) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const attendanceTotal = await prisma.attendance.count({
      where: { userId, status: 'present', orbat: { isMainOp: true } },
    });
    const delta = attendanceTotal - (userRank.attendanceSinceLastRank || 0);

    return NextResponse.json({
      userId,
      currentRank: userRank.currentRank,
      retired: userRank.retired,
      interviewDone: userRank.interviewDone,
      attendanceSinceLastRank: userRank.attendanceSinceLastRank,
      attendanceTotal,
      attendanceDelta: delta,
      lastRankedUpAt: userRank.lastRankedUpAt,
    });
  } catch (error) {
    console.error('Error fetching user rank:', error);
    return NextResponse.json({ error: 'Failed to fetch user rank' }, { status: 500 });
  }
}
