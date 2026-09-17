import { describe, expect, it, vi } from 'vitest';
import { isDateOnly, parseUtcTimestamp } from '@/lib/api/utc';
import { redactAuditValue, shouldAuditUserRead, writeApiAudit } from '@/lib/api/audit';

describe('UTC timestamp boundaries', () => {
  it.each([
    ['2026-09-17T12:34:56Z', '2026-09-17T12:34:56.000Z'],
    ['2026-01-01T00:30:00+02:00', '2025-12-31T22:30:00.000Z'],
    ['2026-03-29T03:00:00+02:00', '2026-03-29T01:00:00.000Z'],
    ['2026-10-25T02:30:00+02:00', '2026-10-25T00:30:00.000Z'],
    ['2026-10-25T02:30:00+01:00', '2026-10-25T01:30:00.000Z'],
    ['2024-02-29T23:59:59.123-05:00', '2024-03-01T04:59:59.123Z'],
  ])('normalizes %s to UTC', (input, output) => expect(parseUtcTimestamp(input)?.toISOString()).toBe(output));
  it.each([null, 123, '', '2026-09-17', '2026-09-17T12:00:00', '2026-02-29T12:00:00Z', '2026-13-01T12:00:00Z', '2026-01-00T12:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00:00+01:60'])('rejects ambiguous or invalid timestamp %s', input => expect(parseUtcTimestamp(input)).toBeNull());
  it.each([['2024-02-29', true], ['2026-02-29', false], ['2026-09-17', true], ['2026-09-17T00:00:00Z', false], [null, false]])('keeps date-only values distinct %s', (input, expected) => expect(isDateOnly(input)).toBe(expected));
});

describe('audit privacy and attribution', () => {
  it('audits other-user and bot reads, excluding self and empty reads', () => {
    const user = { kind: 'user' as const, userId: 4, permissions: {} };
    expect(shouldAuditUserRead(user, [4])).toBe(false);
    expect(shouldAuditUserRead(user, [4, 5])).toBe(true);
    expect(shouldAuditUserRead(user, [])).toBe(false);
    expect(shouldAuditUserRead({ kind: 'bot', tokenId: 9, permissions: {} }, [4])).toBe(true);
  });
  it('redacts secrets recursively without dropping relevant changes', () => {
    expect(redactAuditValue({ name: 'Test', token: 'SECRET', password: 'x', nested: [{ dmEnabled: false, email: 'private', count: 3, missing: null }, null], unsafe: undefined, nonfinite: Infinity })).toEqual({ name: 'Test', token: '[REDACTED]', password: '[REDACTED]', nested: [{ dmEnabled: false, email: '[REDACTED]', count: 3, missing: null }, null], unsafe: '[REDACTED]', nonfinite: '[REDACTED]' });
  });
  it.each([
    [{ kind: 'user', userId: 4, permissions: {} }, 'user', 4, null],
    [{ kind: 'bot', tokenId: 9, permissions: {} }, 'bot', null, 9],
    [null, 'anonymous', null, null],
  ] as const)('attributes %j and deduplicates target users', async (principal, actorType, actorUserId, actorTokenId) => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    await writeApiAudit({ apiAuditLog: { create } } as never, { principal, correlationId: 'correlation', method: 'PATCH', path: '/api/users/4' }, { action: 'update', resource: 'user', resourceId: '4', targetUserIds: [4, 4, 5], outcome: 'success', before: { token: 'x' }, after: { dmEnabled: true } });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType, actorUserId, actorTokenId, targetUserIds: [4, 5], before: { token: '[REDACTED]' }, after: { dmEnabled: true } }) });
  });
  it('omits absent snapshots and defaults target list', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1 });
    await writeApiAudit({ apiAuditLog: { create } } as never, { principal: null, correlationId: 'x', method: 'GET', path: '/api' }, { action: 'denied', resource: 'api', outcome: 'denied' });
    expect(create.mock.calls[0][0].data).not.toHaveProperty('before');
    expect(create.mock.calls[0][0].data.targetUserIds).toEqual([]);
  });
});

import { parseOrbatTimeRange, parsePromotionLookback } from '@/lib/api/bot-query-validation';
describe('UTC query filters', () => {
  it('validates and normalizes bounded and unbounded time ranges', () => {
    expect(parseOrbatTimeRange(new URLSearchParams())).toEqual({ data: { startAt: null, endBefore: null } });
    expect(parseOrbatTimeRange(new URLSearchParams({ startAt: '2026-09-17T12:00:00+02:00', endBefore: '2026-09-18T10:00:00Z' }))).toEqual({ data: { startAt: new Date('2026-09-17T10:00:00Z'), endBefore: new Date('2026-09-18T10:00:00Z') } });
    for (const values of [{ startAt: 'bad' }, { endBefore: 'bad' }, { startAt: '2026-09-18T00:00:00Z', endBefore: '2026-09-17T00:00:00Z' }]) {
      expect(parseOrbatTimeRange(new URLSearchParams(values as Record<string, string>))).toHaveProperty('error');
    }
  });
  it('uses UTC day arithmetic for lookback and rejects invalid ranges', () => {
    const now = new Date('2026-03-30T01:00:00Z');
    expect(parsePromotionLookback(new URLSearchParams(), now)).toEqual({ data: { days: 7, cutoffDate: new Date('2026-03-23T01:00:00Z') } });
    expect(parsePromotionLookback(new URLSearchParams('days=1'), now)).toEqual({ data: { days: 1, cutoffDate: new Date('2026-03-29T01:00:00Z') } });
    expect(parsePromotionLookback(new URLSearchParams('days=0'), now)).toHaveProperty('error');
    expect(parsePromotionLookback(new URLSearchParams('days=9007199254740991'), now)).toHaveProperty('error');
    expect(parsePromotionLookback(new URLSearchParams('days=1'), new Date('0001-01-01T00:00:00Z'))).toHaveProperty('error');
    expect(parsePromotionLookback(new URLSearchParams('days=1'), new Date('+010001-01-01T00:00:00Z'))).toHaveProperty('error');
    expect(parsePromotionLookback(new URLSearchParams('days=1'))).toHaveProperty('data');
  });
});
