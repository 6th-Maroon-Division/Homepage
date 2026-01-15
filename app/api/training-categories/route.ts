import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

// GET /api/training-categories - List all categories
export async function GET() {
  try {
    const categories = await prisma.trainingCategory.findMany({
      orderBy: { orderIndex: 'asc' },
    });

    return NextResponse.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

// POST /api/training-categories - Create a new category (admin only)
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized - Admin access required' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || name.trim() === '') {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }

    // Get the highest orderIndex to add new category at the end
    const lastCategory = await prisma.trainingCategory.findFirst({
      orderBy: { orderIndex: 'desc' },
    });

    const category = await prisma.trainingCategory.create({
      data: {
        name: name.trim(),
        orderIndex: (lastCategory?.orderIndex ?? -1) + 1,
      },
    });

    return NextResponse.json(category);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json(
        { error: 'Category already exists' },
        { status: 400 }
      );
    }
    console.error('Error creating category:', error);
    return NextResponse.json(
      { error: 'Failed to create category' },
      { status: 500 }
    );
  }
}
