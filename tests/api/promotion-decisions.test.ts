import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), count: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), promotionProposal: model(), userRank: model(), rank: model(), rankHistory: model(), botEvent: model(), apiAuditLog: model(), message: model(), authAccount: model(), attendance: model(), legacyAttendanceData: model(), legacyUserData: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvent: mocks.publish }));
vi.mock('@/lib/realtime/promotion-events', () => ({ publishPromotionEvent: mocks.publish }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
import { POST as approve } from '@/app/api/ranks/promotions/[id]/approve/route';
import { POST as decline } from '@/app/api/ranks/promotions/[id]/decline/route';
const req = (body: unknown = {}, token = false, query = '') => new Request(`http://localhost/api/ranks/promotions/7/approve${query}`, { method: 'POST', headers: token ? { authorization: 'Bearer bot' } : {}, body: JSON.stringify(body) });
const ctx = (id = '7') => ({ params: Promise.resolve({ id }) });
const routes = [['approve', approve], ['decline', decline]] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 2 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.promotionProposal.findUnique.mockResolvedValue({ id: 7, userId: 5, status: 'pending', currentRankId: 10, nextRankId: 11 });
  mocks.db.promotionProposal.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.userRank.findUnique.mockResolvedValue({ userId: 5, currentRankId: 10, attendanceSinceLastRank: 2, lastRankedUpAt: null });
  mocks.db.userRank.update.mockImplementation(async ({ data }) => ({ currentRankId: 10, lastRankedUpAt: null, ...data }));
  mocks.db.rank.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, name: `Rank ${where.id}` }));
  mocks.db.rankHistory.create.mockResolvedValue({ id: 22 });
  mocks.db.attendance.count.mockResolvedValue(3);
  mocks.db.legacyAttendanceData.count.mockResolvedValue(2);
  mocks.db.legacyUserData.findMany.mockResolvedValue([{ oldData: 4 }]);
  mocks.db.authAccount.findFirst.mockResolvedValue({ providerUserId: '123456789012345678' });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
