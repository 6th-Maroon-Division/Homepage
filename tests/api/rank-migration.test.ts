import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), count: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), rank: model(), userRank: model(), rankHistory: model(), authAccount: model(), botEvent: model(), apiAuditLog: model(), attendance: model(), legacyAttendanceData: model(), legacyUserData: model(), $transaction: vi.fn() } };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
import { POST as preview } from '@/app/api/ranks/migrate/preview/route';
import { POST as apply } from '@/app/api/ranks/migrate/apply/route';
import { parseRankMigration } from '@/lib/api/rank-migration';
const req = (body: unknown = { strategy: 'map', rankMappings: [{ oldRankId: 10, newRankId: 11 }] }, token = false, query = '') => new Request(`http://localhost/api/ranks/migrate/preview${query}`, { method: 'POST', headers: token ? { authorization: 'Bearer bot' } : {}, body: JSON.stringify(body) });
const low = { id: 10, name: 'Before', orderIndex: 0, attendanceRequiredSinceLastRank: 0 };
const high = { id: 11, name: 'After', orderIndex: 1, attendanceRequiredSinceLastRank: 5 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'rank:edit' }, value: 2 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.rank.findMany.mockResolvedValue([low, high]);
  mocks.db.userRank.findMany.mockResolvedValue([{ userId: 5, user: { id: 5, username: 'Target' }, currentRankId: 10, currentRank: low, attendanceSinceLastRank: 1, lastRankedUpAt: new Date(0) }]);
  mocks.db.attendance.count.mockResolvedValue(2);
  mocks.db.legacyAttendanceData.count.mockResolvedValue(1);
  mocks.db.legacyUserData.findMany.mockResolvedValue([{ oldData: 3 }]);
  mocks.db.userRank.update.mockImplementation(async ({ data }) => data);
  mocks.db.rankHistory.create.mockResolvedValue({ id: 20 });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
