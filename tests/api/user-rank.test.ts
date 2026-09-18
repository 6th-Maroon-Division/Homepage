import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() });
  return { session: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), userRank: model(), rankHistory: model(), attendance: model(), legacyAttendanceData: model(), legacyUserData: model(), apiAuditLog: model() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET as rank } from '@/app/api/users/[id]/rank/route';
import { GET as history } from '@/app/api/users/[id]/rank-history/route';
import { rankHistorySelect } from '@/lib/api/user-rank';
const ctx = (id = '4') => ({ params: Promise.resolve({ id }) });
const req = (query = '', bot = false) => new Request(`http://localhost/api/users/4/rank${query}`, { headers: bot ? { authorization: 'Bearer bot' } : {} });
const row = { id: 8, previousRankName: null, newRankName: 'Private', attendanceTotalAtChange: 10, attendanceDeltaSinceLastRank: 3, triggeredBy: 'manual', outcome: 'declined', declineReason: 'private reason', createdAt: new Date('2026-09-17T00:00:00Z') };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.userRank.findUnique.mockResolvedValue({ currentRank: { id: 2, name: 'Private' }, retired: false, interviewDone: true, attendanceSinceLastRank: 3, lastRankedUpAt: new Date('2026-09-17T00:00:00Z') });
  mocks.db.attendance.count.mockResolvedValue(4);
  mocks.db.legacyAttendanceData.count.mockResolvedValue(1);
  mocks.db.legacyUserData.findMany.mockResolvedValue([{ oldData: 7 }]);
  mocks.db.rankHistory.findMany.mockResolvedValue([row]);
});
describe('user rank authentication and hierarchy', () => {
  it.each([rank, history])('requires validated credentials and supports user/bot', async handler => {
    expect((await handler(req(), ctx())).status).toBe(200);
    expect((await handler(req('', true), ctx())).status).toBe(200);
    mocks.session.mockResolvedValue(null);
    expect((await handler(req(), ctx())).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await handler(req('', true), ctx())).status).toBe(401);
    expect((await handler(new Request('http://localhost/api', { headers: { authorization: 'Basic xyz' } }), ctx())).status).toBe(401);
  });
  it.each([rank, history])('supports me only for sessions and rejects invalid ids', async handler => {
    expect((await handler(req(), ctx('me'))).status).toBe(200);
    expect((await handler(req('', true), ctx('me'))).status).toBe(400);
    for (const id of ['bad', '0', '2147483648']) expect((await handler(req(), ctx(id))).status).toBe(400);
  });
  it.each([rank, history])('enforces higher live user:manage hierarchy for other users', async handler => {
    expect((await handler(req(), ctx('5'))).status).toBe(403);
    mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'user:manage' }, value: 2 }] });
    mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:manage' }, value: 1 }]);
    expect((await handler(req(), ctx('5'))).status).toBe(200);
    mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:manage' }, value: 2 }]);
    expect((await handler(req(), ctx('5'))).status).toBe(403);
    mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'system:super_admin' }, value: 1 }]);
    expect((await handler(req(), ctx('5'))).status).toBe(403);
    expect((await handler(req('', true), ctx('5'))).status).toBe(200);
  });
  it.each([rank, history])('returns 404 for a missing authorized target', async handler => {
    mocks.db.user.findUnique.mockResolvedValueOnce({ id: 4, userPermissions: [] }).mockResolvedValueOnce(null);
    expect((await handler(req(), ctx())).status).toBe(404);
  });
});
describe('rank summary and history contracts', () => {
  it('preserves attendance arithmetic across current and legacy data', async () => {
    expect(await (await rank(req(), ctx())).json()).toEqual({ data: { userId: 4, currentRank: { id: 2, name: 'Private' }, retired: false, interviewDone: true, attendanceSinceLastRank: 3, attendanceTotal: 12, attendanceDelta: 9, lastRankedUpAt: '2026-09-17T00:00:00.000Z' }, meta: {} });
    expect(mocks.db.attendance.count).toHaveBeenCalledWith({ where: { userId: 4, orbat: { isMainOp: true }, status: { in: ['present', 'late', 'gone_early', 'partial'] } } });
    expect(mocks.db.legacyAttendanceData.count).toHaveBeenCalledWith({ where: { mappedUserId: 4, legacyStatus: { in: ['P'] } } });
    expect(mocks.db.legacyUserData.findMany).toHaveBeenCalledWith({ where: { mappedUserId: 4, isApplied: true, oldData: { gt: 0 } }, select: { oldData: true } });
  });
  it('supports zero baseline and nullable current rank, preserving missing rank404', async () => {
    mocks.db.userRank.findUnique.mockResolvedValue({ currentRank: null, retired: true, interviewDone: false, attendanceSinceLastRank: 0, lastRankedUpAt: new Date('2026-09-17T00:00:00Z') });
    expect((await (await rank(req(), ctx())).json()).data).toMatchObject({ currentRank: null, attendanceDelta: 12 });
    mocks.db.userRank.findUnique.mockResolvedValue(null);
    expect((await rank(req(), ctx())).status).toBe(404);
    mocks.db.rankHistory.findMany.mockResolvedValue([]);
    expect(await (await history(req(), ctx())).json()).toEqual({ data: [], meta: { limit: 50, nextCursor: null } });
  });
  it.each(['?page=1', '?page=', '?limit=0', '?cursor=invalid', '?cursor=2147483648'])('rejects legacy/invalid pagination %s', async query => expect((await history(req(query), ctx())).status).toBe(400));
  it('paginates history descending with safe selected fields and actual lookahead', async () => {
    mocks.db.rankHistory.findMany.mockResolvedValue([row, { ...row, id: 7 }]);
    expect(await (await history(req('?limit=1&cursor=9'), ctx())).json()).toMatchObject({ data: [{ id: 8, createdAt: '2026-09-17T00:00:00.000Z' }], meta: { limit: 1, nextCursor: '8' } });
    expect(mocks.db.rankHistory.findMany).toHaveBeenCalledWith({ where: { userId: 4, id: { lt: 9 } }, orderBy: { id: 'desc' }, take: 2, select: rankHistorySelect });
    expect(Object.keys(rankHistorySelect).sort()).toEqual(['id', 'previousRankName', 'newRankName', 'attendanceTotalAtChange', 'attendanceDeltaSinceLastRank', 'triggeredBy', 'outcome', 'declineReason', 'createdAt'].sort());
    mocks.db.rankHistory.findMany.mockResolvedValue([row]);
    expect((await (await history(req('?limit=1'), ctx())).json()).meta.nextCursor).toBeNull();
  });
});
describe('personal rank read auditing', () => {
  it.each([rank, history])('does not audit self reads', async handler => {
    await handler(req(), ctx('me'));
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it.each([[rank, 'user_rank'], [history, 'rank_history']] as const)('audits authorized other-user reads without personal snapshots', async (handler, resource) => {
    mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'user:manage' }, value: 2 }] });
    const response = await handler(req(), ctx('5'));
    expect(response.status).toBe(200);
    const audit = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
    expect(audit).toMatchObject({ actorUserId: 4, action: 'user_data.read', resource, resourceId: '5', targetUserIds: [5], correlationId: response.headers.get('X-Request-Id') });
    expect(audit).not.toHaveProperty('before');
    expect(audit).not.toHaveProperty('after');
    expect(JSON.stringify(audit)).not.toContain('private reason');
  });
  it('audits empty targeted bot history reads', async () => {
    mocks.db.rankHistory.findMany.mockResolvedValue([]);
    expect((await history(req('', true), ctx('5'))).status).toBe(200);
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorType: 'bot', actorTokenId: 9, resource: 'rank_history', targetUserIds: [5] }) });
  });
  it.each([rank, history])('fails closed with no private response when audit fails', async handler => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    const response = await handler(req('', true), ctx());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).not.toHaveProperty('data');
    expect(JSON.stringify(body)).not.toContain('private reason');
    spy.mockRestore();
  });
});
