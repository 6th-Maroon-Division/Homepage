import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.isAdmin) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const orbatId = parseInt(id);

    // Get all signups for this ORBAT
    const signups = await prisma.signup.findMany({
      where: {
        subslot: {
          slot: {
            orbatId,
          },
        },
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        subslot: {
          select: {
            name: true,
            slot: {
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
