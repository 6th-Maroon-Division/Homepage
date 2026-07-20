import { nextEventId, publishToChannel, subscribeToChannel } from '@/lib/realtime/event-hub';

export type TrainingChatEvent = {
  id: string;
  type: 'training.chat.updated';
  requestId: number;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

type TrainingChatEventListener = (event: TrainingChatEvent) => void;

const TRAINING_CHAT_CHANNEL = 'training-chat';
const TRAINING_STAFF_SCOPE = 'staff';

export function publishTrainingChatEvent(
  requestId: number,
  payload?: Record<string, unknown>,
): TrainingChatEvent {
  const event: TrainingChatEvent = {
    id: nextEventId(TRAINING_CHAT_CHANNEL),
    type: 'training.chat.updated',
    requestId,
    occurredAt: new Date().toISOString(),
    payload,
  };

  publishToChannel(TRAINING_CHAT_CHANNEL, requestId, event);
  publishToChannel(TRAINING_CHAT_CHANNEL, TRAINING_STAFF_SCOPE, event);
  return event;
}

export function subscribeTrainingChatEvents(
  requestId: number,
  listener: TrainingChatEventListener,
) {
  return subscribeToChannel(TRAINING_CHAT_CHANNEL, requestId, listener);
}

export function subscribeTrainingStaffChatEvents(listener: TrainingChatEventListener) {
  return subscribeToChannel(TRAINING_CHAT_CHANNEL, TRAINING_STAFF_SCOPE, listener);
}
