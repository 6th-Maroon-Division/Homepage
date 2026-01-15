import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/attendance/legacy-data?skip=0&take=50&search=
 * Get paginated legacy attendance data for mapping
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized - admin access required' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const isMapped = searchParams.get('isMapped'); // null, 'true', 'false'

    // Build filter
    const where: Record<string, unknown> = {};

    if (search) {
      where.legacyName = {
        contains: search,
        mode: 'insensitive',
      };
    }

    // Only add isMapped filter if explicitly provided (not null)
    if (isMapped !== null) {
      where.isMapped = isMapped === 'true';
    }

    const data = await prisma.legacyAttendanceData.findMany({
      where,
      orderBy: { legacyName: 'asc' },
      include: {
        mappedUser: {
          select: { id: true, username: true, email: true, avatarUrl: true },
        },
      },
    });

    return NextResponse.json({
      data,
      total: data.length,
    });
  } catch (error) {
    console.error('Legacy data fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch legacy data' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/attendance/legacy-data
 * Update user mapping for a legacy record
 */
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized - admin access required' },
      { status: 401 }
    );
  }

  try {
    const { legacyDataId, mappedUserId } = await request.json();

    if (!legacyDataId) {
      return NextResponse.json(
        { error: 'Missing legacyDataId' },
        { status: 400 }
      );
    }

    // Verify the legacy record exists
    const legacyRecord = await prisma.legacyAttendanceData.findUnique({
      where: { id: legacyDataId },
    });

    if (!legacyRecord) {
      return NextResponse.json(
        { error: 'Legacy record not found' },
        { status: 404 }
      );
    }

    // If user mapping provided, verify user exists
    if (mappedUserId) {
      const user = await prisma.user.findUnique({
        where: { id: mappedUserId },
      });
      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
    }

    // Update mapping (legacy only maps to user, not signup)
    const updated = await prisma.legacyAttendanceData.update({
      where: { id: legacyDataId },
      data: {
        mappedUserId: mappedUserId || null,
        isMapped: !!mappedUserId,
      },
      include: {
        mappedUser: {
          select: { id: true, username: true, email: true },
        },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Legacy data update error:', error);
    return NextResponse.json(
      { error: 'Failed to update legacy data mapping' },
      { status: 500 }
    );
  }
}