test.each(routes)('%s requires valid live principal and global permission', async (_name, route) => {
  expect((await route(req(), ctx())).status).toBe(200);
  expect((await route(req({}, true), ctx())).status).toBe(200);
  mocks.session.mockResolvedValue(null);
  expect((await route(req(), ctx())).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await route(req({}, true), ctx())).status).toBe(401);
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await route(req(), ctx())).status).toBe(403);
});
test.each(routes)('%s enforces target hierarchy before writes', async (_name, route) => {
  mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'rank:manage_promotions' }, value: 2 }]);
  expect((await route(req(), ctx())).status).toBe(403);
  expect(mocks.db.promotionProposal.updateMany).not.toHaveBeenCalled();
  mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'rank:manage_promotions' }, value: 1 }]);
  expect((await route(req(), ctx())).status).toBe(200);
});
test.each(routes)('%s validates path query and JSON', async (_name, route) => {
  for (const id of ['0', 'bad', '2147483648']) expect((await route(req(), ctx(id))).status).toBe(400);
  expect((await route(req({}, false, '?other=1'), ctx())).status).toBe(400);
  expect((await route(new Request('http://localhost/api', { method: 'POST', body: '{' }), ctx())).status).toBe(400);
  for (const body of [null, [], 'invalid', { other: true }]) expect((await route(req(body), ctx())).status).toBe(422);
});
test('approval is strict empty object and decline accepts trimmed nullable reason only', async () => {
  expect((await approve(req({ declineReason: 'No' }), ctx())).status).toBe(422);
  expect((await decline(req({ declineReason: 123 }), ctx())).status).toBe(422);
  expect((await decline(req({ declineReason: '  Explanation  ' }), ctx())).status).toBe(200);
  expect(mocks.db.rankHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ declineReason: 'Explanation' }) });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ after: expect.objectContaining({ declineReason: '[REDACTED]' }) }) });
  expect((await decline(req({ declineReason: null }), ctx())).status).toBe(200);
  expect((await decline(req({ declineReason: ' ' }), ctx())).status).toBe(200);
});
test.each(routes)('%s handles missing proposal rank state and rank references before mutation', async (_name, route) => {
  const proposal = await mocks.db.promotionProposal.findUnique();
  mocks.db.promotionProposal.findUnique.mockResolvedValue(null);
  expect((await route(req(), ctx())).status).toBe(404);
  mocks.db.promotionProposal.findUnique.mockResolvedValue(proposal);
  mocks.db.userRank.findUnique.mockResolvedValueOnce(null);
  expect((await route(req(), ctx())).status).toBe(404);
  mocks.db.rank.findUnique.mockResolvedValueOnce(null);
  expect((await route(req(), ctx())).status).toBe(404);
  expect(mocks.db.promotionProposal.updateMany).not.toHaveBeenCalled();
});
test.each(routes)('%s rejects handled stale and concurrently claimed proposals', async (_name, route) => {
  mocks.db.promotionProposal.findUnique.mockResolvedValueOnce({ id: 7, userId: 5, status: 'approved' });
  expect((await route(req(), ctx())).status).toBe(409);
  mocks.db.userRank.findUnique.mockResolvedValueOnce({ currentRankId: 12 });
  expect((await route(req(), ctx())).status).toBe(409);
  mocks.db.promotionProposal.updateMany.mockResolvedValue({ count: 0 });
  expect((await route(req(), ctx())).status).toBe(409);
  expect(mocks.db.userRank.update).not.toHaveBeenCalled();
});
test('approval recomputes modern and legacy attendance baseline and emits atomic audit outbox and message', async () => {
  const response = await approve(req({}, true), ctx());
  expect(await response.json()).toEqual({ data: null, meta: {} });
  expect(mocks.db.userRank.update).toHaveBeenCalledWith({ where: { userId: 5 }, data: { currentRankId: 11, attendanceSinceLastRank: 9, lastRankedUpAt: expect.any(Date) } });
  expect(mocks.db.rankHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ outcome: 'approved', triggeredBy: 'bot', triggeredByUserId: null, attendanceTotalAtChange: 9, attendanceDeltaSinceLastRank: 7 }) });
  expect(mocks.db.botEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'user.rank_changed', aggregateId: '22', payload: expect.objectContaining({ source: 'manual_approval', oldRankId: 10, newRankId: 11 }) }) });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'promotion_proposal.approved', actorTokenId: 9, targetUserIds: [5] }) });
  expect(mocks.db.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ createdById: null, recipients: { create: expect.objectContaining({ userId: 5 }) } }) });
  expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
});
test('decline resets attendance only preserves rank date and does not create a rank changed outbox', async () => {
  expect((await decline(req(), ctx())).status).toBe(200);
  expect(mocks.db.userRank.update).toHaveBeenCalledWith({ where: { userId: 5 }, data: { attendanceSinceLastRank: 9 } });
  expect(mocks.db.botEvent.create).not.toHaveBeenCalled();
  expect(mocks.db.rankHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ outcome: 'declined', triggeredBy: 'admin_manual', triggeredByUserId: 4 }) });
});
test.each(routes)('%s fails closed and suppresses events on persistence failure', async (_name, route) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Private persistence failure'));
  expect((await route(req(), ctx())).status).toBe(500);
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain('Private persistence failure');
  log.mockRestore();
});
test('postcommit notification failure preserves successful mutation', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.publish.mockImplementation(() => { throw new Error('Listener failed'); });
  expect((await approve(req(), ctx())).status).toBe(200);
  expect(mocks.publish).toHaveBeenCalledTimes(3);
  log.mockRestore();
});
test.each([['P2025', 404], ['P2002', 409], ['P2003', 409], ['P2034', 409]])('maps %s transaction failures', async (code, status) => {
  mocks.db.$transaction.mockRejectedValue({ code });
  expect((await approve(req(), ctx())).status).toBe(status);
});

 test('unknown database error codes remain internal failures rather than conflicts', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.$transaction.mockRejectedValue({ code: 'P1001' });
  try { expect((await approve(req(), ctx())).status).toBe(500); } finally { log.mockRestore(); }
});

test('approval for an unlinked user emits an outbox entry without a provider identifier', async () => {
  mocks.db.authAccount.findFirst.mockResolvedValue(null);
  expect((await approve(req(), ctx())).status).toBe(200);
  expect(mocks.db.botEvent.create.mock.lastCall![0].data.payload.discordUserId).toBeNull();
});
