import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    );
  }

  try {
    const trainings = await prisma.training.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const serialized = trainings.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      categoryId: t.categoryId,
      duration: t.duration,
      isActive: t.isActive,
    }));

    return NextResponse.json(serialized);
  } catch (error) {
    console.error('Error fetching trainings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trainings' },
      { status: 500 }
    );
  }
}
