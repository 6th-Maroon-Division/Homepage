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

test.each([false, true])('merge resolves overlapping history with sourceWins=%s without deleting target progress', async sourceWins => {
  const early = new Date('2020-01-01T00:00:00Z'), late = new Date('2021-01-01T00:00:00Z');
  const choose = (target: unknown[], source: unknown[]) => async ({ where }: { where: { userId: number } }) => where.userId === 6 ? target : source;
  mocks.db.authAccount.findMany.mockImplementation(choose([{ id: 1, provider: 'steam' }], [{ id: 2, provider: 'steam' }, { id: 3, provider: 'discord' }]));
  mocks.db.signup.findMany.mockImplementation(choose([{ id: 10, slotId: 100 }], [{ id: 11, slotId: 100 }]));
  mocks.db.attendance.findUnique.mockImplementation(async ({ where }) => where.signupId === 11 ? { id: 12, status: 'late', totalMinutesPresent: 90, notes: 'source' } : { id: 13, status: sourceWins ? 'absent' : 'present', totalMinutesPresent: 60, notes: sourceWins ? null : 'target' });
  const baseTraining = { trainingId: 1, trainerId: 9, completedAt: early, needsRetraining: false, isHidden: false, notes: null, trainingSessionCompletedAt: early, orbatQualifiedAt: early, failedAt: early, statusUpdatedAt: early };
  mocks.db.userTraining.findMany.mockImplementation(choose([{ ...baseTraining, id: 20, status: sourceWins ? 'approved' : 'qualified', isHidden: true }], [{ ...baseTraining, id: 21, status: 'finished', trainerId: null, notes: 'source', isHidden: true }]));
  const attendee = { sessionId: 2, attendedAt: null, completedAt: null, notes: null, trainingRequestId: null };
  mocks.db.trainingSessionAttendee.findMany.mockImplementation(choose([{ ...attendee, id: 30, status: sourceWins ? 'scheduled' : 'completed' }], [{ ...attendee, id: 31, status: 'attended', attendedAt: late, notes: 'source' }]));
  mocks.db.trainingRequestReadState.findMany.mockImplementation(choose([{ id: 40, requestId: 3, lastReadAt: late, lastReadMessageId: 100 }], [{ id: 41, requestId: 3, lastReadAt: sourceWins ? new Date('2022-01-01T00:00:00Z') : early, lastReadMessageId: 101 }]));
  mocks.db.trainingRequestSubscription.findMany.mockImplementation(choose([{ id: 50, requestId: 3, websiteEnabled: !sourceWins, discordEnabled: !sourceWins }], [{ id: 51, requestId: 3, websiteEnabled: sourceWins, discordEnabled: sourceWins }]));
  for (const [model, key] of [['promotionProposal', 'nextRankId'], ['orbatAttendanceNote', 'orbatId'], ['messageRecipient', 'messageId']] as const) mocks.db[model].findMany.mockImplementation(choose([{ id: 60, [key]: 7 }], [{ id: 61, [key]: 7 }]));
  mocks.db.userRank.findUnique.mockImplementation(async ({ where }) => ({ id: where.userId === 5 ? 70 : 71, currentRankId: where.userId === 6 && sourceWins ? null : 3, attendanceSinceLastRank: where.userId === 5 ? 7 : 4, retired: where.userId === 5, interviewDone: where.userId === 6 ? !sourceWins : true, lastRankedUpAt: where.userId === 6 ? (sourceWins ? late : early) : early }));
  const response = await POST(req(undefined, true));
  expect(response.status).toBe(200);
  expect((await response.json()).data.summary).toMatchObject({ movedAccounts: 1, discardedAccounts: 1, droppedDuplicateSignups: 1, droppedDuplicateTrainings: 1, droppedDuplicatePromotionProposals: 1, droppedDuplicateAttendanceNotes: 1, droppedDuplicateMessageRecipients: 1 });
  expect(mocks.db.attendance.update).toHaveBeenCalledWith({ where: { id: 13 }, data: { status: sourceWins ? 'late' : 'present', totalMinutesPresent: 90, notes: sourceWins ? 'source' : 'target' } });
  expect(mocks.db.trainingSessionAttendee.update.mock.lastCall![0].data.status).toBe(sourceWins ? 'attended' : 'completed');
  expect(mocks.db.trainingRequestReadState.update).toHaveBeenCalledTimes(sourceWins ? 1 : 0);
  expect(mocks.db.trainingRequestSubscription.update.mock.lastCall![0].data).toEqual({ websiteEnabled: true, discordEnabled: true });
  expect(mocks.db.userRank.update.mock.lastCall![0].data).toMatchObject({ currentRankId: 3, attendanceSinceLastRank: 7, retired: true, interviewDone: true, lastRankedUpAt: early });
});

