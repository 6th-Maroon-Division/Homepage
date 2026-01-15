import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// PUT /api/user-trainings/[id] - Update user training (admin only)
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
    const userTrainingId = parseInt(id);
    const body = await request.json();
    const { notes, isHidden, needsRetraining } = body;

    const userTraining = await prisma.userTraining.update({
      where: { id: userTrainingId },
      data: {
        needsRetraining,
        notes,
        isHidden,
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
    });
  } catch (error) {
    console.error('Error updating user training:', error);
    return NextResponse.json({ error: 'Failed to update user training' }, { status: 500 });
  }
}

// DELETE /api/user-trainings/[id] - Remove training from user (admin only)
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
    const userTrainingId = parseInt(id);

    await prisma.userTraining.delete({
      where: { id: userTrainingId },
    });

    return NextResponse.json({ message: 'Training removed from user successfully' });
  } catch (error) {
    console.error('Error removing user training:', error);
    return NextResponse.json({ error: 'Failed to remove user training' }, { status: 500 });
  }
}
