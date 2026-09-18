import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), eligibility: vi.fn(), publish: vi.fn(), db: { user: model(), botToken: model(), userPermission: model(), promotionProposal: model(), userRank: model(), rankHistory: model(), authAccount: model(), botEvent: model(), message: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/rank-eligibility', () => ({ checkRankupEligibility: mocks.eligibility }));
vi.mock('@/lib/realtime/inbox-events', () => ({ publishInboxEvents: mocks.publish }));
vi.mock('@/lib/realtime/promotion-events', () => ({ publishPromotionEvent: mocks.publish }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
import { POST } from '@/app/api/ranks/promotions/propose/route';
const req = (body: unknown = { userId: 5 }, token = false, query = '') => new Request(`http://localhost/api/ranks/promotions/propose${query}`, { method: 'POST', headers: token ? { authorization: 'Bearer bot' } : {}, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ id: 5, userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 2 }] });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.eligibility.mockResolvedValue({ eligible: true, reason: 'eligible_manual', currentRank: { id: 10, name: 'Before' }, nextRank: { id: 11, name: 'After' }, attendance: { currentAttendance: 8, delta: 3 }, proposalId: null });
  mocks.db.promotionProposal.create.mockImplementation(async ({ data }) => ({ id: 7, createdAt: new Date('2026-01-01T00:00:00Z'), ...data }));
  mocks.db.userRank.findUniqueOrThrow.mockResolvedValue({ currentRankId: 10, attendanceSinceLastRank: 5, lastRankedUpAt: new Date(0) });
  mocks.db.userRank.update.mockImplementation(async ({ data }) => data);
  mocks.db.rankHistory.create.mockResolvedValue({ id: 20 });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
test('manual proposals return minimal canonical DTO and audit UTC metadata', async () => {
  const response = await POST(req());
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ data: { userId: 5, outcome: 'proposed', proposalId: 7, rankId: 11 }, meta: {} });
  expect(mocks.eligibility).toHaveBeenCalledWith(5, mocks.db);
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'promotion_proposal.created', targetUserIds: [5], after: expect.objectContaining({ createdAt: '2026-01-01T00:00:00.000Z' }) }) });
  expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
});
test('valid bot accepted invalid bearer denied with no fallback and session requires live permission', async () => {
  expect((await POST(req({ userId: 5 }, true))).status).toBe(201);
  mocks.db.botToken.findFirst.mockResolvedValue(null);
  expect((await POST(req({ userId: 5 }, true))).status).toBe(401);
  mocks.session.mockResolvedValue(null);
  expect((await POST(req())).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await POST(req())).status).toBe(403);
});
test('target hierarchy missing users and ineligibility prevent mutations', async () => {
  mocks.db.userPermission.findMany.mockResolvedValueOnce([{ permission: { key: 'rank:manage_promotions' }, value: 2 }]);
  expect((await POST(req())).status).toBe(403);
  mocks.db.user.findUnique.mockResolvedValueOnce({ userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 2 }] }).mockResolvedValueOnce(null);
  expect((await POST(req())).status).toBe(404);
  mocks.eligibility.mockResolvedValue({ eligible: false, reason: 'ineligible_training' });
  const response = await POST(req());
  expect(response.status).toBe(409);
  expect((await response.json()).error.details).toEqual({ reason: 'ineligible_training' });
  expect(mocks.db.promotionProposal.create).not.toHaveBeenCalled();
});
test.each([null, [], {}, { userId: '5' }, { userId: 0 }, { userId: 2147483648 }, { userId: 5, actorId: 4 }])('strict payload rejects %j', async body => expect((await POST(req(body))).status).toBe(422));
test('invalid JSON or query rejects400', async () => {
  expect((await POST(new Request('http://localhost/api', { method: 'POST', body: '{' }))).status).toBe(400);
  expect((await POST(req({ userId: 5 }, false, '?userId=5'))).status).toBe(400);
});
test('existing pending proposal is read-only and audits only another user', async () => {
  mocks.eligibility.mockResolvedValue({ ...(await mocks.eligibility()), proposalId: 7 });
  mocks.db.promotionProposal.findUnique.mockResolvedValue({ id: 7, currentRankId: 10 });
  expect((await (await POST(req())).json()).data.outcome).toBe('already_pending');
  expect(mocks.db.promotionProposal.create).not.toHaveBeenCalled();
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_data.read', targetUserIds: [5] }) });
  mocks.db.apiAuditLog.create.mockClear();
  expect((await POST(req({ userId: 4 }))).status).toBe(200);
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  mocks.db.promotionProposal.findUnique.mockResolvedValue({ id: 7, currentRankId: 12 });
  expect((await POST(req())).status).toBe(409);
});
test('auto promotion closes existing pending proposal with atomic outbox message and both audits', async () => {
  mocks.eligibility.mockResolvedValue({ ...(await mocks.eligibility()), reason: 'eligible_auto', proposalId: 7 });
  mocks.db.promotionProposal.findUnique.mockResolvedValue({ id: 7, currentRankId: 10 });
  const response = await POST(req({ userId: 5 }, true));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ userId: 5, outcome: 'promoted', proposalId: 7, rankId: 11 });
  expect(mocks.db.promotionProposal.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { status: 'approved', attendanceTotalAtProposal: 8, attendanceDeltaSinceLastRank: 3 } });
  expect(mocks.db.userRank.update).toHaveBeenCalledWith({ where: { userId: 5 }, data: { currentRankId: 11, attendanceSinceLastRank: 8, lastRankedUpAt: expect.any(Date) } });
  expect(mocks.db.rankHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ triggeredBy: 'auto', triggeredByUserId: null }) });
  expect(mocks.db.botEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ payload: expect.objectContaining({ source: 'automatic' }) }) });
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalledTimes(2);
  expect(mocks.db.message.create).toHaveBeenCalled();
});
test('superadmin proposal inbox notifications and listener failures cannot change committed success', async () => {
  mocks.db.userPermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ userId: 99 }, { userId: 99 }]);
  mocks.publish.mockImplementation(() => { throw new Error('Private listener failure'); });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect((await POST(req())).status).toBe(201);
  expect(mocks.db.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ recipients: { create: [{ userId: 99, audienceType: 'admin', channel: 'web', isRead: false }] } }) });
  expect(JSON.stringify(log.mock.calls)).not.toContain('Private listener failure');
  log.mockRestore();
});
test('audit failure returns500 and no notification', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Unavailable'));
  expect((await POST(req())).status).toBe(500);
  expect(mocks.publish).not.toHaveBeenCalled();
  log.mockRestore();
});
test.each([['P2025', 404], ['P2002', 409], ['P2003', 409], ['P2034', 409]])('maps%s transaction failures', async (code, status) => {
  mocks.db.$transaction.mockRejectedValue({ code });
  expect((await POST(req())).status).toBe(status);
});

 test('unknown database error codes remain internal failures rather than conflicts', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.db.$transaction.mockRejectedValue({ code: 'P1001' });
  try { expect((await POST(req())).status).toBe(500); } finally { log.mockRestore(); }
});

test('ineligible users checking themselves produce no other-user read audit', async () => {
  mocks.eligibility.mockResolvedValue({ eligible: false, reason: 'ineligible_interview' });
  expect((await POST(req({ userId: 4 }))).status).toBe(409);
  expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
});

test('automatic promotion without an existing proposal updates rank without fabricating a proposal event', async () => {
  const eligible = await mocks.eligibility();
  mocks.eligibility.mockResolvedValue({ ...eligible, reason: 'eligible_auto', proposalId: null });
  const response = await POST(req());
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ outcome: 'promoted', proposalId: null });
  expect(mocks.db.promotionProposal.update).not.toHaveBeenCalled();
  expect(mocks.db.apiAuditLog.create.mock.calls.some(([arg]) => arg.data.action === 'promotion_proposal.approved')).toBe(false);
});
