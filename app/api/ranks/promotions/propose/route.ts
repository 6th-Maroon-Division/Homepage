import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkRankupEligibility } from '@/lib/rank-eligibility';
import { checkPermission } from '@/lib/auth-middleware';
import { getSuperAdminUserIds } from '@/lib/permission-utils';
import { publishInboxEvents } from '@/lib/realtime/inbox-events';
import { publishPromotionEvent } from '@/lib/realtime/promotion-events';

async function notifyAdminsOfProposal(userId: number, nextRankName: string) {
  const adminUserIds = await getSuperAdminUserIds();
  if (!adminUserIds.length) return;

  const message = await prisma.message.create({
    data: {
      title: 'New Rankup Proposal',
      body: `User ${userId} is eligible for ${nextRankName}`,
      type: 'rankup',
      actionUrl: '/admin/promotions',
    },
  });

  await prisma.messageRecipient.createMany({
    data: adminUserIds.map((recipientUserId) => ({
      messageId: message.id,
      userId: recipientUserId,
      audienceType: 'admin',
      audienceValue: null,
      isRead: false,
      channel: 'web',
    })),
  });

  publishInboxEvents(adminUserIds);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const hasPermission = await checkPermission(session.user.id, 'rank:manage_promotions');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const { userId } = await request.json();
    if (!userId || isNaN(Number(userId))) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const eligibility = await checkRankupEligibility(Number(userId));
    if (!eligibility.eligible) {
      return NextResponse.json({ error: eligibility.reason, details: eligibility }, { status: 400 });
    }

    // Auto-eligible: apply immediately without proposal
    if (eligibility.reason === 'eligible_auto' && eligibility.nextRank) {
      const existingRank = await prisma.userRank.findUnique({ where: { userId: Number(userId) } });
      const previousAttendance = existingRank?.attendanceSinceLastRank || 0;

      await prisma.$transaction(async (tx) => {
        await tx.userRank.update({
          where: { userId: Number(userId) },
          data: {
            currentRankId: eligibility.nextRank!.id,
            lastRankedUpAt: new Date(),
            attendanceSinceLastRank: eligibility.attendance.currentAttendance,
          },
        });

        await tx.rankHistory.create({
          data: {
            userId: Number(userId),
            previousRankName: eligibility.currentRank?.name || null,
            newRankName: eligibility.nextRank!.name,
            attendanceTotalAtChange: eligibility.attendance.currentAttendance,
            attendanceDeltaSinceLastRank: Math.max(
              0,
              eligibility.attendance.currentAttendance - previousAttendance
            ),
            triggeredBy: 'auto',
            triggeredByUserId: session.user.id,
            outcome: 'approved',
          },
        });
      });

      return NextResponse.json({ success: true, autoRanked: true, nextRank: eligibility.nextRank });
    }

    if (!eligibility.nextRank) {
      return NextResponse.json({ error: 'No next rank found' }, { status: 400 });
    }

    // If a pending proposal already exists, return it
    if (eligibility.proposalId) {
      const existing = await prisma.promotionProposal.findUnique({ where: { id: eligibility.proposalId } });
      return NextResponse.json({ proposal: existing, alreadyPending: true });
    }

    const proposal = await prisma.promotionProposal.create({
      data: {
        userId: Number(userId),
        currentRankId: eligibility.currentRank!.id,
        nextRankId: eligibility.nextRank.id,
        attendanceTotalAtProposal: eligibility.attendance.currentAttendance,
        attendanceDeltaSinceLastRank: eligibility.attendance.delta,
        status: 'pending',
      },
    });

    publishPromotionEvent({ source: 'proposal.created', proposalId: proposal.id });

    await notifyAdminsOfProposal(Number(userId), eligibility.nextRank.name);

    return NextResponse.json({ proposal });
  } catch (error) {
    console.error('Error proposing promotion:', error);
    return NextResponse.json({ error: 'Failed to propose promotion' }, { status: 500 });
  }
}