import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// GET /api/trainings/[id] - Get a specific training with details
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const trainingId = parseInt(id);

    const training = await prisma.training.findUnique({
      where: { id: trainingId },
      include: {
        userTrainings: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        },
        trainingRequests: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: { requestedAt: 'desc' },
        },
      },
    });

    if (!training) {
      return NextResponse.json({ error: 'Training not found' }, { status: 404 });
    }

    // Serialize dates
    const serializedTraining = {
      ...training,
      createdAt: training.createdAt.toISOString(),
      updatedAt: training.updatedAt.toISOString(),
      userTrainings: training.userTrainings.map((ut) => ({
        ...ut,
        completedAt: ut.completedAt.toISOString(),
        assignedAt: ut.assignedAt.toISOString(),
      })),
      trainingRequests: training.trainingRequests.map((tr) => ({
        ...tr,
        requestedAt: tr.requestedAt.toISOString(),
        updatedAt: tr.updatedAt.toISOString(),
      })),
    };

    return NextResponse.json(serializedTraining);
  } catch (error) {
    console.error('Error fetching training:', error);
    return NextResponse.json({ error: 'Failed to fetch training' }, { status: 500 });
  }
}

// PUT /api/trainings/[id] - Update a training (admin only)
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const { id } = await context.params;
    const trainingId = parseInt(id);
    const body = await request.json();
    const { name, description, categoryId, duration, isActive } = body;

    const training = await prisma.training.update({
      where: { id: trainingId },
      data: {
        name,
        description,
        categoryId: categoryId ? parseInt(categoryId) : null,
        duration: duration ? parseInt(duration) : null,
        isActive,
      },
    });

    return NextResponse.json({
      ...training,
      createdAt: training.createdAt.toISOString(),
      updatedAt: training.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error('Error updating training:', error);
    return NextResponse.json({ error: 'Failed to update training' }, { status: 500 });
  }
}

// DELETE /api/trainings/[id] - Delete a training (admin only)
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const { id } = await context.params;
    const trainingId = parseInt(id);

    // Delete will cascade to UserTraining and TrainingRequest due to Prisma schema
    await prisma.training.delete({
      where: { id: trainingId },
    });

    return NextResponse.json({ message: 'Training deleted successfully' });
  } catch (error) {
    console.error('Error deleting training:', error);
    return NextResponse.json({ error: 'Failed to delete training' }, { status: 500 });
  }
}