test.each([['preview', preview], ['apply', apply]] as const)('%s requires live session/bot permission', async (_name, route) => {
  expect((await route(req())).status).toBe(200);
  expect((await route(req(undefined, true))).status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await route(req(undefined, true))).status).toBe(401);
  mocks.session.mockResolvedValue(null);
  expect((await route(req())).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await route(req())).status).toBe(403);
});
test.each([null, [], {}, { strategy: 'invalid' }, { strategy: 'grandfather', rankMappings: [] }, { strategy: 'map' }, { strategy: 'map', rankMappings: [] }, { strategy: 'map', rankMappings: [{ oldRankId: '10', newRankId: 11 }] }, { strategy: 'map', rankMappings: [{ oldRankId: 10, newRankId: 0 }] }, { strategy: 'map', rankMappings: [{ oldRankId: 10, newRankId: 11 }, { oldRankId: 10, newRankId: 12 }] }])('strict migration parser rejects%j', body => expect(parseRankMigration(body)).toBeNull());
test('routes reject JSON queries strict bodies and missing mapping refs before writes', async () => {
  for (const route of [preview, apply]) {
    expect((await route(new Request('http://localhost/api', { method: 'POST', body: '{' }))).status).toBe(400);
    expect((await route(req(undefined, false, '?strategy=map'))).status).toBe(400);
    expect((await route(req({ strategy: 'bad' }))).status).toBe(422);
    expect((await route(req({ strategy: 'map', rankMappings: [{ oldRankId: 10, newRankId: 12 }] }))).status).toBe(404);
  }
  expect(mocks.db.userRank.update).not.toHaveBeenCalled();
});
test('preview and recalculation use actual modern plus legacy attendance rather than rank baseline', async () => {
  const response = await preview(req({ strategy: 'recalculate' }));
  expect((await response.json()).data).toEqual({ totalUsers: 1, promoted: 1, demoted: 0, unchanged: 0, changes: [{ userId: 5, username: 'Target', currentRankName: 'Before', newRankName: 'After', attendanceTotal: 6, changeType: 'promotion' }] });
  expect(mocks.db.userRank.update).not.toHaveBeenCalled();
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_data.read', resource: 'rank_migration', targetUserIds: [5] }) });
});
test('apply resets baseline to actual attendance preserves other flags and audits UTC metadata', async () => {
  const response = await apply(req());
  expect((await response.json()).data).toEqual({ totalProcessed: 1, promoted: 1, demoted: 0, unchanged: 0 });
  expect(mocks.db.userRank.update).toHaveBeenCalledWith({ where: { userId: 5 }, data: { currentRankId: 11, attendanceSinceLastRank: 6, lastRankedUpAt: expect.any(Date) } });
  expect(mocks.db.rankHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ attendanceTotalAtChange: 6, attendanceDeltaSinceLastRank: 5, triggeredBy: 'system_migration', triggeredByUserId: 4 }) });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_rank.migrated', after: expect.objectContaining({ strategy: 'map', attendanceSinceLastRank: 6 }) }) });
  expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 60000 });
});
test('all target permissions preflight before writes and grandfather changes nothing', async () => {
  mocks.db.userPermission.findMany.mockResolvedValueOnce([{ permission: { key: 'rank:edit' }, value: 2 }]);
  expect((await apply(req())).status).toBe(403);
  expect(mocks.db.userRank.update).not.toHaveBeenCalled();
  expect((await (await apply(req({ strategy: 'grandfather' }))).json()).data.unchanged).toBe(1);
  expect(mocks.db.userRank.update).not.toHaveBeenCalled();
});
test('preview self-only has no audit and missing ranks are skipped', async () => {
  const row = (await mocks.db.userRank.findMany())[0];
  mocks.db.userRank.findMany.mockResolvedValue([{ ...row, userId: 4 }]);
  expect((await preview(req())).status).toBe(200);
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  mocks.db.userRank.findMany.mockResolvedValue([{ ...row, currentRank: null }]);
  expect((await (await preview(req())).json()).data.totalUsers).toBe(0);
});
test('audit failure fails closed and postcommit listener failures retain success', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.apiAuditLog.create.mockRejectedValueOnce(new Error('Audit failure'));
  expect((await apply(req())).status).toBe(500);
  expect(mocks.publish).not.toHaveBeenCalled();
  mocks.publish.mockImplementation(() => { throw new Error('Private listener'); });
  expect((await apply(req())).status).toBe(200);
  log.mockRestore();
});
test.each([['P2025', 404], ['P2002', 409], ['P2003', 409], ['P2034', 409]])('maps%s errors', async (code, status) => {
  mocks.db.$transaction.mockRejectedValue({ code });
  expect((await apply(req())).status).toBe(status);
});

 test('unknown database error codes remain internal failures rather than conflicts', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.$transaction.mockRejectedValue({ code: 'P1001' });
  try { expect((await apply(req())).status).toBe(500); } finally { log.mockRestore(); }
});

test('recalculation keeps current rank when no threshold is met and tolerates missing display usernames', async () => {
  const state = (await mocks.db.userRank.findMany())[0];
  mocks.db.userRank.findMany.mockResolvedValue([{ ...state, user: { id: 5, username: null } }]);
  mocks.db.rank.findMany.mockResolvedValue([{ ...low, attendanceRequiredSinceLastRank: 100 }, { ...high, attendanceRequiredSinceLastRank: 200 }]);
  const body = await (await preview(req({ strategy: 'recalculate' }))).json();
  expect(body.data.changes).toEqual([expect.objectContaining({ username: 'Unknown', currentRankName: low.name, newRankName: low.name, changeType: 'unchanged' })]);
  mocks.db.rank.findMany.mockResolvedValue([{ ...low, attendanceRequiredSinceLastRank: null }, high]);
  expect((await preview(req({ strategy: 'recalculate' }))).status).toBe(200);
});

test('partial mappings leave omitted ranks unchanged and allow explicit demotions', async () => {
  const state = (await mocks.db.userRank.findMany())[0];
  const untouched = await (await preview(req({ strategy: 'map', rankMappings: [{ oldRankId: 11, newRankId: 10 }] }))).json();
  expect(untouched.data.unchanged).toBe(1);
  mocks.db.userRank.findMany.mockResolvedValue([{ ...state, currentRankId: high.id, currentRank: high }]);
  const demotion = await (await preview(req({ strategy: 'map', rankMappings: [{ oldRankId: 11, newRankId: 10 }] }))).json();
  expect(demotion.data.demoted).toBe(1);
  expect(demotion.data.changes[0].newRankName).toBe(low.name);
});
