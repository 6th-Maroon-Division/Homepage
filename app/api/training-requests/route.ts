import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// GET /api/training-requests - Get training requests (user sees their own, admin sees all)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');

    type WhereClause = {
      userId?: number;
      status?: 'pending' | 'approved' | 'rejected' | 'completed';
    };

    const where: WhereClause = {};
    
    // Non-admin users only see their own requests
    if (!session.user.isAdmin) {
      where.userId = session.user.id;
    }

    // Filter by status if provided
    if (statusParam && ['pending', 'approved', 'rejected', 'completed'].includes(statusParam)) {
      where.status = statusParam as WhereClause['status'];
    }

    const trainingRequests = await prisma.trainingRequest.findMany({
      where,
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
      orderBy: { requestedAt: 'desc' },
    });

    // Serialize dates
    const serialized = trainingRequests.map((tr) => ({
      ...tr,
      requestedAt: tr.requestedAt.toISOString(),
      updatedAt: tr.updatedAt.toISOString(),
      training: {
        ...tr.training,
        createdAt: tr.training.createdAt.toISOString(),
        updatedAt: tr.training.updatedAt.toISOString(),
      },
      handledByAdmin: tr.handledByAdmin
        ? {
            ...tr.handledByAdmin,
          }
        : null,
    }));

    return NextResponse.json(serialized, {
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Error fetching training requests:', error);
    return NextResponse.json({ error: 'Failed to fetch training requests' }, { status: 500 });
  }
}

// POST /api/training-requests - Create a new training request
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { trainingId, requestMessage } = body;

    if (!trainingId) {
      return NextResponse.json({ error: 'trainingId is required' }, { status: 400 });
    }

    // Check if user already has this training
    const existingTraining = await prisma.userTraining.findUnique({
      where: {
        userId_trainingId: {
          userId: session.user.id,
          trainingId: parseInt(trainingId),
        },
      },
    });

    if (existingTraining) {
      return NextResponse.json({ error: 'You already have this training' }, { status: 400 });
    }

    // Check if there's already a pending request
    const existingRequest = await prisma.trainingRequest.findFirst({
      where: {
        userId: session.user.id,
        trainingId: parseInt(trainingId),
        status: 'pending',
      },
    });

    if (existingRequest) {
      return NextResponse.json({ error: 'You already have a pending request for this training' }, { status: 400 });
    }

    const trainingRequest = await prisma.trainingRequest.create({
      data: {
        userId: session.user.id,
        trainingId: parseInt(trainingId),
        requestMessage,
      },
      include: {
        training: true,
      },
    });

    return NextResponse.json({
      ...trainingRequest,
      requestedAt: trainingRequest.requestedAt.toISOString(),
      updatedAt: trainingRequest.updatedAt.toISOString(),
      training: {
        ...trainingRequest.training,
        createdAt: trainingRequest.training.createdAt.toISOString(),
        updatedAt: trainingRequest.training.updatedAt.toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating training request:', error);
    return NextResponse.json({ error: 'Failed to create training request' }, { status: 500 });
  }
}
