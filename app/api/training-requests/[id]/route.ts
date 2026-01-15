import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// PUT /api/training-requests/[id] - Update training request status (admin only)
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
    const requestId = parseInt(id);
    const body = await request.json();
    const { status, adminResponse } = body;

    if (!status || !['approved', 'rejected', 'completed', 'pending'].includes(status)) {
      return NextResponse.json({ error: 'Valid status is required' }, { status: 400 });
    }

    // If approving, create a UserTraining record
    if (status === 'approved' || status === 'completed') {
      const trainingRequest = await prisma.trainingRequest.findUnique({
        where: { id: requestId },
      });

      if (!trainingRequest) {
        return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
      }

      // Use transaction to ensure both operations succeed
      const [updatedRequest] = await prisma.$transaction([
        prisma.trainingRequest.update({
          where: { id: requestId },
          data: {
            status,
            adminResponse,
            handledByAdminId: session.user.id,
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
            handledByAdmin: {
              select: {
                id: true,
                username: true,
                avatarUrl: true,
              },
            },
          },
        }),
        // Create UserTraining if it doesn't exist
        prisma.userTraining.upsert({
          where: {
            userId_trainingId: {
              userId: trainingRequest.userId,
              trainingId: trainingRequest.trainingId,
            },
          },
          create: {
            userId: trainingRequest.userId,
            trainingId: trainingRequest.trainingId,
            notes: `Approved from request: ${adminResponse || 'No notes'}`,
          },
          update: {},
        }),
      ]);

      return NextResponse.json({
        ...updatedRequest,
        requestedAt: updatedRequest.requestedAt.toISOString(),
        updatedAt: updatedRequest.updatedAt.toISOString(),
        training: {
          ...updatedRequest.training,
          createdAt: updatedRequest.training.createdAt.toISOString(),
          updatedAt: updatedRequest.training.updatedAt.toISOString(),
        },
        handledByAdmin: updatedRequest.handledByAdmin
          ? {
              ...updatedRequest.handledByAdmin,
            }
          : null,
      });
    } else {
      // For rejected or pending status, just update the request
      const updatedRequest = await prisma.trainingRequest.update({
        where: { id: requestId },
        data: {
          status,
          adminResponse,
          handledByAdminId: status === 'pending' ? null : session.user.id,
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
          handledByAdmin: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      });

      return NextResponse.json({
        ...updatedRequest,
        requestedAt: updatedRequest.requestedAt.toISOString(),
        updatedAt: updatedRequest.updatedAt.toISOString(),
        training: {
          ...updatedRequest.training,
          createdAt: updatedRequest.training.createdAt.toISOString(),
          updatedAt: updatedRequest.training.updatedAt.toISOString(),
        },
        handledByAdmin: updatedRequest.handledByAdmin
          ? {
              ...updatedRequest.handledByAdmin,
            }
          : null,
      });
    }
  } catch (error: any) {
    console.error('Error updating training request:', error);
    
    // Handle Prisma "record not found" error
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
    }
    
    return NextResponse.json({ error: 'Failed to update training request' }, { status: 500 });
  }
}

// DELETE /api/training-requests/[id] - Delete training request
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const requestId = parseInt(id);

    // Check if user owns this request or is admin
    const trainingRequest = await prisma.trainingRequest.findUnique({
      where: { id: requestId },
    });

    if (!trainingRequest) {
      return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
    }

    if (trainingRequest.userId !== session.user.id && !session.user.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await prisma.trainingRequest.delete({
      where: { id: requestId },
    });

    return NextResponse.json({ message: 'Training request deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting training request:', error);
    
    // Handle Prisma "record not found" error
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Training request not found' }, { status: 404 });
    }
    
    return NextResponse.json({ error: 'Failed to delete training request' }, { status: 500 });
  }
}
