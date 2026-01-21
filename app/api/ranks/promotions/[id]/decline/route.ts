import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { getCurrentAttendance } from '@/lib/rank-eligibility';

export async function POST(
  request: NextRequest,
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

  const { declineReason } = await request.json().catch(() => ({ declineReason: null }));

  const [currentRank, nextRank, userRank] = await Promise.all([
    prisma.rank.findUnique({ where: { id: proposal.currentRankId } }),
    prisma.rank.findUnique({ where: { id: proposal.nextRankId } }),
    prisma.userRank.findUnique({ where: { userId: proposal.userId } }),
  ]);

  if (!userRank) {
    return NextResponse.json({ error: 'User rank record missing' }, { status: 400 });
  }

  const currentAttendance = await getCurrentAttendance(proposal.userId);

  await prisma.$transaction(async (tx) => {
    await tx.promotionProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'declined',
        attendanceTotalAtProposal: currentAttendance,
        attendanceDeltaSinceLastRank: Math.max(0, currentAttendance - userRank.attendanceSinceLastRank),
      },
    });

    await tx.userRank.update({
      where: { userId: proposal.userId },
      data: {
        attendanceSinceLastRank: currentAttendance,
      },
    });

    await tx.rankHistory.create({
      data: {
        userId: proposal.userId,
        previousRankName: currentRank?.name || null,
        newRankName: nextRank?.name || 'Unknown',
        attendanceTotalAtChange: currentAttendance,
        attendanceDeltaSinceLastRank: Math.max(0, currentAttendance - userRank.attendanceSinceLastRank),
        triggeredBy: 'admin_manual',
        triggeredByUserId: session.user.id,
        outcome: 'declined',
        declineReason: declineReason || null,
      },
    });
  });

  await prisma.message.create({
    data: {
      title: 'Rank Proposal Declined',
      body: declineReason ? `Proposal declined: ${declineReason}` : 'Your rankup proposal was declined.',
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