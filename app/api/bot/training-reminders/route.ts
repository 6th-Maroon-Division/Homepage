import { NextRequest, NextResponse } from 'next/server';
import { validateBotTokenLegacy } from '@/lib/bot-token-validation';
import { prisma } from '@/lib/prisma';
import {
  createTrainingNotification,
  sendDiscordTrainingDm,
} from '@/lib/training-notifications';

export const dynamic = 'force-dynamic';

/**
 * Deliver the 24-hour session reminders. The deployment scheduler or existing
 * bot can call this endpoint periodically with the normal bot bearer token.
 * Per-attendee claims make repeated or overlapping invocations idempotent.
 */
export async function POST(request: NextRequest) {
  if (!(await validateBotTokenLegacy(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const attendees = await prisma.trainingSessionAttendee.findMany({
    where: {
      reminder24hSentAt: null,
      status: { in: ['scheduled', 'attended'] },
      session: {
        status: 'scheduled',
        startsAt: { gt: now, lte: reminderCutoff },
      },
    },
    include: {
      session: {
        include: {
          training: { select: { name: true } },
          trainer: { select: { username: true } },
        },
      },
      trainingRequest: {
        select: {
          id: true,
          subscriptions: {
            where: { discordEnabled: true },
            select: { userId: true },
          },
        },
      },
    },
    orderBy: [{ session: { startsAt: 'asc' } }, { id: 'asc' }],
  });

  let delivered = 0;
  let discordDelivered = 0;
  for (const attendee of attendees) {
    const claimedAt = new Date();
    const claim = await prisma.trainingSessionAttendee.updateMany({
      where: { id: attendee.id, reminder24hSentAt: null },
      data: { reminder24hSentAt: claimedAt },
    });
    if (claim.count !== 1 || !attendee.session.startsAt) continue;

    const startsAt = attendee.session.startsAt.toLocaleString('en-GB', {
      timeZone: 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const trainer = attendee.session.trainer?.username
      ? ` with ${attendee.session.trainer.username}`
      : '';
    const body = `${attendee.session.training.name}${trainer} starts at ${startsAt} UTC on the Arma3 Training Server.`;
    const actionUrl = attendee.trainingRequest
      ? `/trainings/requests/${attendee.trainingRequest.id}`
      : '/profile?tab=trainings';
    const notification = await createTrainingNotification({
      recipientUserIds: [attendee.userId],
      title: `Training starts within 24 hours`,
      body,
      actionUrl,
    });

    if (!notification) {
      // Release only our own claim so a later scheduler invocation can retry.
      await prisma.trainingSessionAttendee.updateMany({
        where: { id: attendee.id, reminder24hSentAt: claimedAt },
        data: { reminder24hSentAt: null },
      });
      continue;
    }

    delivered += 1;
    const discordEnabled = attendee.trainingRequest?.subscriptions.some(
      (subscription) => subscription.userId === attendee.userId,
    ) ?? false;
    if (discordEnabled) {
      const discordResult = await sendDiscordTrainingDm(
        attendee.userId,
        `Training reminder: ${body}`,
      );
      if (discordResult.delivered) discordDelivered += 1;
    }
  }

  return NextResponse.json({
    scanned: attendees.length,
    delivered,
    discordDelivered,
    windowEndsAt: reminderCutoff.toISOString(),
  });
}
