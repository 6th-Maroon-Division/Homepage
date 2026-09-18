import { beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => ({ $transaction: vi.fn(), botEvent: { create: vi.fn(), deleteMany: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: m }));
import { Prisma } from '@/generated/prisma/client';
import { runSerializableTransaction } from '@/lib/serializable-transaction';
import { appendBotEvent, serializeBotEvent } from '@/lib/bot-events';
import { publishOrbatEvent, subscribeOrbatEvents, toPublicOrbatEvent } from '@/lib/realtime/orbat-events';
import { publishTrainingChatEvent, subscribeTrainingStaffChatEvents } from '@/lib/realtime/training-chat-events';
import { publishToChannel, subscribeToChannel } from '@/lib/realtime/event-hub';
beforeEach(() => vi.resetAllMocks());
test('serializable conflicts retry at most three times and preserve the original failure', async () => {
  const conflict = new Prisma.PrismaClientKnownRequestError('retry', { code: 'P2034', clientVersion: 'test' });
  m.$transaction.mockRejectedValueOnce(conflict).mockResolvedValueOnce('saved');
  expect(await runSerializableTransaction(async () => 'saved')).toBe('saved');
  expect(m.$transaction).toHaveBeenCalledTimes(2);
  m.$transaction.mockReset().mockRejectedValue(conflict);
  await expect(runSerializableTransaction(async () => 'saved')).rejects.toBe(conflict);
  expect(m.$transaction).toHaveBeenCalledTimes(3);
  for (const error of [new Error('connection lost'), new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: 'test' })]) {
    m.$transaction.mockReset().mockRejectedValue(error);
    await expect(runSerializableTransaction(async () => 'saved')).rejects.toBe(error);
    expect(m.$transaction).toHaveBeenCalledTimes(1);
  }
});
test('outbox accepts events without an aggregate ID and serializes large IDs losslessly', async () => {
  await appendBotEvent({ type: 'orbat.changed', aggregate: 'orbat', payload: {} });
  await appendBotEvent({ type: 'orbat.changed', aggregate: 'orbat', aggregateId: null, payload: {} });
  expect(m.botEvent.create).toHaveBeenLastCalledWith({ data: { type: 'orbat.changed', aggregate: 'orbat', aggregateId: null, payload: {} } });
  expect(serializeBotEvent({ id: BigInt('9007199254740993'), occurredAt: new Date('2099-01-01Z'), type: 'orbat.changed', payload: { id: 3 } })).toEqual({ id: '9007199254740993', occurredAt: '2099-01-01T00:00:00.000Z', type: 'orbat.changed', payload: { id: 3 } });
});
test('public event projection omits staff events and subscriptions can be closed twice', () => {
  expect(toPublicOrbatEvent(publishOrbatEvent({ type: 'orbat.updated', orbatId: 3, visibility: 'staff' }))).toBeNull();
  expect(toPublicOrbatEvent(publishOrbatEvent({ type: 'orbat.updated', orbatId: 3 }))).toMatchObject({ orbatId: 3, payload: null });
  expect(toPublicOrbatEvent(publishOrbatEvent({ type: 'orbat.updated', orbatId: 3, payload: { name: 'New' } }))).toMatchObject({ payload: { name: 'New' } });
  expect(() => (subscribeOrbatEvents as unknown as (id: number) => void)(3)).toThrow('Listener is required');
  const listener = vi.fn(); const staff = subscribeTrainingStaffChatEvents(listener);
  publishTrainingChatEvent(3); expect(listener).toHaveBeenCalledOnce(); staff(); staff();
  const one = subscribeToChannel('cleanup', 1, listener); const two = subscribeToChannel('cleanup', 2, listener);
  one(); one(); publishToChannel('cleanup', 1, {}); two(); two();
  expect(listener).toHaveBeenCalledOnce();
});

test('unsubscribing one listener keeps other listeners on the same scope active', () => {
  const first = vi.fn(); const second = vi.fn();
  const stopFirst = subscribeToChannel('shared', 1, first);
  const stopSecond = subscribeToChannel('shared', 1, second);
  stopFirst(); publishToChannel('shared', 1, 'changed');
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledWith('changed');
  stopSecond();
});
