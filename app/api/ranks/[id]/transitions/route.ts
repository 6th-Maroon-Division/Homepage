import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const rankId = Number(id);
  if (isNaN(rankId)) {
    return NextResponse.json({ error: 'Invalid rank ID' }, { status: 400 });
  }

  const transitions = await prisma.rankTransitionRequirement.findUnique({
    where: { targetRankId: rankId },
    include: {
      requiredTrainings: {
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    requiredTrainings: transitions?.requiredTrainings || [],
  });
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
  const rankId = Number(id);
  if (isNaN(rankId)) {
    return NextResponse.json({ error: 'Invalid rank ID' }, { status: 400 });
  }

  const { trainingId } = await request.json();
  if (!trainingId || isNaN(Number(trainingId))) {
    return NextResponse.json({ error: 'trainingId required' }, { status: 400 });
  }

  const [rank, training] = await Promise.all([
    prisma.rank.findUnique({ where: { id: rankId } }),
    prisma.training.findUnique({ where: { id: Number(trainingId) } }),
  ]);

  if (!rank) {
    return NextResponse.json({ error: 'Rank not found' }, { status: 404 });
  }
  if (!training) {
    return NextResponse.json({ error: 'Training not found' }, { status: 404 });
  }

  // Get or create the transition requirement
  const transition = await prisma.rankTransitionRequirement.upsert({
    where: { targetRankId: rankId },
    create: {
      targetRankId: rankId,
      requiredTrainings: {
        connect: { id: Number(trainingId) },
      },
    },
    update: {
      requiredTrainings: {
        connect: { id: Number(trainingId) },
      },
    },
    include: {
      requiredTrainings: {
        select: {
          id: true,
          name: true,
          category: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({ transition });
}
