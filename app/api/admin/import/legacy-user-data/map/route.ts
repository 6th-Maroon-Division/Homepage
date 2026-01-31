// app/api/admin/import/legacy-user-data/map/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// POST - Bulk map legacy records to current users
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { mappings } = body as { mappings: Array<{ legacyId: number; userId: number }> };

    if (!Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json({ error: 'Invalid mappings array' }, { status: 400 });
    }

    // Validate all user IDs exist
    const userIds = mappings.map((m) => m.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true },
    });

    if (users.length !== userIds.length) {
      return NextResponse.json({ error: 'Some user IDs are invalid' }, { status: 400 });
    }

    // Update mappings in transaction
    await prisma.$transaction(
      mappings.map((mapping) =>
        prisma.legacyUserData.update({
          where: { id: mapping.legacyId },
          data: {
            mappedUserId: mapping.userId,
            isMapped: true,
          },
        })
      )
    );

    return NextResponse.json({
      success: true,
      mapped: mappings.length,
    });
  } catch (error) {
    console.error('Failed to map legacy user data:', error);
    return NextResponse.json({ error: 'Failed to map legacy user data' }, { status: 500 });
  }
}
