import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const methods = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), upsert: vi.fn(), count: vi.fn() });
  return { session: vi.fn(), prisma: { user: methods(), userPermission: methods(), botToken: methods(), userNotificationPreference: methods(), apiAuditLog: methods(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import * as tokens from '@/app/api/bot-tokens/route';
import * as token from '@/app/api/bot-tokens/[id]/route';
import * as prefs from '@/app/api/users/[id]/notification-preferences/route';

const context = (id = '4') => ({ params: Promise.resolve({ id }) });
const request = (method = 'GET', body?: unknown, bot = false, raw = false) => new Request('http://localhost/api/test', {
  method, headers: { ...(bot ? { authorization: 'Bearer valid-token' } : {}), 'content-type': 'application/json' },
  ...(body !== undefined ? { body: raw ? String(body) : JSON.stringify(body) } : {}),
});
const methods = [
  ['token list GET', () => tokens.GET(request())],
  ['token POST', () => tokens.POST(request('POST', { name: 'Test' }))],
  ['token GET', () => token.GET(request(), context())],
  ['token PATCH', () => token.PATCH(request('PATCH', { isActive: false }), context())],
  ['token DELETE', () => token.DELETE(request('DELETE'), context())],
  ['preferences GET', () => prefs.GET(request(), context())],
  ['preferences PATCH', () => prefs.PATCH(request('PATCH', { dmEnabled: false }), context())],
] as const;
const record = { id: 4, name: 'Test', isActive: true, createdAt: new Date('2026-09-17T12:00:00Z'), lastUsedAt: null, createdBy: { id: 4, username: 'Admin' } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: '4' } });
  mocks.prisma.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] });
  mocks.prisma.userPermission.findMany.mockResolvedValue([]);
  mocks.prisma.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.prisma.botToken.findMany.mockResolvedValue([record]);
  mocks.prisma.botToken.findUnique.mockResolvedValue(record);
  mocks.prisma.botToken.create.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.prisma.botToken.update.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.prisma.botToken.delete.mockResolvedValue(record);
  mocks.prisma.userNotificationPreference.findUnique.mockResolvedValue({ userId: 4, dmEnabled: true });
  mocks.prisma.userNotificationPreference.upsert.mockImplementation(async ({ create, update }) => ({ userId: create.userId, dmEnabled: true, ...update }));
  mocks.prisma.apiAuditLog.create.mockResolvedValue({ id: 1 });
  mocks.prisma.$transaction.mockImplementation(async (work) => typeof work === 'function' ? work(mocks.prisma) : Promise.all(work));
});

describe('canonical endpoint authentication', () => {
  it.each(methods)('%s accepts authorized sessions', async (_name, call) => expect((await call()).status).toBeLessThan(300));
  it.each(methods)('%s rejects missing sessions', async (_name, call) => {
    mocks.session.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized', correlationId: expect.any(String) } });
  });
  it.each(['invalid', 'inactive', 'revoked'])('rejects %s bot token even with a valid session', async credential => {
    mocks.prisma.botToken.findFirst.mockResolvedValue(null);
    const response = await tokens.GET(new Request('http://localhost/api/bot-tokens', { headers: { authorization: `Bearer ${credential}` } }));
    expect(response.status).toBe(401);
    expect(mocks.prisma.botToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { token: credential, isActive: true } }));
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it('grants active bots superadmin access to every migrated operation', async () => {
    const responses = [
      await tokens.GET(request('GET', undefined, true)),
      await tokens.POST(request('POST', { name: 'Bot created' }, true)),
      await token.GET(request('GET', undefined, true), context()),
      await token.PATCH(request('PATCH', { isActive: false }, true), context()),
      await token.DELETE(request('DELETE', undefined, true), context()),
      await prefs.GET(request('GET', undefined, true), context()),
      await prefs.PATCH(request('PATCH', { dmEnabled: false }, true), context()),
    ];
    expect(responses.map(r => r.status)).toEqual([200, 201, 200, 200, 200, 200, 200]);
    expect(mocks.prisma.botToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ createdById: null }) }));
  });
  it.each(methods.slice(0, 5))('%s requires superadmin', async (_name, call) => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
    expect((await call()).status).toBe(403);
  });
});

