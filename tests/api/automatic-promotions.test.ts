import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), eligibility: vi.fn(), publish: vi.fn(), db: { user: model(), botToken: model(), userPermission: model(), promotionProposal: model(), userRank: model(), rankHistory: model(), authAccount: model(), botEvent: model(), message: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/rank-eligibility', () => ({ checkRankupEligibility: mocks.eligibility }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvent: mocks.publish }));
vi.mock('@/lib/realtime/promotion-events', () => ({ publishPromotionEvent: mocks.publish }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
import { GET, POST } from '@/app/api/ranks/promotions/automatic/route';
const req = (method = 'POST', body: unknown = {}, token = false, query = '') => new Request(`http://localhost/api/ranks/promotions/automatic${query}`, { method, headers: token ? { authorization: 'Bearer bot' } : {}, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 2 }] });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.userRank.findMany.mockResolvedValue([{ userId: 5 }]);
  mocks.db.rankHistory.findMany.mockResolvedValue([]);
  mocks.eligibility.mockResolvedValue({ eligible: true, reason: 'eligible_auto', currentRank: { id: 10, name: 'Before' }, nextRank: { id: 11, name: 'After', autoRankupEnabled: true }, attendance: { currentAttendance: 8, delta: 3 }, proposalId: null });
  mocks.db.userRank.findUniqueOrThrow.mockResolvedValue({ currentRankId: 10, attendanceSinceLastRank: 5, lastRankedUpAt: null });
  mocks.db.userRank.update.mockImplementation(async ({ data }) => data);
  mocks.db.rankHistory.create.mockResolvedValue({ id: 20 });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
test.each([['GET', GET], ['POST', POST]] as const)('%s shares user/bot auth and denies missing or revoked credentials and rights', async (method, route) => {
  expect((await route(req(method))).status).toBe(200);
  expect((await route(req(method, {}, true))).status).toBe(200);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await route(req(method, {}, true))).status).toBe(401);
  mocks.session.mockResolvedValue(null);
  expect((await route(req(method))).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await route(req(method))).status).toBe(403);
});
test('POST promotes each target atomically and returns only aggregate results', async () => {
  const response = await POST(req());
  expect(await response.json()).toEqual({ data: { promotedCount: 1, errorsCount: 0, ineligibleCount: 0 }, meta: {} });
  expect(mocks.db.userRank.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ user: expect.any(Object) }) }));
  expect(mocks.eligibility).toHaveBeenCalledWith(5, mocks.db);
  expect(mocks.db.userRank.update).toHaveBeenCalledWith({ where: { userId: 5 }, data: { currentRankId: 11, attendanceSinceLastRank: 8, lastRankedUpAt: expect.any(Date) } });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_rank.promoted', targetUserIds: [5] }) });
  expect(mocks.db.botEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ payload: expect.objectContaining({ source: 'automatic' }) }) });
});
test('POST skips newly forbidden manual and retired lanes, counts attendance-short automatic lanes', async () => {
  mocks.db.userRank.findMany.mockResolvedValue([{ userId: 5 }, { userId: 6 }, { userId: 7 }, { userId: 8 }]);
  mocks.db.userPermission.findMany.mockResolvedValueOnce([{ permission: { key: 'rank:manage_promotions' }, value: 2 }]);
  mocks.eligibility.mockResolvedValueOnce({ eligible: true, reason: 'eligible_manual' }).mockResolvedValueOnce({ eligible: false, reason: 'ineligible_retired' }).mockResolvedValueOnce({ eligible: false, reason: 'ineligible_attendance', nextRank: { autoRankupEnabled: true } });
  expect((await (await POST(req())).json()).data).toEqual({ promotedCount: 0, errorsCount: 0, ineligibleCount: 1 });
  expect(mocks.db.userRank.update).not.toHaveBeenCalled();
});
test('POST closes pending proposal and audits both mutations', async () => {
  mocks.eligibility.mockResolvedValue({ ...(await mocks.eligibility()), proposalId: 7 });
  mocks.db.promotionProposal.findUnique.mockResolvedValue({ id: 7, currentRankId: 10 });
  expect((await (await POST(req())).json()).data.promotedCount).toBe(1);
  expect(mocks.db.promotionProposal.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { status: 'approved', attendanceTotalAtProposal: 8, attendanceDeltaSinceLastRank: 3 } });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledTimes(2);
});
test('POST reports per-target rollback failures without leaking personal error strings', async () => {
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Private audit failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await POST(req());
  expect(await response.json()).toEqual({ data: { promotedCount: 0, errorsCount: 1, ineligibleCount: 0 }, meta: {} });
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain('Private audit failure');
  log.mockRestore();
});
test('POST retains success when postcommit events fail', async () => {
  mocks.publish.mockImplementation(() => { throw new Error('Listener failed'); });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await (await POST(req())).json()).data.promotedCount).toBe(1);
  log.mockRestore();
});
test('POST rejects nonempty body JSON and all query arguments', async () => {
  for (const body of [null, [], { userId: 5 }]) expect((await POST(req('POST', body))).status).toBe(422);
  expect((await POST(req('POST', {}, false, '?days=7'))).status).toBe(400);
  expect((await POST(new Request('http://localhost/api', { method: 'POST', body: '{' }))).status).toBe(400);
});
test('GET projects minimal UTC history with real lookahead and audits only returned other users', async () => {
  const row = (id: number, userId: number) => ({ id, userId, previousRankName: 'Before', newRankName: 'After', triggeredBy: 'auto', outcome: 'approved', createdAt: new Date('2026-09-18T01:00:00Z'), user: { id: userId, username: `User ${userId}`, accounts: [{ providerUserId: '123456789012345678' }] } });
  mocks.db.rankHistory.findMany.mockResolvedValue([row(8, 4), row(7, 5), row(6, 6)]);
  const response = await GET(req('GET', {}, false, '?limit=2&cursor=9&days=30'));
  const body = await response.json();
  expect(body.meta).toEqual({ limit: 2, nextCursor: '7' });
  expect(body.data[0]).toEqual({ id: 8, userId: 4, previousRankName: 'Before', newRankName: 'After', triggeredBy: 'auto', outcome: 'approved', createdAt: '2026-09-18T01:00:00.000Z', user: { id: 4, username: 'User 4', discordId: '123456789012345678' } });
  expect(mocks.db.rankHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3, orderBy: { id: 'desc' }, where: expect.objectContaining({ id: { lt: 9 }, user: expect.any(Object) }) }));
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetUserIds: [5], action: 'user_data.read', resource: 'rank_history' }) });
  mocks.db.rankHistory.findMany.mockResolvedValue([row(8, 4)]);
  mocks.db.apiAuditLog.create.mockClear();
  expect((await (await GET(req('GET'))).json()).meta.nextCursor).toBeNull();
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
});
test('GET audit storage failure withholds returned history', async () => {
  mocks.db.rankHistory.findMany.mockResolvedValue([{ id: 7, userId: 5, createdAt: new Date(), user: { id: 5, username: 'Private name', accounts: [] } }]);
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const response = await GET(req('GET'));
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('Private name');
  log.mockRestore();
});
test.each(['?days=0', '?days=3651', '?days=bad', '?days=2&days=3', '?page=1', '?cursor=2147483648', '?limit=0'])('GET rejects invalid query%s', async query => expect((await GET(req('GET', {}, false, query))).status).toBe(400));
