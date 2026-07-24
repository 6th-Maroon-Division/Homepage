// app/api/users/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await checkPermission(session.user.id, 'user:manage');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    // Prevent self-modification
    if (userId === session.user.id) {
      return NextResponse.json(
        { error: 'Cannot modify your own account' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { avatarUrl, username } = body as { avatarUrl?: string | null; username?: string };

    const updateData: { avatarUrl?: string | null; username?: string } = {};

    if (Object.prototype.hasOwnProperty.call(body, 'avatarUrl')) {
      updateData.avatarUrl = avatarUrl ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'username')) {
      const normalizedUsername = typeof username === 'string' ? username.trim() : '';

      if (!normalizedUsername) {
        return NextResponse.json({ error: 'Username is required' }, { status: 400 });
      }

      if (normalizedUsername.length > 50) {
        return NextResponse.json({ error: 'Username must be 50 characters or fewer' }, { status: 400 });
      }

      updateData.username = normalizedUsername;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Update allowed fields
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const hasPermission = await checkPermission(session.user.id, 'user:manage');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    // Prevent self-deletion
    if (userId === session.user.id) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
        { status: 400 }
      );
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        _count: {
          select: {
            orbats: true,
            signups: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [trainingAuditReferences, authoredTrainingMessages] = await Promise.all([
      prisma.trainingRequest.count({
        where: {
          OR: [
            { userId },
            { handledByAdminId: userId },
            { assignedTrainerId: userId },
          ],
        },
      }),
      prisma.trainingRequestMessage.count({ where: { senderId: userId } }),
    ]);
    if (trainingAuditReferences > 0 || authoredTrainingMessages > 0) {
      return NextResponse.json(
        { error: 'This user has training audit records. Merge the account instead of deleting it.' },
        { status: 409 },
      );
    }

    // Delete users only when no durable training audit would be lost.
    // Note: ORBATs are NOT deleted due to the relation constraint.
    await prisma.user.delete({
      where: { id: userId },
    });

    return NextResponse.json({
      success: true,
      message: `User deleted. ${user._count.signups} signups removed. ${user._count.orbats} OrbATs remain.`,
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
