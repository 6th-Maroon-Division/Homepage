import type { Prisma } from '@/generated/prisma/client';
import { publishInboxEvents } from '@/lib/realtime/inbox-events';
import { safeSessionPublish } from './training-session-contract';
export type SessionNotifications = { messageId: number; recipientUserIds: number[] }[];
export async function createSessionNotification(input: { recipientUserIds: number[]; title: string; body: string; actionUrl?: string | null; createdById?: number | null }, tx: Prisma.TransactionClient, notifications: SessionNotifications) {
  const recipientUserIds = [...new Set(input.recipientUserIds)];
  if (!recipientUserIds.length) return;
  const message = await tx.message.create({ data: { title: input.title, body: input.body, type: 'training', actionUrl: input.actionUrl ?? null, createdById: input.createdById ?? null } });
  await tx.messageRecipient.createMany({ data: recipientUserIds.map(userId => ({ messageId: message.id, userId, audienceType: 'user' as const, channel: 'web' as const })), skipDuplicates: true });
  notifications.push({ messageId: message.id, recipientUserIds });
}
export function publishSessionNotifications(notifications: SessionNotifications) {
  for (const item of notifications) safeSessionPublish(() => publishInboxEvents(item.recipientUserIds, { source: 'training.notification', messageId: item.messageId }));
}
