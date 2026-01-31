import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; trainingId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, trainingId } = await params;
  const rankId = Number(id);
  const parsedTrainingId = Number(trainingId);

  if (isNaN(rankId) || isNaN(parsedTrainingId)) {
    return NextResponse.json({ error: 'Invalid IDs' }, { status: 400 });
  }

  const transition = await prisma.rankTransitionRequirement.findUnique({
    where: { targetRankId: rankId },
    include: { requiredTrainings: true },
  });

  if (!transition) {
    return NextResponse.json({ error: 'No transition requirements found' }, { status: 404 });
  }

  await prisma.rankTransitionRequirement.update({
    where: { targetRankId: rankId },
    data: {
      requiredTrainings: {
        disconnect: { id: parsedTrainingId },
      },
    },
  });

  return NextResponse.json({ success: true });
}
