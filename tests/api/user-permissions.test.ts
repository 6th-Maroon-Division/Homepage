import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), db: { user: model(), botToken: model(), userPermission: model(), permission: model(), permissionAuditLog: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
import { GET, PATCH } from '@/app/api/users/[id]/permissions/route';
import { GET as audit } from '@/app/api/users/[id]/permissions/audit/route';
import { parseUserPermissionUpdate } from '@/lib/api/user-permissions';
const ctx = (id = '5') => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body: unknown = { permissions: [{ permissionId: 10, value: 3 }] }, token = false, query = '') => new Request(`http://localhost/api/users/5/permissions${query}`, { method, headers: token ? { authorization: 'Bearer bot' } : {}, ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ id: 5, username: 'Target', userPermissions: [{ permission: { key: 'user:manage_permissions' }, value: 10 }, { permission: { key: 'training:mark' }, value: 10 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.permission.findMany.mockResolvedValue([{ id: 10, key: 'training:mark', description: 'Mark training', defaultValue: 0, maxValue: 20 }]);
  mocks.db.permissionAuditLog.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const routes = [['GET', GET], ['PATCH', PATCH], ['audit', audit]] as const;
test.each(routes)('%s validates sessions bots live grants and no invalid Bearer fallback', async (name, route) => {
  const method = name === 'PATCH' ? 'PATCH' : 'GET';
  expect((await route(req(method), ctx())).status).toBe(200);
  expect((await route(req(method, undefined, true), ctx())).status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await route(req(method, undefined, true), ctx())).status).toBe(401);
  mocks.session.mockResolvedValue(null);
  expect((await route(req(method), ctx())).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await route(req(method), ctx())).status).toBe(403);
});
test.each(routes)('%s guards target hierarchy and missing targets', async (name, route) => {
  const method = name === 'PATCH' ? 'PATCH' : 'GET';
  mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:manage_permissions' }, value: 10 }]);
  expect((await route(req(method), ctx())).status).toBe(403);
  mocks.db.user.findUnique.mockResolvedValueOnce({ userPermissions: [{ permission: { key: 'user:manage_permissions' }, value: 10 }] }).mockResolvedValueOnce(null);
  expect((await route(req(method), ctx())).status).toBe(404);
});
test('GET returns full permission resource defaults and audits another user only', async () => {
  const response = await GET(req(), ctx());
  expect((await response.json()).data.permissions).toEqual([{ id: 10, key: 'training:mark', description: 'Mark training', defaultValue: 0, maxValue: 20, currentValue: 0 }]);
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_data.read', targetUserIds: [5] }) });
  mocks.db.apiAuditLog.create.mockClear();
  expect((await GET(req(), ctx('me'))).status).toBe(200);
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  expect((await GET(req('GET', undefined, true), ctx('me'))).status).toBe(400);
});
test.each([null, [], {}, { permissions: [] }, { permissions: [{ permissionId: '10', value: 3 }] }, { permissions: [{ permissionId: 0, value: 3 }] }, { permissions: [{ permissionId: 10, value: 256 }] }, { permissions: [{ permissionId: 10, value: 1.5 }] }, { permissions: [{ permissionId: 10, value: 3 }, { permissionId: 10, value: 4 }] }, { permissions: [{ permissionId: 10, value: 3, actorId: 4 }] }])('rejects strict permission input%j', body => expect(parseUserPermissionUpdate(body)).toBeNull());
test('PATCH forbids self and excessive delegation including superadmin privilege escalation', async () => {
  expect((await PATCH(req('PATCH'), ctx('me'))).status).toBe(403);
  expect((await PATCH(req('PATCH', { permissions: [{ permissionId: 10, value: 10 }] }), ctx())).status).toBe(403);
  mocks.db.permission.findMany.mockResolvedValue([{ id: 10, key: 'system:super_admin', maxValue: 255 }]);
  expect((await PATCH(req('PATCH'), ctx())).status).toBe(403);
  expect((await PATCH(req('PATCH', undefined, true), ctx())).status).toBe(200);
});
test('PATCH respects catalog max refs and immutable unsupported permission keys', async () => {
  expect((await PATCH(req('PATCH', { permissions: [{ permissionId: 10, value: 21 }] }, true), ctx())).status).toBe(422);
  mocks.db.permission.findMany.mockResolvedValue([]);
  expect((await PATCH(req('PATCH'), ctx())).status).toBe(404);
  mocks.db.permission.findMany.mockResolvedValue([{ id: 10, key: 'unknown:key', maxValue: 255 }]);
  expect((await PATCH(req('PATCH', undefined, true), ctx())).status).toBe(422);
});
test('PATCH records changed values atomically and bot legacy audit nullable actor with no request metadata', async () => {
  const response = await PATCH(req('PATCH', undefined, true), ctx());
  expect(await response.json()).toEqual({ data: null, meta: {} });
  expect(mocks.db.userPermission.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: 5, permissionId: 10, value: 3 } }));
  expect(mocks.db.permissionAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: null, action: 'GRANT', metadata: { actorType: 'bot', actorTokenId: 9 }, oldValue: null, newValue: 3 }) });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_permissions.updated', actorTokenId: 9, before: { permissions: [{ permissionId: 10, value: 0 }] }, after: { permissions: [{ permissionId: 10, value: 3 }] } }) });
});
test('PATCH no-op skips audit and revoke deletes only selected permission', async () => {
  expect((await PATCH(req('PATCH', { permissions: [{ permissionId: 10, value: 0 }] }), ctx())).status).toBe(200);
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  mocks.db.userPermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ permissionId: 10, value: 3 }]);
  expect((await PATCH(req('PATCH', { permissions: [{ permissionId: 10, value: 0 }] }), ctx())).status).toBe(200);
  expect(mocks.db.userPermission.deleteMany).toHaveBeenCalledWith({ where: { userId: 5, permissionId: 10 } });
  expect(mocks.db.permissionAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'REVOKE', oldValue: 3, newValue: null }) });
});
test('audit history projects nullable actors UTC dates without metadata and audits returned actors excluding self', async () => {
  const row = (id: number, actor: { id: number; username: string } | null, metadata: unknown) => ({ id, actor, metadata, action: 'GRANT', oldValue: null, newValue: 3, reason: null, permission: { key: 'training:mark', description: null }, createdAt: new Date('2026-01-01T00:00:00Z') });
  mocks.db.permissionAuditLog.findMany.mockResolvedValue([row(9, null, { actorType: 'bot', ipAddress: 'secret' }), row(8, { id: 4, username: 'Self' }, {}), row(7, { id: 6, username: 'Lookahead' }, {})]);
  const response = await audit(req('GET', undefined, false, '?limit=2'), ctx());
  const body = await response.json();
  expect(body.meta).toEqual({ limit: 2, nextCursor: '8' });
  expect(body.data[0]).toMatchObject({ actor: null, actorType: 'bot', createdAt: '2026-01-01T00:00:00.000Z' });
  expect(body.data[0]).not.toHaveProperty('metadata');
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetUserIds: [5] }) });
  mocks.db.permissionAuditLog.findMany.mockResolvedValue([row(8, null, {})]);
  expect((await (await audit(req(), ctx())).json()).data[0].actorType).toBe('deleted_user');
});
test('routes reject invalid IDs JSON and obsolete or duplicate query formats', async () => {
  expect((await PATCH(new Request('http://localhost/api', { method: 'PATCH', body: '{' }), ctx())).status).toBe(400);
  expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(422);
  expect((await GET(req('GET', undefined, false, '?page=1'), ctx())).status).toBe(400);
  for (const query of ['?offset=1', '?action=unknown', '?cursor=0', '?limit=1&limit=2']) expect((await audit(req('GET', undefined, false, query), ctx())).status).toBe(400);
  for (const [, route] of routes) expect((await route(req(), ctx('2147483648'))).status).toBe(400);
});
test('audit failure fails closed and successful postcommit listener failure remains successful', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.apiAuditLog.create.mockRejectedValueOnce(new Error('Audit unavailable'));
  expect((await PATCH(req('PATCH'), ctx())).status).toBe(500);
  expect(mocks.publish).not.toHaveBeenCalled();
  mocks.publish.mockImplementation(() => { throw new Error('Listener failed'); });
  expect((await PATCH(req('PATCH'), ctx())).status).toBe(200);
  log.mockRestore();
});
test.each([['P2025', 404], ['P2002', 409], ['P2003', 409], ['P2034', 409]])('maps%s transaction errors', async (code, status) => {
  mocks.db.$transaction.mockRejectedValue({ code });
  expect((await PATCH(req('PATCH'), ctx())).status).toBe(status);
});
