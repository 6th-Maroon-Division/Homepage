type EventListener<TEvent> = (event: TEvent) => void;

type RealtimeHubStore = {
  listenersByChannel: Map<string, Map<string, Set<EventListener<unknown>>>>;
  sequenceByChannel: Map<string, number>;
};

declare global {
  var __realtimeHubStore: RealtimeHubStore | undefined;
}

function getStore(): RealtimeHubStore {
  if (!globalThis.__realtimeHubStore) {
    globalThis.__realtimeHubStore = {
      listenersByChannel: new Map(),
      sequenceByChannel: new Map(),
    };
  }

  return globalThis.__realtimeHubStore;
}

function getScopeKey(scope: string | number) {
  return String(scope);
}

export function nextEventId(channel: string) {
  const store = getStore();
  const next = (store.sequenceByChannel.get(channel) ?? 0) + 1;
  store.sequenceByChannel.set(channel, next);
  return `${Date.now()}-${next}`;
}

export function publishToChannel<TEvent>(channel: string, scope: string | number, event: TEvent) {
  const store = getStore();
  const channelListeners = store.listenersByChannel.get(channel);
  if (!channelListeners) {
    return;
  }

  const listeners = channelListeners.get(getScopeKey(scope));
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    (listener as EventListener<TEvent>)(event);
  }
}

export function subscribeToChannel<TEvent>(
  channel: string,
  scope: string | number,
  listener: EventListener<TEvent>
) {
  const store = getStore();
  const scopeKey = getScopeKey(scope);

  const channelListeners = store.listenersByChannel.get(channel) ?? new Map();
  const listeners = channelListeners.get(scopeKey) ?? new Set<EventListener<unknown>>();

  listeners.add(listener as EventListener<unknown>);
  channelListeners.set(scopeKey, listeners);
  store.listenersByChannel.set(channel, channelListeners);

  return () => {
    const latestChannelListeners = store.listenersByChannel.get(channel);
    if (!latestChannelListeners) {
      return;
    }

    const latestListeners = latestChannelListeners.get(scopeKey);
    if (!latestListeners) {
      return;
    }

    latestListeners.delete(listener as EventListener<unknown>);

    if (latestListeners.size === 0) {
      latestChannelListeners.delete(scopeKey);
    }

    if (latestChannelListeners.size === 0) {
      store.listenersByChannel.delete(channel);
    }
  };
}
