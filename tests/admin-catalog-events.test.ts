import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishAdminCatalogEvent,
  subscribeAdminCatalogEvents,
} from '@/lib/realtime/admin-catalog-events';

test('publishAdminCatalogEvent notifies subscribers', () => {
  let callCount = 0;
  let lastType: string | null = null;

  const unsubscribe = subscribeAdminCatalogEvents((event) => {
    callCount += 1;
    lastType = event.type;
  });

  publishAdminCatalogEvent({
    type: 'template.changed',
    payload: { action: 'updated', templateId: 123 },
  });

  unsubscribe();

  assert.equal(callCount, 1);
  assert.equal(lastType, 'template.changed');
});

test('unsubscribe stops admin catalog event delivery', () => {
  let callCount = 0;

  const unsubscribe = subscribeAdminCatalogEvents(() => {
    callCount += 1;
  });

  publishAdminCatalogEvent({ type: 'orbat.changed' });
  unsubscribe();
  publishAdminCatalogEvent({ type: 'role-definition.changed' });

  assert.equal(callCount, 1);
});