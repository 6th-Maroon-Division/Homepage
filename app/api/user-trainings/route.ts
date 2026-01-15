import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// GET /api/user-trainings - Get user trainings (for current user or specific user if admin)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userIdParam = searchParams.get('userId');
    const includeHidden = searchParams.get('includeHidden') === 'true';

    // Determine which user's trainings to fetch
    let userId: number;
    if (userIdParam && session.user.isAdmin) {
      userId = parseInt(userIdParam);
    } else {
      userId = session.user.id;
    }

    const where: { userId: number; isHidden?: boolean } = { userId };
    if (!includeHidden && !session.user.isAdmin) {
      where.isHidden = false;
    }

    const userTrainings = await prisma.userTraining.findMany({
      where,
      include: {
        training: true,
      },
      orderBy: { assignedAt: 'desc' },
    });

    // Serialize dates
    const serialized = userTrainings.map((ut) => ({
      ...ut,
      completedAt: ut.completedAt.toISOString(),
      assignedAt: ut.assignedAt.toISOString(),
      training: {
        ...ut.training,
        createdAt: ut.training.createdAt.toISOString(),
        updatedAt: ut.training.updatedAt.toISOString(),
      },
    }));

    return NextResponse.json(serialized, {
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Error fetching user trainings:', error);
    return NextResponse.json({ error: 'Failed to fetch user trainings' }, { status: 500 });
  }
}

// POST /api/user-trainings - Assign training to user (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { userId, trainingId, notes, isHidden, needsRetraining } = body;

    if (!userId || !trainingId) {
      return NextResponse.json({ error: 'userId and trainingId are required' }, { status: 400 });
    }

    // Check if already assigned
    const existing = await prisma.userTraining.findUnique({
      where: {
        userId_trainingId: {
          userId: parseInt(userId),
          trainingId: parseInt(trainingId),
        },
      },
    });

    if (existing) {
      return NextResponse.json({ error: 'Training already assigned to this user' }, { status: 400 });
    }

    const userTraining = await prisma.userTraining.create({
      data: {
        userId: parseInt(userId),
        trainingId: parseInt(trainingId),
        needsRetraining: needsRetraining ?? false,
        notes,
        isHidden: isHidden ?? false,
      },
      include: {
        training: true,
        user: {
          select: {
            id: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });

    return NextResponse.json({
      ...userTraining,
      completedAt: userTraining.completedAt.toISOString(),
      assignedAt: userTraining.assignedAt.toISOString(),
      training: {
        ...userTraining.training,
        createdAt: userTraining.training.createdAt.toISOString(),
        updatedAt: userTraining.training.updatedAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error assigning training:', error);
    return NextResponse.json({ error: 'Failed to assign training' }, { status: 500 });
  }
}
