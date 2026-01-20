// app/api/ranks/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const rankId = parseInt(id);
    if (isNaN(rankId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const body = await request.json();
    const {
      name,
      abbreviation,
      orderIndex,
      attendanceRequiredSinceLastRank,
      autoRankupEnabled,
    } = body;

    const rank = await prisma.rank.update({
      where: { id: rankId },
      data: {
        ...(name && { name }),
        ...(abbreviation && { abbreviation }),
        ...(typeof orderIndex === 'number' && { orderIndex }),
        attendanceRequiredSinceLastRank:
          attendanceRequiredSinceLastRank === null || attendanceRequiredSinceLastRank === undefined
            ? null
            : attendanceRequiredSinceLastRank,
        ...(typeof autoRankupEnabled === 'boolean' && { autoRankupEnabled }),
      },
    });
    return NextResponse.json({ rank });
  } catch (error) {
    console.error('Error updating rank:', error);
    return NextResponse.json({ error: 'Failed to update rank' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const rankId = parseInt(id);
    if (isNaN(rankId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const assignedCount = await prisma.userRank.count({ where: { currentRankId: rankId } });
    if (assignedCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete rank: users are currently assigned' },
        { status: 400 }
      );
    }

    await prisma.rank.delete({ where: { id: rankId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting rank:', error);
    return NextResponse.json({ error: 'Failed to delete rank' }, { status: 500 });
  }
}
