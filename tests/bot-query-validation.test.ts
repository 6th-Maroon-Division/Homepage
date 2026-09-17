import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOrbatTimeRange, parsePromotionLookback } from '../lib/api/bot-query-validation';

test('ORBAT time range allows omitted and independently supplied bounds', () => {
  assert.deepEqual(parseOrbatTimeRange(new URLSearchParams()), { data: { startAt: null, endBefore: null } });
  for (const field of ['startAt', 'endBefore'] as const) {
    const result = parseOrbatTimeRange(new URLSearchParams({ [field]: '2026-09-17T18:00:00+02:00' }));
    assert.equal(result.data?.[field]?.toISOString(), '2026-09-17T16:00:00.000Z');
  }
});

test('ORBAT time range rejects empty, invalid and timezone-free timestamps', () => {
  for (const value of ['', 'invalid', '2026-09-17', '2026-09-17T18:00:00', '2026-02-30T18:00:00Z']) {
    for (const field of ['startAt', 'endBefore']) {
      assert.ok(parseOrbatTimeRange(new URLSearchParams({ [field]: value })).error, `${field}=${value}`);
    }
  }
});

test('ORBAT bounds compare normalized instants and reject empty or reversed intervals', () => {
  for (const endBefore of ['2026-09-17T16:00:00Z', '2026-09-17T15:59:59Z']) {
    assert.ok(parseOrbatTimeRange(new URLSearchParams({ startAt: '2026-09-17T18:00:00+02:00', endBefore })).error);
  }
  const result = parseOrbatTimeRange(new URLSearchParams({
    startAt: '2026-09-17T18:00:00+02:00', endBefore: '2026-09-17T16:00:01Z',
  }));
  assert.equal(result.data?.startAt?.toISOString(), '2026-09-17T16:00:00.000Z');
  assert.equal(result.data?.endBefore?.toISOString(), '2026-09-17T16:00:01.000Z');
});

test('promotion lookback defaults to seven UTC days without mutating the clock', () => {
  const now = new Date('2026-01-03T12:34:56Z');
  const result = parsePromotionLookback(new URLSearchParams(), now);
  assert.equal(result.data?.days, 7);
  assert.equal(result.data?.cutoffDate.toISOString(), '2025-12-27T12:34:56.000Z');
  assert.equal(now.toISOString(), '2026-01-03T12:34:56.000Z');
});

test('promotion lookback rejects partial, fractional, negative and overflowing integers', () => {
  for (const days of ['', '0', '-1', '1.5', '7days', '1e2', ' 7', 'Infinity', '100000000', '9007199254740992', '9007199254740991']) {
    assert.ok(parsePromotionLookback(new URLSearchParams({ days })).error, `days=${days}`);
  }
});

test('promotion lookback uses UTC days across daylight-saving and leap-day boundaries', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    for (const [now, expected] of [
      ['2026-03-30T12:00:00Z', '2026-03-28T12:00:00.000Z'],
      ['2026-10-26T12:00:00Z', '2026-10-24T12:00:00.000Z'],
      ['2024-03-01T12:00:00Z', '2024-02-28T12:00:00.000Z'],
    ]) {
      const result = parsePromotionLookback(new URLSearchParams({ days: '2' }), new Date(now));
      assert.equal(result.data?.cutoffDate.toISOString(), expected);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
