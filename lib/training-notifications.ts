import { prisma } from '@/lib/prisma';
import { publishInboxEvents } from '@/lib/realtime/inbox-events';

type TrainingNotificationInput = {
  recipientUserIds: number[];
  title: string;
  body: string;
  actionUrl?: string | null;
  createdById?: number | null;
};

type DiscordDeliveryResult =
  | { delivered: true }
  | { delivered: false; reason: 'not_configured' | 'not_linked' | 'request_failed' };

export async function createTrainingNotification(input: TrainingNotificationInput) {
  const recipientUserIds = Array.from(new Set(input.recipientUserIds.filter(Number.isInteger)));
  if (recipientUserIds.length === 0) {
    return null;
  }

  try {
    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: {
          title: input.title,
          body: input.body,
          type: 'training',
          actionUrl: input.actionUrl ?? null,
          // Training coordinators are deliberately anonymous to requesters.
          // Do not let the generic inbox expose the actor through createdBy.
          createdById: null,
        },
      });

      await tx.messageRecipient.createMany({
        data: recipientUserIds.map((userId) => ({
          messageId: created.id,
          userId,
          audienceType: 'user' as const,
          channel: 'web' as const,
        })),
        skipDuplicates: true,
      });

      return created;
    });

    publishInboxEvents(recipientUserIds, {
      source: 'training.notification',
      messageId: message.id,
    });

    return message;
  } catch (error) {
    // Notification delivery must never turn an already-committed workflow
    // mutation into an apparent API failure.
    console.error('Failed to create training notification:', error);
    return null;
  }
}

export async function sendDiscordTrainingDm(
  userId: number,
  content: string,
): Promise<DiscordDeliveryResult> {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) {
    return { delivered: false, reason: 'not_configured' };
  }

  const account = await prisma.authAccount.findFirst({
    where: { userId, provider: 'discord' },
    select: { providerUserId: true },
  });

  if (!account) {
    return { delivered: false, reason: 'not_linked' };
  }

  try {
    const channelResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: account.providerUserId }),
      signal: AbortSignal.timeout(5000),
    });

    if (!channelResponse.ok) {
      return { delivered: false, reason: 'request_failed' };
    }

    const channel = (await channelResponse.json()) as { id?: string };
    if (!channel.id) {
      return { delivered: false, reason: 'request_failed' };
    }

    const messageResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: content.slice(0, 2000) }),
      signal: AbortSignal.timeout(5000),
    });

    return messageResponse.ok
      ? { delivered: true }
      : { delivered: false, reason: 'request_failed' };
  } catch {
    return { delivered: false, reason: 'request_failed' };
  }
}
