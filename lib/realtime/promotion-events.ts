export type PromotionEvent = {
  id: string;
  type: 'promotions.updated';
  occurredAt: string;
  payload?: Record<string, unknown>;
};

type PromotionEventListener = (event: PromotionEvent) => void;

type PromotionStore = {
  listeners: Set<PromotionEventListener>;
  sequence: number;
};

declare global {
  var __promotionRealtimeStore: PromotionStore | undefined;
}

function getStore(): PromotionStore {
  if (!globalThis.__promotionRealtimeStore) {
    globalThis.__promotionRealtimeStore = {
      listeners: new Set(),
      sequence: 0,
    };
  }

  return globalThis.__promotionRealtimeStore;
}

export function publishPromotionEvent(payload?: Record<string, unknown>): PromotionEvent {
  const store = getStore();
  store.sequence += 1;

  const event: PromotionEvent = {
    id: `${Date.now()}-${store.sequence}`,
    type: 'promotions.updated',
    occurredAt: new Date().toISOString(),
    payload,
  };

  for (const listener of store.listeners) {
    listener(event);
  }

  return event;
}

export function subscribePromotionEvents(listener: PromotionEventListener): () => void {
  const store = getStore();
  store.listeners.add(listener);

  return () => {
    store.listeners.delete(listener);
  };
}
