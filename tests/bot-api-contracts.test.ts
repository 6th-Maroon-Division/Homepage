import test from 'node:test';
import assert from 'node:assert/strict';
import { isDiscordSnowflake, parsePositiveId, requestHash } from '../lib/bot-api';
import { parseNotificationPatch } from '../lib/notification-preferences';

test('Discord snowflake validation keeps IDs as strings', () => {
  assert.equal(isDiscordSnowflake('12345678901234567'), true);
  assert.equal(isDiscordSnowflake('12345678901234567890'), true);
  assert.equal(isDiscordSnowflake('123'), false);
  assert.equal(isDiscordSnowflake(123456789012345678), false);
});

test('positive API IDs reject fractional, zero, and malformed values', () => {
  assert.equal(parsePositiveId('42'), 42);
  assert.equal(parsePositiveId('0'), null);
  assert.equal(parsePositiveId('1.5'), null);
  assert.equal(parsePositiveId('not-an-id'), null);
});

test('idempotency request hashes are stable and payload-sensitive', () => {
  assert.equal(requestHash({ a: 1, b: 2 }), requestHash({ a: 1, b: 2 }));
  assert.notEqual(requestHash({ a: 1 }), requestHash({ a: 2 }));
});

test('notification patches accept booleans and reject unknown or mistyped fields', () => {
  assert.deepEqual(parseNotificationPatch({ trainingReminders: true }), { data: { trainingReminders: true } });
  assert.deepEqual(parseNotificationPatch({ trainingReminders: 'yes' }), { error: 'trainingReminders must be a boolean.' });
  assert.deepEqual(parseNotificationPatch({ discordUserId: '123' }), { error: 'Unknown preference fields: discordUserId' });
});
