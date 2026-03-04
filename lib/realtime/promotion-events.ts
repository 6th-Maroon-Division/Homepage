import { nextEventId, publishToChannel, subscribeToChannel } from '@/lib/realtime/event-hub';

export type PromotionEvent = {
  id: string;
  type: 'promotions.updated';
  occurredAt: string;
  payload?: Record<string, unknown>;
};

type PromotionEventListener = (event: PromotionEvent) => void;

const PROMOTIONS_CHANNEL = 'promotions';
const PROMOTIONS_SCOPE = 'queue';

export function publishPromotionEvent(payload?: Record<string, unknown>): PromotionEvent {
  const event: PromotionEvent = {
    id: nextEventId(PROMOTIONS_CHANNEL),
    type: 'promotions.updated',
    occurredAt: new Date().toISOString(),
    payload,
  };

  publishToChannel(PROMOTIONS_CHANNEL, PROMOTIONS_SCOPE, event);

  return event;
}

export function subscribePromotionEvents(listener: PromotionEventListener): () => void {
  return subscribeToChannel(PROMOTIONS_CHANNEL, PROMOTIONS_SCOPE, listener);
}
