import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const trainingId = Number(id);
  if (isNaN(trainingId)) {
    return NextResponse.json({ error: 'Invalid training ID' }, { status: 400 });
  }

  const training = await prisma.training.findUnique({
    where: { id: trainingId },
    include: {
      rankRequirement: {
        include: {
          minimumRank: true,
        },
      },
      requiresTrainings: {
        include: {
          requiredTraining: {
            select: {
              id: true,
              name: true,
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!training) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }

  const requirements = {
    minimumRank: training.rankRequirement?.minimumRank || null,
    requiredTrainings: training.requiresTrainings.map((r) => r.requiredTraining),
  };

  return NextResponse.json({ requirements });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const trainingId = Number(id);
  if (isNaN(trainingId)) {
    return NextResponse.json({ error: 'Invalid training ID' }, { status: 400 });
  }

  const { minimumRankId } = await request.json();
  if (!minimumRankId || isNaN(Number(minimumRankId))) {
    return NextResponse.json({ error: 'minimumRankId required' }, { status: 400 });
  }

  const training = await prisma.training.findUnique({ where: { id: trainingId } });
  if (!training) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }

  const rank = await prisma.rank.findUnique({ where: { id: Number(minimumRankId) } });
  if (!rank) {
    return NextResponse.json({ error: 'Rank not found' }, { status: 404 });
  }

  const requirement = await prisma.trainingRankRequirement.upsert({
    where: { trainingId },
    create: {
      trainingId,
      minimumRankId: Number(minimumRankId),
    },
    update: {
      minimumRankId: Number(minimumRankId),
    },
    include: {
      minimumRank: true,
    },
  });

  return NextResponse.json({ requirement });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const trainingId = Number(id);
  if (isNaN(trainingId)) {
    return NextResponse.json({ error: 'Invalid training ID' }, { status: 400 });
  }

  const existing = await prisma.trainingRankRequirement.findUnique({ where: { trainingId } });
  if (!existing) {
    return NextResponse.json({ error: 'No rank requirement found' }, { status: 404 });
  }

  await prisma.trainingRankRequirement.delete({ where: { trainingId } });

  return NextResponse.json({ success: true });
}
