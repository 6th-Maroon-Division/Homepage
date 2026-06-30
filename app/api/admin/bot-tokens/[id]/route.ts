import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';

// GET /api/admin/bot-tokens/[id] - Get a specific bot token (masked)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'system:super_admin');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const token = await prisma.botToken.findUnique({
      where: { id: parseInt(id) },
      include: {
        createdBy: {
          select: { id: true, username: true },
        },
      },
    });

    if (!token) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    // Return masked token (without the actual token value)
    return NextResponse.json({
      id: token.id,
      name: token.name,
      isActive: token.isActive,
      createdAt: token.createdAt,
      lastUsedAt: token.lastUsedAt,
      createdBy: token.createdBy,
    });
  } catch (error) {
    console.error('Error fetching bot token:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bot token' },
      { status: 500 }
    );
  }
}

// PUT /api/admin/bot-tokens/[id] - Update a bot token (toggle active status, rename)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'system:super_admin');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { name, isActive } = body;

    // Validate inputs
    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
      return NextResponse.json(
        { error: 'Name must be a non-empty string' },
        { status: 400 }
      );
    }

    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return NextResponse.json(
        { error: 'isActive must be a boolean' },
        { status: 400 }
      );
    }

    const existingToken = await prisma.botToken.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingToken) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    const updatedToken = await prisma.botToken.update({
      where: { id: parseInt(id) },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return NextResponse.json({
      success: true,
      token: {
        id: updatedToken.id,
        name: updatedToken.name,
        isActive: updatedToken.isActive,
        createdAt: updatedToken.createdAt,
        lastUsedAt: updatedToken.lastUsedAt,
      },
    });
  } catch (error) {
    console.error('Error updating bot token:', error);
    return NextResponse.json(
      { error: 'Failed to update bot token' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/bot-tokens/[id] - Delete a bot token
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hasPermission = await checkPermission(session.user.id, 'system:super_admin');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { id } = await params;

    const existingToken = await prisma.botToken.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existingToken) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    await prisma.botToken.delete({
      where: { id: parseInt(id) },
    });

    return NextResponse.json({
      success: true,
      message: 'Bot token deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting bot token:', error);
    return NextResponse.json(
      { error: 'Failed to delete bot token' },
      { status: 500 }
    );
  }
}
