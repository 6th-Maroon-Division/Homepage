import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), training: model(), apiAuditLog: model(), attendance: model(), legacyAttendanceData: model(), legacyUserData: model() } };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
import { GET } from '@/app/api/users/onboarding/route';
const req = (query = '', bot = false) => new Request(`http://localhost/api/users/onboarding${query}`, { headers: bot ? { authorization: 'Bearer bot' } : {} });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'user:manage' }, value: 10 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.training.findMany.mockResolvedValue([]);
  mocks.db.user.findMany.mockResolvedValue([]);
  mocks.db.attendance.count.mockResolvedValue(2);
  mocks.db.legacyAttendanceData.count.mockResolvedValue(1);
  mocks.db.legacyUserData.findMany.mockResolvedValue([{ oldData: 3 }]);
});
test('onboarding requires live session/bot grants and rejects absent invalid credentials', async () => {
  expect((await GET(req())).status).toBe(200);
  expect((await GET(req('', true))).status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await GET(req('', true))).status).toBe(401);
  mocks.session.mockResolvedValue(null);
  expect((await GET(req())).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await GET(req())).status).toBe(403);
});
test('SQL scopes hierarchy and missing training before pagination with strict flag predicates', async () => {
  mocks.db.training.findMany.mockResolvedValue([{ id: 20, requiresOrbatQualification: true }, { id: 21, requiresOrbatQualification: false }]);
  expect((await GET(req('?interviewDone=false&retired=true&requiredTrainingsCompleted=false&cursor=3&limit=2'))).status).toBe(200);
  const query = mocks.db.user.findMany.mock.calls[0][0];
  expect(query).toMatchObject({ orderBy: { id: 'asc' }, take: 3 });
  expect(query.where.AND).toEqual(expect.arrayContaining([{ id: { gt: 3 } }, { userRank: { retired: true } }, { OR: [{ userRank: null }, { userRank: { interviewDone: false } }] }]));
  expect(JSON.stringify(query.where)).toContain('user:manage');
  expect(JSON.stringify(query.where)).toContain('userTrainings');
  expect(JSON.stringify(query.where)).toContain('finished');
});
test('DTO counts real attendance uses empty requirements complete and excludes lookahead/self from audit', async () => {
  const row = (id: number) => ({ id, username: `User ${id}`, userRank: null, userTrainings: [] });
  mocks.db.user.findMany.mockResolvedValue([row(4), row(5), row(6)]);
  const response = await GET(req('?limit=2'));
  expect(await response.json()).toEqual({ data: [{ id: 4, username: 'User 4', userRank: null, attendanceTotal: 6, requiredTrainingsCompleted: true }, { id: 5, username: 'User 5', userRank: null, attendanceTotal: 6, requiredTrainingsCompleted: true }], meta: { limit: 2, nextCursor: '5' } });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetUserIds: [5], resource: 'user_onboarding', action: 'user_data.read' }) });
  expect(mocks.db.attendance.count).toHaveBeenCalledTimes(2);
});
test('qualification-sensitive training statuses and final page cursor are consistent', async () => {
  mocks.db.training.findMany.mockResolvedValue([{ id: 20, requiresOrbatQualification: true }, { id: 21, requiresOrbatQualification: false }]);
  mocks.db.user.findMany.mockResolvedValue([{ id: 5, username: 'User', userRank: { interviewDone: true, retired: false }, userTrainings: [{ trainingId: 20, status: 'qualified' }, { trainingId: 21, status: 'finished' }] }]);
  const response = await GET(req('?requiredTrainingsCompleted=true'));
  expect((await response.json()).data[0].requiredTrainingsCompleted).toBe(true);
  mocks.db.user.findMany.mockResolvedValue([{ id: 5, username: 'User', userRank: null, userTrainings: [{ trainingId: 20, status: 'finished' }, { trainingId: 21, status: 'finished' }] }]);
  expect((await (await GET(req())).json()).data[0].requiredTrainingsCompleted).toBe(false);
});
test('self-only empty pages have no audit; required audit failure withholds personal data', async () => {
  mocks.db.user.findMany.mockResolvedValue([{ id: 4, username: 'Self', userRank: null, userTrainings: [] }]);
  expect((await GET(req())).status).toBe(200);
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  mocks.db.user.findMany.mockResolvedValue([{ id: 5, username: 'Private name', userRank: null, userTrainings: [] }]);
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await GET(req());
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('Private name');
  log.mockRestore();
});
test.each(['?page=1', '?sort=username', '?bct=done', '?retired=all', '?interviewDone=1', '?requiredTrainingsCompleted=invalid', '?limit=0', '?cursor=2147483648', '?limit=1&limit=2'])('strict query rejects%s', async query => expect((await GET(req(query))).status).toBe(400));
