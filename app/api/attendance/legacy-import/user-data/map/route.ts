// app/api/attendance/legacy-import/user-data/map/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

/**
 * PUT /api/attendance/legacy-import/user-data/map
 * Update user mapping for legacy user data records
 */
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized - admin access required' },
      { status: 401 }
    );
  }

  const hasPermission = await checkPermission(session.user.id, 'system:super_admin');
  if (!hasPermission) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    );
  }

  try {
    const { legacyUserDataId, mappedUserId } = await request.json();

    if (!legacyUserDataId) {
      return NextResponse.json(
        { error: 'Missing legacyUserDataId' },
        { status: 400 }
      );
    }

    // Verify the legacy record exists
    const legacyRecord = await prisma.legacyUserData.findUnique({
      where: { id: legacyUserDataId },
    });

    if (!legacyRecord) {
      return NextResponse.json(
        { error: 'Legacy user data record not found' },
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

    // Update mapping
    const updated = await prisma.legacyUserData.update({
      where: { id: legacyUserDataId },
      data: {
        mappedUserId: mappedUserId || null,
        isMapped: !!mappedUserId,
      },
      include: {
        mappedUser: {
          select: { id: true, username: true },
        },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Legacy user data mapping error:', error);
    return NextResponse.json(
      { error: 'Failed to update legacy user data mapping' },
      { status: 500 }
    );
  }
}