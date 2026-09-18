import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => { const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() }); return { session: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), orbat: model(), signup: model(), attendance: model(), attendanceLog: model(), apiAuditLog: model(), $transaction: vi.fn() } }; });
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { POST } from '@/app/api/orbats/[id]/attendance/import/route';
const row = () => ({ username: 'Member', date: '2020-01-01', status: 'P' });
const request = (body: unknown = { records: [row()] }, auth?: string, query = '') => new Request(`http://localhost/api/orbats/20/attendance/import${query}`, { method: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
const context = (id = '20') => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.session.mockResolvedValue({ user: { id: 4 } }); mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'attendance:edit' }, value: 2 }] }); mocks.db.userPermission.findMany.mockResolvedValue([]); mocks.db.user.findMany.mockResolvedValue([{ id: 5 }]); mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.orbat.findUnique.mockResolvedValue({ isSideOp: false, startsAtUtc: new Date('2020-01-01T23:00:00Z'), eventDate: null }); mocks.db.signup.findFirst.mockResolvedValue({ id: 7 }); mocks.db.attendance.create.mockResolvedValue({ id: 8 }); mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
test('session and bot use shared protected contract; invalid explicit tokens never fall back', async () => {
  expect((await POST(request(), context())).status).toBe(200); expect((await POST(request(undefined, 'Bearer active'), context())).status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null); expect((await POST(request(undefined, 'Bearer revoked'), context())).status).toBe(401);
  mocks.session.mockResolvedValue(null); expect((await POST(request(), context())).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: 4 } }); mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] }); expect((await POST(request(), context())).status).toBe(403);
});
test('imports statuses atomically, scopes signup to operation, preserves log semantics and metadata-only audits', async () => {
  const records = ['P','A','NA','LOA','NO','EO'].map((status, i) => ({ ...row(), username: `User${i}`, status }));
  mocks.db.user.findMany.mockImplementation(async ({ where }) => [{ id: 10 + Number(where.username.slice(4)) }]);
  const response = await POST(request({ records }), context()); expect(await response.json()).toEqual({ data: { imported: 4, skipped: 2, total: 6 }, meta: {} });
  expect(mocks.db.attendance.create.mock.calls.map(([call]) => call.data.status)).toEqual(['present','absent','absent','absent']);
  expect(mocks.db.signup.findFirst.mock.calls[0][0].where).toEqual({ userId: 10, slot: { orbatId: 20 } });
  expect(mocks.db.$transaction.mock.lastCall![1]).toEqual({ isolationLevel: 'Serializable', timeout: 30000 });
  expect(mocks.db.attendanceLog.create.mock.lastCall![0].data).toMatchObject({ changedById: 4, action: 'imported', source: 'legacy_import' });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledTimes(4); expect(JSON.stringify(mocks.db.apiAuditLog.create.mock.calls)).not.toContain('User0');
});
test('bot log has no fabricated session actor', async () => { expect((await POST(request(undefined, 'Bearer active'), context())).status).toBe(200); expect(mocks.db.attendanceLog.create.mock.lastCall![0].data.changedById).toBeNull(); });
test.each([{}, { records: [] }, { records: Array(101).fill(row()) }, { records: [row()], extra: true }, { records: [{ ...row(), extra: true }] }, { records: [{ ...row(), status: 'unknown' }] }, { records: [{ ...row(), date: '2020-02-30' }] }, { records: [{ ...row(), date: '2020-01-01T00:00:00Z' }] }, { records: [row(), row()] }, { records: [{ ...row(), username: ' ' }] }])('strict payload rejects malformed row %# before DB writes', async body => { expect((await POST(request(body), context())).status).toBe(422); expect(mocks.db.$transaction).not.toHaveBeenCalled(); });
test('bad paths, query arguments, malformed JSON reject with correlation IDs', async () => {
  expect((await POST(request(), context('2147483648'))).status).toBe(400); expect((await POST(request(undefined, undefined, '?limit=1'), context())).status).toBe(400);
  const response = await POST(new Request('http://localhost/api/test', { method: 'POST', body: '{' }), context()); expect(response.status).toBe(400); expect(response.headers.get('X-Request-Id')).toBeTruthy();
});
test('operation existence, side-op and UTC date are validated', async () => {
  expect((await POST(request({ records: [{ ...row(), date: '2020-01-02' }] }), context())).status).toBe(422);
  mocks.db.orbat.findUnique.mockResolvedValue(null); expect((await POST(request(), context())).status).toBe(404);
  mocks.db.orbat.findUnique.mockResolvedValue({ isSideOp: true }); expect((await POST(request(), context())).status).toBe(409);
  mocks.db.orbat.findUnique.mockResolvedValue({ isSideOp: false, startsAtUtc: null, eventDate: null }); expect((await POST(request(), context())).status).toBe(409);
  mocks.db.orbat.findUnique.mockResolvedValue({ isSideOp: false, startsAtUtc: null, eventDate: new Date('2020-01-01T00:00:00Z') }); expect((await POST(request(), context())).status).toBe(200);
});
test('missing and ambiguous usernames, signup absence and duplicate attendance stop all writes', async () => {
  mocks.db.user.findMany.mockResolvedValue([]); expect((await POST(request(), context())).status).toBe(404);
  mocks.db.user.findMany.mockResolvedValue([{ id: 5 }, { id: 6 }]); expect((await POST(request(), context())).status).toBe(409);
  mocks.db.user.findMany.mockResolvedValue([{ id: 5 }]); mocks.db.signup.findFirst.mockResolvedValue(null); expect((await POST(request(), context())).status).toBe(404);
  mocks.db.signup.findFirst.mockResolvedValue({ id: 7 }); mocks.db.attendance.findFirst.mockResolvedValue({ id: 9 }); expect((await POST(request(), context())).status).toBe(409); expect(mocks.db.attendance.create).not.toHaveBeenCalled();
});
test('later target hierarchy denial prevents earlier valid rows from being written', async () => {
  mocks.db.userPermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ permission: { key: 'attendance:edit' }, value: 2 }]);
  expect((await POST(request({ records: [row(), { ...row(), username: 'Other' }] }), context())).status).toBe(403); expect(mocks.db.attendance.create).not.toHaveBeenCalled();
});
test.each(['P2034','P2002','P2003'])('database conflict %s uses consistent envelope', async code => { mocks.db.$transaction.mockRejectedValue({ code }); expect((await POST(request(), context())).status).toBe(409); });
test('audit failure fails closed without exposing details', async () => { const log = vi.spyOn(console, 'error').mockImplementation(() => {}); mocks.db.apiAuditLog.create.mockRejectedValue(new Error('private details')); const response = await POST(request(), context()); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('private details'); log.mockRestore(); });