describe('token resource contracts', () => {
  it('returns public token metadata without secrets and creates a secret once', async () => {
    const listed = await (await tokens.GET(request())).json();
    expect(listed.data[0]).not.toHaveProperty('token');
    expect(listed.data[0].createdAt).toBe('2026-09-17T12:00:00.000Z');
    const created = await (await tokens.POST(request('POST', { name: ' New ' }))).json();
    expect(created.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.data.name).toBe('New');
    expect(mocks.prisma.botToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ createdById: 4 }) }));
  });
  it.each(['GET', 'PATCH', 'DELETE'] as const)('%s validates ids and missing resources', async method => {
    const body = method === 'PATCH' ? { isActive: false } : undefined;
    expect((await token[method](request(method, body), context('bad'))).status).toBe(400);
    mocks.prisma.botToken.findUnique.mockResolvedValue(null);
    expect((await token[method](request(method, body), context())).status).toBe(404);
  });
  it('rejects malformed JSON, unknown fields, and invalid updates', async () => {
    expect((await tokens.POST(request('POST', '{', false, true))).status).toBe(400);
    expect((await tokens.POST(request('POST', { permissions: {} }))).status).toBe(422);
    expect((await token.PATCH(request('PATCH', { isActive: 'false' }), context())).status).toBe(422);
    expect(mocks.prisma.botToken.create).not.toHaveBeenCalled();
  });
  it('hides internal exceptions while returning a correlation id', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.prisma.botToken.findMany.mockRejectedValue(new Error('secret connection string'));
    const response = await tokens.GET(request());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.correlationId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain('secret');
    spy.mockRestore();
  });
});

describe('notification preferences ownership', () => {
  it('allows self reads and partial updates without administrative permissions', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
    expect((await prefs.GET(request(), context('me'))).status).toBe(200);
    const response = await prefs.PATCH(request('PATCH', { dmEnabled: false }), context('me'));
    expect(await response.json()).toMatchObject({ data: { dmEnabled: false }, meta: {} });
  });
  it.each(['GET', 'PATCH'] as const)('%s rejects invalid target, denied hierarchy and missing target', async method => {
    const body = method === 'PATCH' ? { dmEnabled: false } : undefined;
    expect((await prefs[method](request(method, body), context('invalid'))).status).toBe(400);
    expect((await prefs[method](request(method, body, true), context('me'))).status).toBe(400);
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
    expect((await prefs[method](request(method, body), context('5'))).status).toBe(403);
    mocks.prisma.user.findUnique.mockResolvedValueOnce({ id: 4, userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] }).mockResolvedValueOnce(null);
    expect((await prefs[method](request(method, body), context('5'))).status).toBe(404);
  });
  it('rejects invalid preferences without writing', async () => {
    expect((await prefs.PATCH(request('PATCH', { dmEnabled: 'false' }), context())).status).toBe(422);
    expect(mocks.prisma.userNotificationPreference.upsert).not.toHaveBeenCalled();
  });
});

describe('endpoint audit requirements', () => {
  it('does not audit self reads or general token listings', async () => {
    await prefs.GET(request(), context('me'));
    await tokens.GET(request());
    expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('audits other-user reads and attributes bot reads without copying user data', async () => {
    await prefs.GET(request(), context('5'));
    expect(mocks.prisma.apiAuditLog.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ action: 'user_data.read', actorType: 'user', actorUserId: 4, targetUserIds: [5] }) });
    await prefs.GET(request('GET', undefined, true), context());
    const data = mocks.prisma.apiAuditLog.create.mock.lastCall![0].data;
    expect(data).toMatchObject({ action: 'user_data.read', actorType: 'bot', actorTokenId: 9, targetUserIds: [4] });
    expect(data).not.toHaveProperty('after');
    expect(data).not.toHaveProperty('before');
  });
  it('links denied requests to their response correlation id and authenticated actor', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
    const response = await tokens.GET(request());
    const body = await response.json();
    expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'access.denied', outcome: 'denied', actorUserId: 4, correlationId: body.error.correlationId }) });
    expect(response.headers.get('X-Request-Id')).toBe(body.error.correlationId);
  });
  it('audits all token mutations without recording generated credentials', async () => {
    const creation = await tokens.POST(request('POST', { name: 'New' }));
    const created = await creation.json();
    await token.PATCH(request('PATCH', { isActive: false }), context());
    await token.DELETE(request('DELETE'), context());
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(mocks.prisma.apiAuditLog.create.mock.calls.map(([arg]) => arg.data.action)).toEqual(['bot_token.created', 'bot_token.updated', 'bot_token.deleted']);
    expect(JSON.stringify(mocks.prisma.apiAuditLog.create.mock.calls)).not.toContain(created.data.token);
  });
  it('audits preference changes with only changed fields', async () => {
    await prefs.PATCH(request('PATCH', { dmEnabled: false }), context());
    expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'notification_preferences.updated', before: { dmEnabled: true }, after: { dmEnabled: false }, targetUserIds: [4] }) });
  });
  it('fails mutations when transactional audit persistence fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('database unavailable'));
    expect((await tokens.POST(request('POST', { name: 'New' }))).status).toBe(500);
    expect((await prefs.PATCH(request('PATCH', { dmEnabled: false }), context())).status).toBe(500);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
  it('returns internal error if denial audit persistence fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.session.mockResolvedValue(null);
    mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('database unavailable'));
    expect((await tokens.GET(request())).status).toBe(500);
    spy.mockRestore();
  });
});