test.each([false, true])('duplicate signup without a target attendance preserves available source attendance %s', async hasSource => {
  mocks.db.signup.findMany.mockResolvedValueOnce([{ id: 10, slotId: 100 }]).mockResolvedValueOnce([{ id: 11, slotId: 100 }]);
  mocks.db.attendance.findUnique.mockResolvedValueOnce(hasSource ? { id: 12 } : null).mockResolvedValueOnce(null);
  expect((await POST(req(undefined, true))).status).toBe(200);
  if (hasSource) expect(mocks.db.attendance.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { signupId: 10 } });
  else expect(mocks.db.attendance.update).not.toHaveBeenCalled();
});

test('merge transfers a source rank into an unranked target and rejects unknown database failures', async () => {
  mocks.db.userRank.findUnique.mockResolvedValueOnce({ id: 70 }).mockResolvedValueOnce(null);
  expect((await POST(req(undefined, true))).status).toBe(200);
  expect(mocks.db.userRank.update).toHaveBeenCalledWith({ where: { id: 70 }, data: { userId: 6 } });
  mocks.db.$transaction.mockRejectedValue({ code: 'P1001' });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { expect((await POST(req())).status).toBe(500); } finally { log.mockRestore(); }
});

test('target-only related rows do not trigger duplicate deletions', async () => {
  for (const [model, key] of [['signup', 'slotId'], ['userTraining', 'trainingId'], ['promotionProposal', 'nextRankId'], ['orbatAttendanceNote', 'orbatId'], ['messageRecipient', 'messageId']] as const) mocks.db[model].findMany.mockResolvedValueOnce([{ id: 10, [key]: 1 }]).mockResolvedValueOnce([]);
  expect((await POST(req(undefined, true))).status).toBe(200);
  expect(mocks.db.signup.deleteMany).not.toHaveBeenCalled();
  expect(mocks.db.userTraining.deleteMany).not.toHaveBeenCalled();
  expect(mocks.db.promotionProposal.deleteMany).not.toHaveBeenCalled();
});

test('CSRF requires its cookie even when a header is present', () => {
  expect(hasMergeCsrfToken(new Request('http://localhost', { headers: { 'x-csrf-token': 'known' } }))).toBe(false);
});

test.each([
 { key: 'unknown:key', value: 1, maxValue: 255 },
 { key: 'training:mark', value: 11, maxValue: 10 },
 { key: 'training:mark', value: 256, maxValue: 1000 },
])('merge rejects inherited invalid grants %#', async permission => {
  mocks.db.userPermission.findMany.mockImplementation(async ({ where }) => where.userId === 5 ? [{ permissionId: 1, value: permission.value, permission: { key: permission.key, maxValue: permission.maxValue } }] : []);
  expect((await POST(req(undefined, true))).status).toBe(422);
  expect(mocks.db.user.delete).not.toHaveBeenCalled();
});

test.each([false, true])('merge handles target permissions with duplicate=%s and preserves notification preferences', async duplicate => {
  const grant = { id: 81, permissionId: 1, value: 1, permission: { key: 'training:mark', maxValue: 255 } };
  mocks.db.userPermission.findMany.mockImplementation(async ({ where }) => where.userId === 6 ? [grant] : duplicate ? [{ ...grant, id: 80 }] : []);
  mocks.db.userNotificationPreference.findUnique.mockResolvedValueOnce({ id: 90 }).mockResolvedValueOnce(duplicate ? { id: 91 } : null);
  const response = await POST(req(undefined, true));
  expect(response.status).toBe(200);
  expect((await response.json()).data.summary.droppedDuplicatePermissions).toBe(duplicate ? 1 : 0);
  expect(mocks.db.userNotificationPreference.update).toHaveBeenCalledTimes(duplicate ? 0 : 1);
  if (duplicate) expect(mocks.db.userPermission.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [80] } } });
});

test('merge delegates valid inherited grants within the actor bounds', async () => {
  mocks.db.userPermission.findMany.mockImplementation(async ({ where }) => where.userId === 5 && !where.permission ? [{ permissionId: 1, value: 1, permission: { key: 'training:mark', maxValue: 255 } }] : []);
  expect((await POST(req())).status).toBe(200);
  expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data.after.inheritedPermissions).toEqual([{ permissionId: 1, value: 1 }]);
});

test('training merges retain target timestamps and notes when superior source status omits them', async () => {
  const date = new Date('2020-01-01T00:00:00Z');
  const target = { id: 20, trainingId: 1, status: 'approved', trainerId: 9, notes: 'target', trainingSessionCompletedAt: date, orbatQualifiedAt: date, failedAt: date, isHidden: false };
  const source = { id: 21, trainingId: 1, status: 'finished', trainerId: null, notes: null, trainingSessionCompletedAt: null, orbatQualifiedAt: null, failedAt: null, isHidden: true };
  mocks.db.userTraining.findMany.mockResolvedValueOnce([target]).mockResolvedValueOnce([source]);
  expect((await POST(req(undefined, true))).status).toBe(200);
  expect(mocks.db.userTraining.update.mock.lastCall![0].data).toMatchObject({ status: 'finished', notes: 'target', trainingSessionCompletedAt: date, orbatQualifiedAt: date, failedAt: date });
});
