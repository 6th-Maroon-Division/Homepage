import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishInboxEvent,
  publishInboxEvents,
  subscribeInboxEvents,
} from '@/lib/realtime/inbox-events';

test('publishInboxEvent notifies only subscribed user listeners', () => {
  let userOneCalls = 0;
  let userTwoCalls = 0;

  const unsubOne = subscribeInboxEvents(1, () => {
    userOneCalls += 1;
  });
  const unsubTwo = subscribeInboxEvents(2, () => {
    userTwoCalls += 1;
  });

  publishInboxEvent(1);

  unsubOne();
  unsubTwo();

  assert.equal(userOneCalls, 1);
  assert.equal(userTwoCalls, 0);
});

test('publishInboxEvents de-duplicates recipients', () => {
  let calls = 0;

  const unsubscribe = subscribeInboxEvents(42, () => {
    calls += 1;
  });

  publishInboxEvents([42, 42, 42]);

  unsubscribe();

  assert.equal(calls, 1);
});
