import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

const PAGE_SIZE = 20;

// GET /api/users/[id]/rank-history - Get paginated rank history for a user
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const userId = parseInt(id);

    // Check if user is viewing their own history or if they're an admin
    if (session.user.id !== userId && !session.user.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get query parameters for pagination
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get total count of rank history entries
    const totalCount = await prisma.rankHistory.count({
      where: { userId },
    });

    // Get paginated rank history
    const rankHistory = await prisma.rankHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        previousRankName: true,
        newRankName: true,
        attendanceTotalAtChange: true,
        attendanceDeltaSinceLastRank: true,
        triggeredBy: true,
        outcome: true,
        declineReason: true,
        createdAt: true,
      },
    });

    const serialized = rankHistory.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt.toISOString(),
    }));

    return NextResponse.json({
      data: serialized,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total: totalCount,
        totalPages: Math.ceil(totalCount / PAGE_SIZE),
      },
    });
  } catch (error) {
    console.error('Error fetching rank history:', error);
    return NextResponse.json({ error: 'Failed to fetch rank history' }, { status: 500 });
  }
}
