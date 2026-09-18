import { describe, expect, it, vi } from 'vitest';
import { parsePositiveId, parseCursorPagination } from '@/lib/api/validation';
import { parsePermissionGrants, hasApiPermission, hasApiHierarchyPermission } from '@/lib/api/permissions';
import { resolveApiPrincipal } from '@/lib/api/principal';
import { parseBotTokenBody } from '@/lib/api/bot-tokens';
import { apiSuccess, apiError } from '@/lib/api/response';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
import { parseNotificationPatch } from '@/lib/notification-preferences';

describe('request contracts', () => {
  it.each([1, '42', Number.MAX_SAFE_INTEGER])('accepts safe positive id %s', value => expect(parsePositiveId(value)).toBe(Number(value)));
  it.each([null, undefined, {}, true, '', ' 1', '1.1', '1e2', '-1', 0, -1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects ambiguous or unsafe id %s', value => expect(parsePositiveId(value)).toBeNull());
  it('validates pagination and caps limits', () => {
    const options = { defaultLimit: 20, maxLimit: 100 };
    expect(parseCursorPagination(new URLSearchParams(), options)).toEqual({ data: { limit: 20, cursor: null } });
    expect(parseCursorPagination(new URLSearchParams('limit=200&cursor=4'), options)).toEqual({ data: { limit: 100, cursor: 4 } });
    expect(parseCursorPagination(new URLSearchParams('limit=0'), options)).toHaveProperty('error');
    expect(parseCursorPagination(new URLSearchParams('cursor='), options)).toHaveProperty('error');
  });
  it.each([null, [], 'x', { unknown: true }, { name: '' }, { name: 1 }, { name: 'a', isActive: 'true' }])('rejects malformed token payload %j', body => expect(parseBotTokenBody(body, true)).toHaveProperty('error'));
  it('trims token names and supports partial updates', () => {
    expect(parseBotTokenBody({ name: ' Test ' }, true)).toEqual({ data: { name: 'Test' } });
    expect(parseBotTokenBody({ isActive: false }, false)).toEqual({ data: { isActive: false } });
    expect(parseBotTokenBody({}, false)).toEqual({ data: {} });
  });
  it.each([null, [], 'x', { unknown: true }, { dmEnabled: 'true' }])('rejects malformed notification payload %j', body => expect(parseNotificationPatch(body)).toHaveProperty('error'));
  it('preserves false and omitted preferences', () => expect(parseNotificationPatch({ dmEnabled: false })).toEqual({ data: { dmEnabled: false } }));
  it('uses envelopes and unique error correlation ids', async () => {
    expect(await apiSuccess({ id: 1 }).json()).toEqual({ data: { id: 1 }, meta: {} });
    expect(await apiSuccess([], { status: 201, meta: { nextCursor: 2 } }).json()).toEqual({ data: [], meta: { nextCursor: 2 } });
    const a = await apiError(403, 'forbidden', 'No').json();
    const b = await apiError(403, 'forbidden', 'No', { permission: 'x' }).json();
    expect(a.error).toMatchObject({ code: 'forbidden', message: 'No', details: {} });
    expect(a.error.correlationId).not.toBe(b.error.correlationId);
  });
});

describe('permission boundaries', () => {
  it.each([null, [], true, { invalid: 1 }, { 'user:edit': -1 }, { 'user:edit': 256 }, { 'user:edit': '1' }])('rejects invalid grants %j', grants => expect(parsePermissionGrants(grants)).toBeNull());
  it('accepts known grants', () => expect(parsePermissionGrants({ 'user:edit': 2 })).toEqual({ 'user:edit': 2 }));
  it('checks grants and superadmin override', () => {
    expect(hasApiPermission({}, 'user:edit')).toBe(false);
    expect(hasApiPermission({ 'user:edit': 1 }, 'user:edit')).toBe(true);
    expect(hasApiPermission({ 'system:super_admin': 1 }, 'user:edit')).toBe(true);
    expect(hasApiHierarchyPermission({}, {}, 'user:edit')).toBe(false);
    expect(hasApiHierarchyPermission({ 'user:edit': 2 }, { 'user:edit': 1 }, 'user:edit')).toBe(true);
    expect(hasApiHierarchyPermission({ 'user:edit': 2 }, { 'user:edit': 2 }, 'user:edit')).toBe(false);
    expect(hasApiHierarchyPermission({ 'user:edit': 255 }, { 'system:super_admin': 1 }, 'user:edit')).toBe(false);
    expect(hasApiHierarchyPermission({ 'system:super_admin': 1 }, { 'system:super_admin': 1 }, 'user:edit')).toBe(true);
  });
});

describe('principal resolution', () => {
  const deps = () => ({ sessionUserId: vi.fn().mockResolvedValue('4'), findUser: vi.fn().mockResolvedValue({ permissions: { 'user:edit': 2 } }), findBot: vi.fn().mockResolvedValue({ id: 3, permissions: { 'system:super_admin': 255 } }), touchBot: vi.fn().mockResolvedValue(undefined) });
  it('reloads session permissions from database', async () => {
    const d = deps();
    expect(await resolveApiPrincipal(new Request('http://localhost/api'), d)).toEqual({ kind: 'user', userId: 4, permissions: { 'user:edit': 2 } });
    expect(d.findUser).toHaveBeenCalledWith(4);
  });
  it('authenticates bearer and records usage', async () => {
    const d = deps();
    expect(await resolveApiPrincipal(new Request('http://localhost/api', { headers: { authorization: 'bearer secret' } }), d)).toMatchObject({ kind: 'bot', tokenId: 3 });
    expect(d.touchBot).toHaveBeenCalledWith(3);
    expect(d.sessionUserId).not.toHaveBeenCalled();
  });
  it.each(['Basic xyz', 'Bearer', 'Bearer one two'])('rejects malformed authorization %s without session fallback', async authorization => {
    const d = deps();
    expect(await resolveApiPrincipal(new Request('http://localhost/api', { headers: { authorization } }), d)).toBeNull();
    expect(d.sessionUserId).not.toHaveBeenCalled();
  });
  it('rejects absent bot, invalid session id, and deleted user', async () => {
    const d = deps(); d.findBot.mockResolvedValue(null);
    expect(await resolveApiPrincipal(new Request('http://localhost/api', { headers: { authorization: 'Bearer invalid' } }), d)).toBeNull();
    expect(d.touchBot).not.toHaveBeenCalled();
    d.sessionUserId.mockResolvedValue(null);
    expect(await resolveApiPrincipal(new Request('http://localhost/api'), d)).toBeNull();
    d.sessionUserId.mockResolvedValue('4'); d.findUser.mockResolvedValue(null);
    expect(await resolveApiPrincipal(new Request('http://localhost/api'), d)).toBeNull();
  });
});
