import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; prerequisiteId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, prerequisiteId } = await params;
  const trainingId = Number(id);
  const requiredTrainingId = Number(prerequisiteId);

  if (isNaN(trainingId) || isNaN(requiredTrainingId)) {
    return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });
  }

  const existing = await prisma.trainingTrainingRequirement.findUnique({
    where: {
      trainingId_requiredTrainingId: {
        trainingId,
        requiredTrainingId,
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Prerequisite not found' }, { status: 404 });
  }

  await prisma.trainingTrainingRequirement.delete({
    where: {
      trainingId_requiredTrainingId: {
        trainingId,
        requiredTrainingId,
      },
    },
  });

  return NextResponse.json({ success: true });
}