import * as auditLogs from '@/app/api/audit-logs/route';
describe('audit log GET', () => {
  it('requires authentication and superadmin rights', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await auditLogs.GET(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
    expect((await auditLogs.GET(request())).status).toBe(403);
  });
  it.each(['limit=0', 'cursor=bad', 'from=2026-09-17', 'to=bad', 'from=2026-09-18T00:00:00Z&to=2026-09-17T00:00:00Z'])('rejects invalid filters %s', query => auditLogs.GET(new Request(`http://localhost/api/audit-logs?${query}`)).then(response => expect(response.status).toBe(400)));
  it('returns cursor metadata, applies UTC boundaries, and audits another user’s data', async () => {
    mocks.prisma.apiAuditLog.findMany.mockResolvedValue([{ id: 9, actorUserId: 5, targetUserIds: [4, 5] }, { id: 8, actorUserId: null, targetUserIds: [] }]);
    const response = await auditLogs.GET(new Request('http://localhost/api/audit-logs?limit=1&cursor=10&from=2026-09-17T01:00:00%2B01:00&to=2026-09-18T00:00:00Z'));
    expect(await response.json()).toEqual({ data: [{ id: 9, actorUserId: 5, targetUserIds: [4, 5] }], meta: { limit: 1, nextCursor: '9' } });
    expect(mocks.prisma.apiAuditLog.findMany).toHaveBeenCalledWith({ where: { id: { lt: 10 }, occurredAt: { gte: new Date('2026-09-17T00:00:00Z'), lt: new Date('2026-09-18T00:00:00Z') } }, orderBy: { id: 'desc' }, take: 2 });
    expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_data.read', resource: 'audit_log', targetUserIds: [4, 5] }) });
  });
  it('allows active bots and audits user data they access', async () => {
    mocks.prisma.apiAuditLog.findMany.mockResolvedValue([{ id: 9, actorUserId: null, targetUserIds: [4] }]);
    expect((await auditLogs.GET(request('GET', undefined, true))).status).toBe(200);
    expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'bot', actorTokenId: 9, targetUserIds: [4] }) });
  });
  it('returns final and empty pages without logging self reads', async () => {
    mocks.prisma.apiAuditLog.findMany.mockResolvedValue([{ id: 9, actorUserId: 4, targetUserIds: [4] }]);
    expect(await (await auditLogs.GET(request())).json()).toMatchObject({ meta: { nextCursor: null, limit: 50 } });
    expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
    mocks.prisma.apiAuditLog.findMany.mockResolvedValue([]);
    expect(await (await auditLogs.GET(new Request('http://localhost/api/audit-logs?from=2026-09-17T00:00:00Z'))).json()).toMatchObject({ data: [], meta: { nextCursor: null } });
    expect((await auditLogs.GET(new Request('http://localhost/api/audit-logs?to=2026-09-18T00:00:00Z'))).status).toBe(200);
  });
});

describe('live credential checks', () => {
  it('rejects a deleted session user', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    expect((await tokens.GET(request())).status).toBe(401);
  });
  it('treats malformed persisted permissions as no rights', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'invalid' }, value: 255 }] });
    expect((await tokens.GET(request())).status).toBe(403);
  });
  it('rejects invalid bearer credentials across all migrated methods', async () => {
    mocks.prisma.botToken.findFirst.mockResolvedValue(null);
    const responses = [
      await tokens.GET(request('GET', undefined, true)),
      await tokens.POST(request('POST', { name: 'No' }, true)),
      await token.GET(request('GET', undefined, true), context()),
      await token.PATCH(request('PATCH', { isActive: false }, true), context()),
      await token.DELETE(request('DELETE', undefined, true), context()),
      await prefs.GET(request('GET', undefined, true), context()),
      await prefs.PATCH(request('PATCH', { dmEnabled: false }, true), context()),
      await auditLogs.GET(request('GET', undefined, true)),
    ];
    expect(responses.map(response => response.status)).toEqual(Array(8).fill(401));
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.prisma.botToken.create).not.toHaveBeenCalled();
    expect(mocks.prisma.userNotificationPreference.upsert).not.toHaveBeenCalled();
  });
});

