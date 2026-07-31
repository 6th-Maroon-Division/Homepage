// app/api/users/[id]/rank/assign/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/auth-middleware';
import { publishUserProfileEvent } from '@/lib/realtime/user-events';
import { getCurrentAttendance } from '@/lib/rank-eligibility';
import { appendBotEvent } from '@/lib/bot-events';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const hasPermission = await checkPermission(session.user.id, 'rank:manage_promotions');
  if (!hasPermission) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const userId = parseInt(id);
    if (isNaN(userId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const { rankId } = await request.json();
    if (!rankId || isNaN(parseInt(String(rankId)))) {
      return NextResponse.json({ error: 'rankId required' }, { status: 400 });
    }

    const rank = await prisma.rank.findUnique({ where: { id: Number(rankId) } });
    if (!rank) return NextResponse.json({ error: 'Rank not found' }, { status: 404 });

    const attendanceTotal = await getCurrentAttendance(userId);

    const existing = await prisma.userRank.findUnique({ where: { userId } });
    const previousRankName = existing?.currentRankId
      ? (await prisma.rank.findUnique({ where: { id: existing.currentRankId } }))?.name || null
      : null;

    await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.userRank.update({
        where: { userId },
        data: {
          currentRankId: rank.id,
          lastRankedUpAt: new Date(),
          attendanceSinceLastRank: attendanceTotal,
        },
      });
      } else {
        await tx.userRank.create({
        data: {
          userId,
          currentRankId: rank.id,
          lastRankedUpAt: new Date(),
          attendanceSinceLastRank: attendanceTotal,
        },
      });
      }

      const history = await tx.rankHistory.create({
      data: {
        userId,
        previousRankName: previousRankName,
        newRankName: rank.name,
        attendanceTotalAtChange: attendanceTotal,
        attendanceDeltaSinceLastRank: Math.max(0, attendanceTotal - (existing?.attendanceSinceLastRank || 0)),
        triggeredBy: 'admin',
        triggeredByUserId: session.user.id,
        outcome: 'approved',
      },
      });
      const discord = await tx.authAccount.findFirst({ where: { userId, provider: 'discord' }, select: { providerUserId: true } });
      await appendBotEvent({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: history.id, payload: {
        rankHistoryId: history.id, userId, discordUserId: discord?.providerUserId ?? null,
        oldRankId: existing?.currentRankId ?? null, newRankId: rank.id, changeType: 'assignment', source: 'direct_assignment',
      } }, tx);
    });

    publishUserProfileEvent(userId, {
      source: 'rank.assigned',
      rankId: rank.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error assigning rank:', error);
    return NextResponse.json({ error: 'Failed to assign rank' }, { status: 500 });
  }
}
