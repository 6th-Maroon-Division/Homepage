export type OrbatEventType =
  | 'orbat.created'
  | 'orbat.updated'
  | 'orbat.deleted'
  | 'signup.created'
  | 'signup.deleted'
  | 'signup.moved';

export type OrbatEventVisibility = 'public' | 'staff';

export type OrbatEvent = {
  id: string;
  type: OrbatEventType;
  orbatId: number;
  occurredAt: string;
  visibility: OrbatEventVisibility;
  actorUserId: number | null;
  payload?: Record<string, unknown>;
};

type OrbatEventInput = {
  type: OrbatEventType;
  orbatId: number;
  visibility?: OrbatEventVisibility;
  actorUserId?: number | null;
  payload?: Record<string, unknown>;
};

type OrbatEventListener = (event: OrbatEvent) => void;

type RealtimeStore = {
  listeners: Set<OrbatEventListener>;
  sequence: number;
};

declare global {
  var __orbatRealtimeStore: RealtimeStore | undefined;
}

function getStore(): RealtimeStore {
  if (!globalThis.__orbatRealtimeStore) {
    globalThis.__orbatRealtimeStore = {
      listeners: new Set(),
      sequence: 0,
    };
  }

  return globalThis.__orbatRealtimeStore;
}

export function publishOrbatEvent(input: OrbatEventInput): OrbatEvent {
  const store = getStore();
  store.sequence += 1;

  const event: OrbatEvent = {
    id: `${Date.now()}-${store.sequence}`,
    type: input.type,
    orbatId: input.orbatId,
    occurredAt: new Date().toISOString(),
    visibility: input.visibility ?? 'public',
    actorUserId: input.actorUserId ?? null,
    payload: input.payload,
  };

  for (const listener of store.listeners) {
    listener(event);
  }

  return event;
}

export function subscribeOrbatEvents(listener: OrbatEventListener): () => void {
  const store = getStore();
  store.listeners.add(listener);

  return () => {
    store.listeners.delete(listener);
  };
}

export function toPublicOrbatEvent(event: OrbatEvent) {
  if (event.visibility !== 'public') {
    return null;
  }

  return {
    id: event.id,
    type: event.type,
    orbatId: event.orbatId,
    occurredAt: event.occurredAt,
    payload: event.payload ?? null,
  };
}
