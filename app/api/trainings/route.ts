import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNullablePositiveInteger(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function hasTrainingPermission(userId: number, permission: 'training:create') {
  const [hasSpecificPermission, isSuperAdmin] = await Promise.all([
    checkPermission(userId, permission),
    checkPermission(userId, 'system:super_admin'),
  ]);
  return hasSpecificPermission || isSuperAdmin;
}

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
    if (categoryId !== null) {
      const parsedCategoryId = parseNullablePositiveInteger(categoryId);
      if (parsedCategoryId === undefined || parsedCategoryId === null) {
        return NextResponse.json({ error: 'Invalid categoryId' }, { status: 400 });
      }
      where.categoryId = parsedCategoryId;
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
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const hasPermission = await hasTrainingPermission(Number(session.user.id), 'training:create');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden - Admin access required' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!isJsonObject(body)) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }

    if (typeof body.name !== 'string' || !body.name.trim()) {
      return NextResponse.json({ error: 'Training name is required' }, { status: 400 });
    }

    if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
      return NextResponse.json({ error: 'description must be a string or null' }, { status: 400 });
    }
    const categoryId = parseNullablePositiveInteger(body.categoryId);
    if (categoryId === undefined) {
      return NextResponse.json({ error: 'categoryId must be a positive integer or null' }, { status: 400 });
    }
    const duration = parseNullablePositiveInteger(body.duration);
    if (duration === undefined || (duration !== null && duration > 1440)) {
      return NextResponse.json({ error: 'duration must be between 1 and 1440 minutes or null' }, { status: 400 });
    }
    for (const field of ['isActive', 'requiresTrainingSession', 'requiresOrbatQualification'] as const) {
      if (body[field] !== undefined && typeof body[field] !== 'boolean') {
        return NextResponse.json({ error: `${field} must be a boolean` }, { status: 400 });
      }
    }
    if (
      body.orbatQualificationNotes !== undefined
      && body.orbatQualificationNotes !== null
      && typeof body.orbatQualificationNotes !== 'string'
    ) {
      return NextResponse.json({ error: 'orbatQualificationNotes must be a string or null' }, { status: 400 });
    }

    const training = await prisma.training.create({
      data: {
        name: body.name.trim(),
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        categoryId,
        duration,
        isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
        requiresTrainingSession: typeof body.requiresTrainingSession === 'boolean' ? body.requiresTrainingSession : true,
        requiresOrbatQualification: typeof body.requiresOrbatQualification === 'boolean'
          ? body.requiresOrbatQualification
          : false,
        orbatQualificationNotes: typeof body.orbatQualificationNotes === 'string'
          ? body.orbatQualificationNotes.trim() || null
          : null,
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
