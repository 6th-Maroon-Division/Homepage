import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    const hasPermission = await checkPermission(session.user.id, 'orbat:edit');
    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const orbatId = parseInt(id);

    // Get all signups for this ORBAT
    const signups = await prisma.signup.findMany({
      where: {
        slot: {
          orbatId,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        slot: {
          select: {
            id: true,
            orderIndex: true,
            squadRole: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        user: {
          username: 'asc',
        },
      },
    });

    return NextResponse.json(signups);
  } catch (error) {
    console.error('Error fetching signups:', error);
    return NextResponse.json(
      { error: 'Failed to fetch signups' },
      { status: 500 }
    );
  }
}
