import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const { id } = await params;

  if (!session?.user?.isAdmin) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    );
  }

  try {
    const userTrainings = await prisma.userTraining.findMany({
      where: { userId: parseInt(id) },
      include: { training: true },
      orderBy: { completedAt: 'desc' },
    });

    const serialized = userTrainings.map((ut) => ({
      id: ut.id,
      trainingId: ut.trainingId,
      trainingName: ut.training.name,
      needsRetraining: ut.needsRetraining,
      isHidden: ut.isHidden,
      notes: ut.notes,
      completedAt: ut.completedAt.toISOString(),
      assignedAt: ut.assignedAt.toISOString(),
    }));

    return NextResponse.json(serialized);
  } catch (error) {
    console.error('Error fetching user trainings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user trainings' },
      { status: 500 }
    );
  }
}
