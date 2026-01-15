import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

// GET /api/trainings - Get all trainings (with optional filtering)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('activeOnly') === 'true';
    const categoryId = searchParams.get('categoryId');

    const where: { isActive?: boolean; categoryId?: number } = {};
    if (activeOnly) {
      where.isActive = true;
    }
    if (categoryId) {
      where.categoryId = parseInt(categoryId);
    }

    const trainings = await prisma.training.findMany({
      where,
      include: {
        _count: {
          select: {
            userTrainings: true,
            trainingRequests: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Serialize dates
    const serializedTrainings = trainings.map((training) => ({
      ...training,
      createdAt: training.createdAt.toISOString(),
      updatedAt: training.updatedAt.toISOString(),
    }));

    return NextResponse.json(serializedTrainings);
  } catch (error) {
    console.error('Error fetching trainings:', error);
    return NextResponse.json({ error: 'Failed to fetch trainings' }, { status: 500 });
  }
}

// POST /api/trainings - Create a new training (admin only)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.isAdmin) {
      return NextResponse.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, categoryId, duration, isActive } = body;

    if (!name) {
      return NextResponse.json({ error: 'Training name is required' }, { status: 400 });
    }

    const training = await prisma.training.create({
      data: {
        name,
        description,
        categoryId: categoryId ? parseInt(categoryId) : null,
        duration: duration ? parseInt(duration) : null,
        isActive: isActive ?? true,
      },
    });

    return NextResponse.json({
      ...training,
      createdAt: training.createdAt.toISOString(),
      updatedAt: training.updatedAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating training:', error);
    return NextResponse.json({ error: 'Failed to create training' }, { status: 500 });
  }
}
