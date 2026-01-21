import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getCurrentAttendance } from '@/lib/rank-eligibility';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const proposalId = Number(id);
  if (isNaN(proposalId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const proposal = await prisma.promotionProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: 'Proposal is not pending' }, { status: 400 });
  }

  const [currentRank, nextRank, userRank] = await Promise.all([
    prisma.rank.findUnique({ where: { id: proposal.currentRankId } }),
    prisma.rank.findUnique({ where: { id: proposal.nextRankId } }),
    prisma.userRank.findUnique({ where: { userId: proposal.userId } }),
  ]);

  if (!nextRank) {
    return NextResponse.json({ error: 'Next rank missing' }, { status: 400 });
  }
  if (!userRank) {
    return NextResponse.json({ error: 'User rank record missing' }, { status: 400 });
  }

  const currentAttendance = await getCurrentAttendance(proposal.userId);
  const previousAttendance = userRank.attendanceSinceLastRank;

  await prisma.$transaction(async (tx) => {
    await tx.userRank.update({
      where: { userId: proposal.userId },
      data: {
        currentRankId: nextRank.id,
        lastRankedUpAt: new Date(),
        attendanceSinceLastRank: currentAttendance,
      },
    });

    await tx.promotionProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'approved',
        attendanceTotalAtProposal: currentAttendance,
        attendanceDeltaSinceLastRank: Math.max(0, currentAttendance - previousAttendance),
      },
    });

    await tx.rankHistory.create({
      data: {
        userId: proposal.userId,
        previousRankName: currentRank?.name || null,
        newRankName: nextRank.name,
        attendanceTotalAtChange: currentAttendance,
        attendanceDeltaSinceLastRank: Math.max(0, currentAttendance - previousAttendance),
        triggeredBy: 'admin_manual',
        triggeredByUserId: session.user.id,
        outcome: 'approved',
      },
    });
  });

  await prisma.message.create({
    data: {
      title: 'Rank Approved',
      body: `You have been promoted to ${nextRank.name}.`,
      type: 'rankup',
      actionUrl: null,
      createdById: session.user.id,
      recipients: {
        create: {
          userId: proposal.userId,
          audienceType: 'user',
          audienceValue: null,
          isRead: false,
          channel: 'web',
        },
      },
    },
  });

  return NextResponse.json({ success: true });
}