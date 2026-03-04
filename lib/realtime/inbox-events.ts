export type InboxEvent = {
  id: string;
  type: 'inbox.updated';
  userId: number;
  occurredAt: string;
  payload?: Record<string, unknown>;
};

type InboxEventListener = (event: InboxEvent) => void;

type InboxStore = {
  listenersByUserId: Map<number, Set<InboxEventListener>>;
  sequence: number;
};

declare global {
  var __inboxRealtimeStore: InboxStore | undefined;
}

function getStore(): InboxStore {
  if (!globalThis.__inboxRealtimeStore) {
    globalThis.__inboxRealtimeStore = {
      listenersByUserId: new Map(),
      sequence: 0,
    };
  }

  return globalThis.__inboxRealtimeStore;
}

export function publishInboxEvent(userId: number, payload?: Record<string, unknown>): InboxEvent {
  const store = getStore();
  store.sequence += 1;

  const event: InboxEvent = {
    id: `${Date.now()}-${store.sequence}`,
    type: 'inbox.updated',
    userId,
    occurredAt: new Date().toISOString(),
    payload,
  };

  const listeners = store.listenersByUserId.get(userId);
  if (listeners) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  return event;
}

export function publishInboxEvents(userIds: number[], payload?: Record<string, unknown>) {
  const uniqueUserIds = Array.from(new Set(userIds));
  for (const userId of uniqueUserIds) {
    publishInboxEvent(userId, payload);
  }
}

export function subscribeInboxEvents(userId: number, listener: InboxEventListener): () => void {
  const store = getStore();
  const listeners = store.listenersByUserId.get(userId) ?? new Set<InboxEventListener>();
  listeners.add(listener);
  store.listenersByUserId.set(userId, listeners);

  return () => {
    const next = store.listenersByUserId.get(userId);
    if (!next) {
      return;
    }

    next.delete(listener);
    if (next.size === 0) {
      store.listenersByUserId.delete(userId);
    }
  };
}
