import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishOrbatEvent,
  subscribeOrbatEvents,
  toPublicOrbatEvent,
} from '@/lib/realtime/orbat-events';

test('publishOrbatEvent notifies subscribers with event payload', () => {
  let receivedType: string | null = null;
  let receivedOrbatId: number | null = null;

  const unsubscribe = subscribeOrbatEvents((event) => {
    receivedType = event.type;
    receivedOrbatId = event.orbatId;
  });

  publishOrbatEvent({
    type: 'signup.created',
    orbatId: 42,
    payload: { slotId: 99 },
  });

  unsubscribe();

  assert.equal(receivedType, 'signup.created');
  assert.equal(receivedOrbatId, 42);
});

test('unsubscribe stops receiving events', () => {
  let callCount = 0;

  const unsubscribe = subscribeOrbatEvents(() => {
    callCount += 1;
  });

  publishOrbatEvent({
    type: 'orbat.updated',
    orbatId: 1,
  });

  unsubscribe();

  publishOrbatEvent({
    type: 'orbat.updated',
    orbatId: 1,
  });

  assert.equal(callCount, 1);
});

test('toPublicOrbatEvent hides non-public events', () => {
  const publicEvent = publishOrbatEvent({
    type: 'orbat.created',
    orbatId: 10,
    visibility: 'public',
  });

  const staffEvent = publishOrbatEvent({
    type: 'orbat.updated',
    orbatId: 10,
    visibility: 'staff',
    payload: { reason: 'internal' },
  });

  const projectedPublic = toPublicOrbatEvent(publicEvent);
  const projectedStaff = toPublicOrbatEvent(staffEvent);

  assert.ok(projectedPublic);
  assert.equal(projectedPublic?.type, 'orbat.created');
  assert.equal(projectedStaff, null);
});
