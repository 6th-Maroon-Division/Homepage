import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishPromotionEvent,
  subscribePromotionEvents,
} from '@/lib/realtime/promotion-events';

test('publishPromotionEvent notifies subscribers', () => {
  let receivedType: string | null = null;

  const unsubscribe = subscribePromotionEvents((event) => {
    receivedType = event.type;
  });

  publishPromotionEvent({ source: 'proposal.created' });
  unsubscribe();

  assert.equal(receivedType, 'promotions.updated');
});

test('unsubscribe stops promotions notifications', () => {
  let callCount = 0;

  const unsubscribe = subscribePromotionEvents(() => {
    callCount += 1;
  });

  publishPromotionEvent();
  unsubscribe();
  publishPromotionEvent();

  assert.equal(callCount, 1);
});
