import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishUserProfileEvent,
  subscribeUserProfileEvents,
} from '@/lib/realtime/user-events';

test('publishUserProfileEvent notifies only matching user subscribers', () => {
  let targetCalls = 0;
  let otherCalls = 0;

  const unsubscribeTarget = subscribeUserProfileEvents(100, () => {
    targetCalls += 1;
  });
  const unsubscribeOther = subscribeUserProfileEvents(200, () => {
    otherCalls += 1;
  });

  publishUserProfileEvent(100, { source: 'training.updated' });

  unsubscribeTarget();
  unsubscribeOther();

  assert.equal(targetCalls, 1);
  assert.equal(otherCalls, 0);
});

test('unsubscribe stops receiving user profile events', () => {
  let callCount = 0;

  const unsubscribe = subscribeUserProfileEvents(300, () => {
    callCount += 1;
  });

  publishUserProfileEvent(300);
  unsubscribe();
  publishUserProfileEvent(300);

  assert.equal(callCount, 1);
});
