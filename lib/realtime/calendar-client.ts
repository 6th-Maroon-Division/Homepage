import { apiList } from '@/lib/api/client';

/** Keep public and admin calendars in sync with the authoritative calendar API. */
export function subscribeCalendarUpdates<T extends { eventDate: string }>(onUpdate: (items: T[]) => void) {
  const source = new EventSource('/api/orbats/events');
  let request: AbortController | null = null;
  let closed = false;

  const refresh = async () => {
    if (closed) return;
    request?.abort();
    const controller = new AbortController();
    request = controller;
    try {
      const items = await apiList<T>('/api/orbats/calendar', { signal: controller.signal, cache: 'no-store' });
      if (!controller.signal.aborted) {
        onUpdate(items.sort((a, b) => Date.parse(a.eventDate) - Date.parse(b.eventDate)));
      }
    } catch {
      // Keep the last successful calendar; the next event or poll retries.
    }
  };

  source.onmessage = (event) => {
    try {
      const type = JSON.parse(event.data)?.data?.type;
      // Connection refreshes also cover changes missed before subscribing or
      // during disconnections. Mutation events need no embedded item payload.
      if (['stream.connected', 'orbat.created', 'orbat.updated', 'orbat.deleted'].includes(type)) {
        void refresh();
      }
    } catch {
      // Ignore malformed messages without interrupting future updates.
    }
  };

  // The event bus is process-local. Polling also covers other server instances
  // and training-session mutations, which use a separate event bus.
  const timer = setInterval(() => void refresh(), 30000);
  return () => {
    closed = true;
    request?.abort();
    clearInterval(timer);
    source.close();
  };
}