describe('notification preference DTOs', () => {
  const fields = ['orbatAnnouncements', 'trainingScheduled', 'trainingUpdated', 'trainingCancelled', 'trainingReminders', 'promotionAnnouncements', 'dmEnabled', 'channelMentionsEnabled'];
  it('returns defaults without creating preferences during a read', async () => {
    mocks.prisma.userNotificationPreference.findUnique.mockResolvedValue(null);
    const response = await prefs.GET(request(), context('me'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: Object.fromEntries(fields.map(field => [field, field === 'dmEnabled'])), meta: {} });
    expect(mocks.prisma.userNotificationPreference.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.userNotificationPreference.create).not.toHaveBeenCalled();
    expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('returns only editable booleans so PATCH data can be resubmitted', async () => {
    mocks.prisma.userNotificationPreference.findUnique.mockResolvedValue({ id: 123, userId: 4, createdAt: new Date(), dmEnabled: true });
    const first = await prefs.PATCH(request('PATCH', { dmEnabled: false }), context('me'));
    const { data } = await first.json();
    expect(Object.keys(data).sort()).toEqual([...fields].sort());
    expect(Object.values(data).every(value => typeof value === 'boolean')).toBe(true);
    const second = await prefs.PATCH(request('PATCH', data), context('me'));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ data, meta: {} });
  });
});

describe('token creator read audits', () => {
  it.each([false, true])('audits other creator information for bot=%s', async bot => {
    const other = { ...record, createdBy: { id: 5, username: 'Other' } };
    mocks.prisma.botToken.findMany.mockResolvedValue([other, other]);
    mocks.prisma.botToken.findUnique.mockResolvedValue(other);
    expect((await tokens.GET(request('GET', undefined, bot))).status).toBe(200);
    expect((await token.GET(request('GET', undefined, bot), context())).status).toBe(200);
    expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledTimes(2);
    for (const [args] of mocks.prisma.apiAuditLog.create.mock.calls) {
      expect(args.data).toMatchObject({ action: 'user_data.read', resource: 'bot_token_creator', targetUserIds: [5], actorType: bot ? 'bot' : 'user' });
      expect(args.data).not.toHaveProperty('before');
      expect(args.data).not.toHaveProperty('after');
    }
  });
  it('does not audit self creator data', async () => {
    await tokens.GET(request());
    await token.GET(request(), context());
    expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('does not audit absent creator data or empty lists even for a bot', async () => {
    mocks.prisma.botToken.findMany.mockResolvedValue([{ ...record, createdBy: null }]);
    mocks.prisma.botToken.findUnique.mockResolvedValue({ ...record, createdBy: null });
    await tokens.GET(request('GET', undefined, true));
    await token.GET(request('GET', undefined, true), context());
    mocks.prisma.botToken.findMany.mockResolvedValue([]);
    await tokens.GET(request('GET', undefined, true));
    expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('fails protected reads when required audit persistence fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.prisma.apiAuditLog.create.mockRejectedValue(new Error('Audit store unavailable'));
    expect((await tokens.GET(request('GET', undefined, true))).status).toBe(500);
    expect((await token.GET(request('GET', undefined, true), context())).status).toBe(500);
    spy.mockRestore();
  });
});

describe('token list pagination', () => {
  it.each(['limit=0', 'limit=invalid', 'cursor=invalid'])('rejects invalid query %s', async query => {
    expect((await tokens.GET(new Request(`http://localhost/api/bot-tokens?${query}`))).status).toBe(400);
    expect(mocks.prisma.botToken.findMany).not.toHaveBeenCalled();
  });
  it('applies numeric cursor and limit with one-row lookahead', async () => {
    mocks.prisma.botToken.findMany.mockResolvedValue([{ ...record, id: 6 }, { ...record, id: 7 }]);
    const response = await tokens.GET(new Request('http://localhost/api/bot-tokens?limit=1&cursor=5'));
    expect(await response.json()).toMatchObject({ data: [{ id: 6 }], meta: { limit: 1, nextCursor: '6' } });
    expect(mocks.prisma.botToken.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { gt: 5 } }, orderBy: { id: 'asc' }, take: 2 }));
  });
  it('returns null cursor for an exactly full final page', async () => {
    mocks.prisma.botToken.findMany.mockResolvedValue([record]);
    expect(await (await tokens.GET(new Request('http://localhost/api/bot-tokens?limit=1'))).json()).toMatchObject({ data: [{ id: 4 }], meta: { limit: 1, nextCursor: null } });
  });
  it('caps requested limits and returns null for empty pages', async () => {
    mocks.prisma.botToken.findMany.mockResolvedValue([]);
    expect(await (await tokens.GET(new Request('http://localhost/api/bot-tokens?limit=200'))).json()).toEqual({ data: [], meta: { limit: 100, nextCursor: null } });
    expect(mocks.prisma.botToken.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, take: 101 }));
  });
  it('does not audit creator information on a lookahead row excluded from the response', async () => {
    mocks.prisma.botToken.findMany.mockResolvedValue([record, { ...record, id: 5, createdBy: { id: 99, username: 'Not returned' } }]);
    expect((await tokens.GET(new Request('http://localhost/api/bot-tokens?limit=1'))).status).toBe(200);
    expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
  });
});
