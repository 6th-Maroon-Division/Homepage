import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), create: vi.fn() });
  const models = ['user', 'userPermission', 'botToken', 'authAccount', 'signup', 'userTraining', 'promotionProposal', 'orbatAttendanceNote', 'messageRecipient', 'trainingSessionAttendee', 'trainingRequestReadState', 'trainingRequestSubscription', 'userRank', 'userNotificationPreference', 'orbat', 'orbatTemplate', 'userTrainingStatusHistory', 'trainingRequest', 'trainingSession', 'trainingRequestMessage', 'attendance', 'attendanceSession', 'attendanceLog', 'attendanceEvent', 'legacyAttendanceData', 'legacyUserData', 'message', 'rankHistory', 'permissionAuditLog', 'squadRoleAuditLog', 'leaveOfAbsence', 'apiAuditLog'];
  const db = Object.fromEntries(models.map(name => [name, model()])) as Record<string, ReturnType<typeof model>> & { $transaction: ReturnType<typeof vi.fn> };
  db.$transaction = vi.fn();
  return { session: vi.fn(), publish: vi.fn(), db };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
import { POST } from '@/app/api/users/merge/route';
import { hasMergeCsrfToken } from '@/lib/api/user-merge';
const req = (body: unknown = { sourceUserId: 5, targetUserId: 6 }, bot = false, csrf = true, query = '') => new Request(`http://localhost/api/users/merge${query}`, { method: 'POST', headers: { ...(bot ? { authorization: 'Bearer bot' } : {}), ...(csrf ? { cookie: 'next-auth.csrf-token=known%7Chash', 'x-csrf-token': 'known' } : {}) }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, model] of Object.entries(mocks.db)) {
    if (key === '$transaction' || !('findMany' in model)) continue;
    model.findMany.mockResolvedValue([]); model.updateMany.mockResolvedValue({ count: 0 });
  }
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'user:manage' }, value: 10 }, { permission: { key: 'user:manage_permissions' }, value: 10 }, { permission: { key: 'training:mark' }, value: 10 }] });
  mocks.db.user.findMany.mockResolvedValue([{ id: 5 }, { id: 6 }]);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
test('merge accepts sessions with CSRF and bots without it and rejects invalid credentials', async () => {
  expect((await POST(req())).status).toBe(200);
  expect((await POST(req(undefined, true, false))).status).toBe(200);
  expect((await POST(req(undefined, false, false))).status).toBe(403);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await POST(req(undefined, true))).status).toBe(401);
  mocks.session.mockResolvedValue(null);
  expect((await POST(req())).status).toBe(401);
});
test('CSRF parser handles malformed mismatching and secure cookies', () => {
  expect(hasMergeCsrfToken(new Request('http://localhost', { headers: { cookie: '__Host-next-auth.csrf-token=abc%7Chash', 'x-csrf-token': 'abc' } }))).toBe(true);
  for (const cookie of ['next-auth.csrf-token=%invalid', 'next-auth.csrf-token=different%7Chash', 'next-auth.csrf-token=wrong%7Chash', '']) expect(hasMergeCsrfToken(new Request('http://localhost', { headers: { cookie, 'x-csrf-token': 'known' } }))).toBe(false);
});
test.each([null, [], {}, { sourceUserId: '5', targetUserId: 6 }, { sourceUserId: 5, targetUserId: 5 }, { sourceUserId: 0, targetUserId: 6 }, { sourceUserId: 5, targetUserId: 2147483648 }, { sourceUserId: 5, targetUserId: 6, actorId: 4 }])('merge rejects strict body%j', async body => expect((await POST(req(body))).status).toBe(422));
test('merge rejects own account either side and target hierarchy before mutations', async () => {
  expect((await POST(req({ sourceUserId: 4, targetUserId: 6 }))).status).toBe(403);
  expect((await POST(req({ sourceUserId: 5, targetUserId: 4 }))).status).toBe(403);
  mocks.db.userPermission.findMany.mockResolvedValueOnce([{ permission: { key: 'user:manage' }, value: 10 }]);
  expect((await POST(req())).status).toBe(403);
  expect(mocks.db.user.delete).not.toHaveBeenCalled();
});
test('merge preflights inherited permission bounds rather than bypassing delegation', async () => {
  mocks.db.userPermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ permissionId: 10, value: 10, permission: { key: 'training:mark', maxValue: 255 } }]).mockResolvedValueOnce([]);
  expect((await POST(req())).status).toBe(403);
  expect(mocks.db.authAccount.delete).not.toHaveBeenCalled();
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'user:manage' }, value: 10 }] });
  mocks.db.userPermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ permissionId: 10, value: 1, permission: { key: 'training:mark', maxValue: 255 } }]).mockResolvedValueOnce([]);
  expect((await POST(req())).status).toBe(403);
});
test('merge audits both users atomically and no credential or profile snapshots escape', async () => {
  const response = await POST(req(undefined, true));
  expect((await response.json()).data).toMatchObject({ removedUserId: 5, mergedIntoUserId: 6, summary: { movedAccounts: 0 } });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user.merged', actorTokenId: 9, targetUserIds: [5, 6], before: { sourceUserId: 5, targetUserId: 6 } }) });
  expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 60000 });
});
test('missing users query and invalid JSON are canonical errors', async () => {
  mocks.db.user.findMany.mockResolvedValue([{ id: 5 }]);
  expect((await POST(req())).status).toBe(404);
  expect((await POST(req(undefined, false, true, '?other=1'))).status).toBe(400);
  expect((await POST(new Request('http://localhost/api', { method: 'POST', headers: { authorization: 'Bearer bot' }, body: '{' }))).status).toBe(400);
});
test('audit failure suppresses notifications and postcommit failures preserve success', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.apiAuditLog.create.mockRejectedValueOnce(new Error('Audit unavailable'));
  expect((await POST(req())).status).toBe(500);
  expect(mocks.publish).not.toHaveBeenCalled();
  mocks.publish.mockImplementation(() => { throw new Error('Listener failure'); });
  expect((await POST(req())).status).toBe(200);
  log.mockRestore();
});
test.each([['P2025', 404], ['P2002', 409], ['P2003', 409], ['P2034', 409]])('maps%s merge errors', async (code, status) => {
  mocks.db.$transaction.mockRejectedValue({ code });
  expect((await POST(req())).status).toBe(status);
});
