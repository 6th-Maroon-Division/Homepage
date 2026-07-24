import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { isTrainingStaff } from '@/lib/training-staff';
import { Prisma } from '@/generated/prisma/client';

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (typeof normalized === 'string' && !/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNullablePositiveInteger(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return parsePositiveInteger(value) ?? undefined;
}

async function hasTrainingPermission(
  userId: number,
  permission: 'training:edit' | 'training:delete',
) {
  const [hasSpecificPermission, isSuperAdmin] = await Promise.all([
    checkPermission(userId, permission),
    checkPermission(userId, 'system:super_admin'),
  ]);
  return hasSpecificPermission || isSuperAdmin;
}

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
    const trainingId = parsePositiveInteger(id);
    if (!trainingId) {
      return NextResponse.json({ error: 'Invalid training id' }, { status: 400 });
    }
    const viewerId = Number(session.user.id);
    const staffViewer = await isTrainingStaff(viewerId);

    const training = await prisma.training.findUnique({
      where: { id: trainingId },
      include: {
        userTrainings: {
          where: staffViewer ? undefined : { userId: viewerId, isHidden: false },
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
          where: staffViewer ? undefined : { userId: viewerId },
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
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const hasPermission = await hasTrainingPermission(Number(session.user.id), 'training:edit');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    const trainingId = parsePositiveInteger(id);
    if (!trainingId) {
      return NextResponse.json({ error: 'Invalid training id' }, { status: 400 });
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

    const data: {
      name?: string;
      description?: string | null;
      categoryId?: number | null;
      duration?: number | null;
      isActive?: boolean;
      requiresTrainingSession?: boolean;
      requiresOrbatQualification?: boolean;
      orbatQualificationNotes?: string | null;
    } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return NextResponse.json({ error: 'Training name cannot be empty' }, { status: 400 });
      }
      data.name = body.name.trim();
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== 'string') {
        return NextResponse.json({ error: 'description must be a string or null' }, { status: 400 });
      }
      data.description = typeof body.description === 'string' ? body.description.trim() || null : null;
    }
    if (body.categoryId !== undefined) {
      const categoryId = parseNullablePositiveInteger(body.categoryId);
      if (categoryId === undefined) {
        return NextResponse.json({ error: 'categoryId must be a positive integer or null' }, { status: 400 });
      }
      data.categoryId = categoryId;
    }
    if (body.duration !== undefined) {
      const duration = parseNullablePositiveInteger(body.duration);
      if (duration === undefined || (duration !== null && duration > 1440)) {
        return NextResponse.json({ error: 'duration must be between 1 and 1440 minutes or null' }, { status: 400 });
      }
      data.duration = duration;
    }
    for (const field of ['isActive', 'requiresTrainingSession', 'requiresOrbatQualification'] as const) {
      if (body[field] !== undefined) {
        if (typeof body[field] !== 'boolean') {
          return NextResponse.json({ error: `${field} must be a boolean` }, { status: 400 });
        }
        data[field] = body[field];
      }
    }
    if (body.orbatQualificationNotes !== undefined) {
      if (body.orbatQualificationNotes !== null && typeof body.orbatQualificationNotes !== 'string') {
        return NextResponse.json({ error: 'orbatQualificationNotes must be a string or null' }, { status: 400 });
      }
      data.orbatQualificationNotes = typeof body.orbatQualificationNotes === 'string'
        ? body.orbatQualificationNotes.trim() || null
        : null;
    }

    const existing = await prisma.training.findUnique({ where: { id: trainingId }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Training not found' }, { status: 404 });
    }

    const training = await prisma.training.update({
      where: { id: trainingId },
      data,
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
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const hasPermission = await hasTrainingPermission(Number(session.user.id), 'training:delete');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    const trainingId = parsePositiveInteger(id);
    if (!trainingId) {
      return NextResponse.json({ error: 'Invalid training id' }, { status: 400 });
    }

    const training = await prisma.training.findUnique({
      where: { id: trainingId },
      select: { id: true, _count: { select: { trainingSessions: true } } },
    });
    if (!training) {
      return NextResponse.json({ error: 'Training not found' }, { status: 404 });
    }
    if (training._count.trainingSessions > 0) {
      return NextResponse.json(
        { error: 'Training cannot be deleted because it has scheduled or historical sessions. Deactivate it instead.' },
        { status: 409 },
      );
    }

    await prisma.training.delete({
      where: { id: trainingId },
    });

    return NextResponse.json({ message: 'Training deleted successfully' });
  } catch (error) {
    console.error('Error deleting training:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return NextResponse.json({ error: 'Training not found' }, { status: 404 });
      }
      if (error.code === 'P2003') {
        return NextResponse.json(
          { error: 'Training cannot be deleted while related records still reference it. Deactivate it instead.' },
          { status: 409 },
        );
      }
    }
    return NextResponse.json({ error: 'Failed to delete training' }, { status: 500 });
  }
}
