import { nextEventId, publishToChannel, subscribeToChannel } from '@/lib/realtime/event-hub';

export type InboxEvent = {
  id: string;
  type: 'inbox.updated';
  userId: number;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

type InboxEventListener = (event: InboxEvent) => void;

const INBOX_CHANNEL = 'inbox';

export function publishInboxEvent(userId: number, payload?: Record<string, unknown>): InboxEvent {
  const event: InboxEvent = {
    id: nextEventId(INBOX_CHANNEL),
    type: 'inbox.updated',
    userId,
    occurredAt: new Date().toISOString(),
    payload,
  };

  publishToChannel(INBOX_CHANNEL, userId, event);

  return event;
}

export function publishInboxEvents(userIds: number[], payload?: Record<string, unknown>) {
  const uniqueUserIds = Array.from(new Set(userIds));
  for (const userId of uniqueUserIds) {
    publishInboxEvent(userId, payload);
  }
}

export function subscribeInboxEvents(userId: number, listener: InboxEventListener): () => void {
  return subscribeToChannel(INBOX_CHANNEL, userId, listener);
}
