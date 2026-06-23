import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { NextResponse, NextRequest } from 'next/server';
import { checkPermission } from '@/lib/auth-middleware';

// PUT /api/training-categories/[id] - Update a category (admin only)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  const hasPermission = await checkPermission(session.user.id, 'training:edit');
  if (!hasPermission) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const categoryId = parseInt(id);
    const body = await request.json();
    const { name, orderIndex, swapWithCategoryId } = body;

    // If this is a swap operation, use a transaction
    if (swapWithCategoryId !== undefined) {
      const swapWithId = parseInt(swapWithCategoryId);
      
      // Get both categories
      const [category, swapWithCategory] = await Promise.all([
        prisma.trainingCategory.findUnique({ where: { id: categoryId } }),
        prisma.trainingCategory.findUnique({ where: { id: swapWithId } }),
      ]);

      if (!category || !swapWithCategory) {
        return NextResponse.json(
          { error: 'One or both categories not found' },
          { status: 404 }
        );
      }

      // Swap their orderIndex values using a transaction
      const [updated1, updated2] = await prisma.$transaction([
        prisma.trainingCategory.update({
          where: { id: categoryId },
          data: { orderIndex: swapWithCategory.orderIndex },
        }),
        prisma.trainingCategory.update({
          where: { id: swapWithId },
          data: { orderIndex: category.orderIndex },
        }),
      ]);

      return NextResponse.json({ message: 'Categories swapped', updated: [updated1, updated2] });
    }

    // Regular update (name or orderIndex)
    const updateData: Record<string, string | number> = {};
    
    if (name !== undefined) {
      updateData.name = name.trim();
    }
    
    if (orderIndex !== undefined) {
      updateData.orderIndex = orderIndex;
    }

    const category = await prisma.trainingCategory.update({
      where: { id: categoryId },
      data: updateData,
    });

    return NextResponse.json(category);
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }
    console.error('Error updating category:', error);
    return NextResponse.json(
      { error: 'Failed to update category' },
      { status: 500 }
    );
  }
}

// DELETE /api/training-categories/[id] - Delete a category (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }
  
  const hasPermission = await checkPermission(session.user.id, 'training:delete');
  if (!hasPermission) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const categoryId = parseInt(id);

    // Remove category from trainings and delete it
    await prisma.$transaction([
      prisma.training.updateMany({
        where: { categoryId },
        data: { categoryId: null },
      }),
      prisma.trainingCategory.delete({
        where: { id: categoryId },
      }),
    ]);

    return NextResponse.json({ message: 'Category deleted successfully' });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }
    console.error('Error deleting category:', error);
    return NextResponse.json(
      { error: 'Failed to delete category' },
      { status: 500 }
    );
  }
}
