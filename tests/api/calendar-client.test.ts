import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { subscribeCalendarUpdates } from '@/lib/realtime/calendar-client';

class FakeEventSource {
  static latest: FakeEventSource;
  onmessage: ((event: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(readonly url: string) { FakeEventSource.latest = this; }
  send(type: string) { this.onmessage?.({ data: JSON.stringify({ data: { type, orbatId: 1, payload: null }, meta: {} }) }); }
}

type Item = { id: number; name: string; eventDate: string; dateKey: string; isSideOp: boolean };
const item: Item = { id: 1, name: 'Operation', eventDate: '2026-09-20T18:00:00.000Z', dateKey: '2026-09-20', isSideOp: false };
const envelope = (data: Item[], nextCursor: string | null = null) => Response.json({ data, meta: { nextCursor } });
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('create, calendar edits and deletion replace the visible calendar using canonical data', async () => {
  const edited = { ...item, name: 'Renamed side operation', eventDate: '2026-09-22T21:00:00.000Z', dateKey: '2026-09-22', isSideOp: true };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(envelope([item]))
    .mockResolvedValueOnce(envelope([edited]))
    .mockResolvedValueOnce(envelope([]));
  vi.stubGlobal('fetch', fetcher);
  const update = vi.fn();
  stop = subscribeCalendarUpdates<Item>(update);
  expect(FakeEventSource.latest.url).toBe('/api/orbats/events');

  for (const [type, expected] of [
    ['orbat.created', [item]], ['orbat.updated', [edited]], ['orbat.deleted', []],
  ] as const) {
    FakeEventSource.latest.send(type);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenLastCalledWith(expected);
  }
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher).toHaveBeenLastCalledWith('/api/orbats/calendar?limit=100', expect.objectContaining({ cache: 'no-store' }));
});

test('initial connection and reconnect catch missed events and read all calendar pages in date order', async () => {
  const later = { ...item, id: 2, eventDate: '2026-09-23T18:00:00.000Z', dateKey: '2026-09-23' };
  const fetcher = vi.fn()
    .mockResolvedValueOnce(envelope([later], 'orbat:2'))
    .mockResolvedValueOnce(envelope([item]))
    .mockResolvedValueOnce(envelope([]));
  vi.stubGlobal('fetch', fetcher);
  const update = vi.fn();
  stop = subscribeCalendarUpdates<Item>(update);
  FakeEventSource.latest.send('stream.connected');
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenLastCalledWith([item, later]);
  expect(fetcher).toHaveBeenNthCalledWith(2, '/api/orbats/calendar?limit=100&cursor=orbat%3A2', expect.anything());
  FakeEventSource.latest.send('stream.connected');
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenLastCalledWith([]);
});

test('unrelated and malformed events do not fetch, while periodic polling remains active', async () => {
  const fetcher = vi.fn().mockResolvedValue(envelope([item]));
  vi.stubGlobal('fetch', fetcher);
  const update = vi.fn();
  stop = subscribeCalendarUpdates<Item>(update);
  FakeEventSource.latest.send('signup.created');
  FakeEventSource.latest.onmessage?.({ data: 'invalid JSON' });
  FakeEventSource.latest.onmessage?.({ data: 'null' });
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30000);
  expect(update).toHaveBeenCalledWith([item]);
});

test('a failed refresh retains the previous calendar and later events retry', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(envelope([item]))
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(envelope([]));
  vi.stubGlobal('fetch', fetcher);
  const update = vi.fn();
  stop = subscribeCalendarUpdates<Item>(update);
  FakeEventSource.latest.send('stream.connected');
  await vi.advanceTimersByTimeAsync(0);
  FakeEventSource.latest.send('orbat.updated');
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenLastCalledWith([item]);
  FakeEventSource.latest.send('orbat.deleted');
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenLastCalledWith([]);
});

test('an older response cannot overwrite a newer mutation and cleanup stops all updates', async () => {
  let resolveOlder!: (response: Response) => void;
  let resolveUnmounted!: (response: Response) => void;
  const fetcher = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveOlder = resolve; }))
    .mockResolvedValueOnce(envelope([]))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { resolveUnmounted = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const update = vi.fn();
  stop = subscribeCalendarUpdates<Item>(update);
  FakeEventSource.latest.send('orbat.updated');
  const firstSignal = fetcher.mock.calls[0][1].signal as AbortSignal;
  FakeEventSource.latest.send('orbat.deleted');
  expect(firstSignal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  resolveOlder(envelope([item]));
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenCalledExactlyOnceWith([]);

  FakeEventSource.latest.send('orbat.created');
  const lastSignal = fetcher.mock.calls[2][1].signal as AbortSignal;
  stop();
  stop = undefined;
  expect(lastSignal.aborted).toBe(true);
  expect(FakeEventSource.latest.close).toHaveBeenCalledOnce();
  resolveUnmounted(envelope([item]));
  FakeEventSource.latest.send('orbat.updated');
  await vi.advanceTimersByTimeAsync(60000);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(update).toHaveBeenCalledExactlyOnceWith([]);
});
