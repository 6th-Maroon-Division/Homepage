import { beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => { const model = () => ({ findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(), create: vi.fn(), findFirst: vi.fn() }); return { session: vi.fn(), publish: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), apiAuditLog: model(), trainingRequest: model(), trainingRequestMessage: model(), $transaction: vi.fn() } }; });
vi.mock('@/lib/prisma', () => ({ prisma: m.db })); vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: m.publish }));
import { GET, PATCH, DELETE } from '@/app/api/users/[id]/route';
const context = (id = 'me') => ({ params: Promise.resolve({ id }) });
const request = (method = 'GET', body?: unknown, token?: string) => new Request('http://localhost/api/users/me', { method, headers: token ? { authorization: token } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const user = { id: 4, username: 'Member', email: 'member@example.test', avatarUrl: '/uploads/avatars/a.png', createdAt: new Date('2026-01-01T00:00:00Z'), accounts: [{ provider: 'steam' }] };
beforeEach(() => {
  vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: 4 } });
  m.db.user.findUnique.mockImplementation(async args => args.select.userPermissions ? { userPermissions: [{ permission: { key: 'user:manage' }, value: 10 }] } : user);
  m.db.userPermission.findMany.mockResolvedValue([]); m.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  m.db.user.update.mockImplementation(async ({ data }) => ({ ...user, ...data }));
  m.db.trainingRequest.count.mockResolvedValue(0); m.db.trainingRequestMessage.count.mockResolvedValue(0);
  m.db.$transaction.mockImplementation(async cb => cb(m.db));
});
test('profile self read has explicit DTO and no audit; other-user and bot reads are audited', async () => {
  expect(await (await GET(request(), context())).json()).toEqual({ data: { id: 4, username: 'Member', email: 'member@example.test', avatarUrl: '/uploads/avatars/a.png', createdAt: '2026-01-01T00:00:00.000Z', providers: ['steam'] }, meta: {} });
  expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();
  await GET(request(), context('5')); expect(m.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
  await GET(request('GET', undefined, 'Bearer valid'), context('4')); expect(m.db.apiAuditLog.create.mock.lastCall![0].data.actorTokenId).toBe(9);
});
test('strict profile patch normalizes fields and atomically audits redacted values', async () => {
  const response = await PATCH(request('PATCH', { username: ' Updated ', email: null, avatarUrl: 'https://example.test/avatar.png' }), context());
  expect((await response.json()).data).toMatchObject({ username: 'Updated', email: null });
  expect(m.db.$transaction.mock.lastCall![1]).toEqual({ isolationLevel: 'Serializable' });
  const audit = m.db.apiAuditLog.create.mock.lastCall![0].data;
  expect(audit.before.email).toBe('[REDACTED]'); expect(audit.after.avatarUrl).toBe('[REDACTED]'); expect(m.publish).toHaveBeenCalled();
});
test.each([{}, null, [], { admin: true }, { username: '' }, { username: 'x'.repeat(51) }, { email: 5 }, { email: 'bad' }, { avatarUrl: 'data:image/png;base64,secret' }, { avatarUrl: '//example.test/avatar' }, { avatarUrl: '/\\example.test' }, { avatarUrl: 'ftp://example.test/a' }, { avatarUrl: 4 }, { avatarUrl: 'bad' }])('rejects invalid patch %j without writes', async body => {
  expect((await PATCH(request('PATCH', body), context())).status).toBe(422); expect(m.db.user.update).not.toHaveBeenCalled();
});
test('empty avatar clears, email trims and relative avatar paths work', async () => {
  expect((await PATCH(request('PATCH', { avatarUrl: '', email: ' valid@example.test ' }), context())).status).toBe(200);
  expect(m.db.user.update.mock.lastCall![0].data).toEqual({ avatarUrl: null, email: 'valid@example.test' });
  expect((await PATCH(request('PATCH', { avatarUrl: '/uploads/avatars/b.png' }), context())).status).toBe(200);
});
test('invalid IDs, bot me alias, queries, malformed JSON, missing and invalid credentials reject', async () => {
  expect((await GET(request(), context('2147483648'))).status).toBe(400);
  expect((await GET(request('GET', undefined, 'Bearer valid'), context())).status).toBe(400);
  expect((await GET(new Request('http://localhost/api/users/4?x=1'), context('4'))).status).toBe(400);
  expect((await PATCH(new Request('http://localhost/api/users/me', { method: 'PATCH', body: '{' }), context())).status).toBe(400);
  m.session.mockResolvedValue(null); expect((await GET(request(), context('4'))).status).toBe(401);
  m.db.botToken.findFirst.mockResolvedValue(null); expect((await GET(request('GET', undefined, 'Bearer bad'), context('4'))).status).toBe(401);
});
test('equal hierarchy and self deletion reject before mutation', async () => {
  m.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:manage' }, value: 10 }]);
  expect((await GET(request(), context('5'))).status).toBe(403);
  expect((await PATCH(request('PATCH', { username: 'Other' }), context('5'))).status).toBe(403);
  expect((await DELETE(request('DELETE'), context())).status).toBe(403);
  expect(m.db.user.delete).not.toHaveBeenCalled();
});
test('deletion protects training history and returns null on allowed deletion', async () => {
  m.db.trainingRequest.count.mockResolvedValue(1); expect((await DELETE(request('DELETE'), context('5'))).status).toBe(409);
  m.db.trainingRequest.count.mockResolvedValue(0); m.db.trainingRequestMessage.count.mockResolvedValue(1); expect((await DELETE(request('DELETE'), context('5'))).status).toBe(409);
  m.db.trainingRequestMessage.count.mockResolvedValue(0);
  expect(await (await DELETE(request('DELETE', undefined, 'Bearer valid'), context('5'))).json()).toEqual({ data: null, meta: {} });
});
test.each([['P2025',404],['P2002',409],['P2003',409],['P2034',409]])('maps database error %s', async (code, status) => {
  m.db.$transaction.mockRejectedValue({ code }); expect((await GET(request(), context())).status).toBe(status);
});
test('missing users404, required audit failure500 and postcommit listener failure preserves success', async () => {
  m.db.user.findUnique.mockImplementation(async args => args.select.userPermissions ? { userPermissions: [] } : null);
  expect((await GET(request(), context())).status).toBe(404);
  m.db.user.findUnique.mockResolvedValue({ ...user, userPermissions: [] });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    m.db.apiAuditLog.create.mockRejectedValue(new Error('audit unavailable'));
    expect((await PATCH(request('PATCH', { username: 'Edited' }), context())).status).toBe(500);
    m.db.apiAuditLog.create.mockResolvedValue({}); m.publish.mockImplementation(() => { throw new Error('listener'); });
    expect((await PATCH(request('PATCH', { username: 'Edited' }), context())).status).toBe(200);
  } finally { log.mockRestore(); }
});
