import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), rank: model(), userRank: model(), rankHistory: model(), attendance: model(), legacyAttendanceData: model(), legacyUserData: model(), authAccount: model(), botEvent: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
import { PATCH } from '@/app/api/users/[id]/rank/route';
import { parseUserRankMutation } from '@/lib/api/user-rank-mutations';
const ctx = (id = '5') => ({ params: Promise.resolve({ id }) });
const req = (body: unknown = { rankId: 3 }, bot = false) => new Request('http://localhost/api/users/5/rank', { method: 'PATCH', headers: bot ? { authorization: 'Bearer bot' } : {}, body: JSON.stringify(body) });
const previous = { currentRankId: 2, currentRank: { id: 2, name: 'Private', orderIndex: 1 }, attendanceSinceLastRank: 3, lastRankedUpAt: new Date('2026-09-17T00:00:00Z'), retired: true, interviewDone: true };
const next = { id: 3, name: 'Corporal', orderIndex: 2 };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ id: 5, userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 2 }] });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.rank.findUnique.mockResolvedValue(next);
  mocks.db.userRank.findUnique.mockResolvedValue(previous);
  mocks.db.userRank.upsert.mockImplementation(async ({ update }) => ({ ...previous, ...update, currentRank: { ...next, id: update.currentRankId } }));
  mocks.db.rankHistory.create.mockResolvedValue({ id: 7 });
  mocks.db.attendance.count.mockResolvedValue(4);
  mocks.db.legacyAttendanceData.count.mockResolvedValue(1);
  mocks.db.legacyUserData.findMany.mockResolvedValue([{ oldData: 7 }]);
  mocks.db.authAccount.findFirst.mockResolvedValue({ providerUserId: '123456789012345678' });
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
describe('user rank write access', () => {
  it('requires global management permission even for self and supports me for authorized sessions', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await PATCH(req(), ctx('me'))).status).toBe(403);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 1 }] });
    expect((await PATCH(req(), ctx('me'))).status).toBe(200);
    expect(mocks.db.userPermission.findMany).not.toHaveBeenCalled();
  });
  it('uses management hierarchy independent of read user:manage', async () => {
    expect((await PATCH(req(), ctx())).status).toBe(200);
    mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'rank:manage_promotions' }, value: 2 }]);
    expect((await PATCH(req(), ctx())).status).toBe(403);
    expect((await PATCH(req({}, true), ctx('me'))).status).toBe(400);
    expect((await PATCH(req({ rankId: 3 }, true), ctx())).status).toBe(200);
  });
  it('rejects missing/revoked credentials without falling back', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await PATCH(req(), ctx())).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await PATCH(req({ rankId: 3 }, true), ctx())).status).toBe(401);
  });
});
describe('strict rank write contracts', () => {
  it.each([null, [], {}, { rankId: '3' }, { rankId: 0 }, { rankId: 2147483648 }, { rankId: 3, action: 'demote' }, { rankId: 3, reason: 123 }])('rejects invalid payload %j', async body => expect((await PATCH(req(body), ctx())).status).toBe(422));
  it('normalizes optional reasons', () => {
    expect(parseUserRankMutation({ rankId: 3, reason: ' why ' })).toEqual({ data: { rankId: 3, reason: 'why' } });
    expect(parseUserRankMutation({ rankId: 3, reason: ' ' })).toEqual({ data: { rankId: 3, reason: null } });
    expect(parseUserRankMutation({ rankId: 3, reason: null })).toEqual({ data: { rankId: 3, reason: null } });
  });
  it('rejects malformed JSON and invalid target IDs', async () => {
    expect((await PATCH(new Request('http://localhost/api', { method: 'PATCH', body: '{' }), ctx())).status).toBe(400);
    for (const id of ['bad', '0', '2147483648']) expect((await PATCH(req(), ctx(id))).status).toBe(400);
  });
  it('returns missing target/rank404 before mutation', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce({ userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 2 }] }).mockResolvedValueOnce(null);
    expect((await PATCH(req(), ctx())).status).toBe(404);
    mocks.db.rank.findUnique.mockResolvedValue(null);
    expect((await PATCH(req(), ctx())).status).toBe(404);
    expect(mocks.db.userRank.upsert).not.toHaveBeenCalled();
  });
});
describe('transactional assignment and demotion', () => {
  it('returns updated summary while preserving flags and resetting baseline', async () => {
    const response = await PATCH(req(), ctx());
    expect(await response.json()).toMatchObject({ data: { userId: 5, currentRank: { id: 3 }, retired: true, interviewDone: true, attendanceSinceLastRank: 12, attendanceTotal: 12, attendanceDelta: 0, lastRankedUpAt: expect.stringMatching(/Z$/) }, meta: {} });
    expect(mocks.db.userRank.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { currentRankId: 3, attendanceSinceLastRank: 12, lastRankedUpAt: expect.any(Date) } }));
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.db.rankHistory.create).toHaveBeenCalledWith({ data: expect.objectContaining({ triggeredBy: 'admin', triggeredByUserId: 4, previousRankName: 'Private', newRankName: 'Corporal', attendanceTotalAtChange: 12, attendanceDeltaSinceLastRank: 9, outcome: 'approved', note: null }) });
    expect(mocks.db.botEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'user.rank_changed', aggregate: 'rank', aggregateId: '7', payload: { rankHistoryId: 7, userId: 5, discordUserId: '123456789012345678', oldRankId: 2, newRankId: 3, changeType: 'assignment', source: 'direct_assignment' } }) });
    expect(mocks.publish).toHaveBeenCalledWith(5, { source: 'rank.assigned', rankId: 3 });
  });
  it('computes demotion from order and stores reason only in history', async () => {
    mocks.db.rank.findUnique.mockResolvedValue({ id: 3, name: 'Recruit', orderIndex: 0 });
    await PATCH(req({ rankId: 3, reason: ' private note ' }), ctx());
    expect(mocks.db.rankHistory.create.mock.lastCall![0].data.note).toBe('private note');
    expect(mocks.db.botEvent.create.mock.lastCall![0].data.payload.changeType).toBe('demotion');
    const audit = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
    expect(audit).toMatchObject({ action: 'user_rank.updated', targetUserIds: [5], after: { rankHistoryId: 7, changeType: 'demotion', reason: '[REDACTED]' } });
    expect(JSON.stringify(audit)).not.toContain('private note');
    expect(mocks.publish).toHaveBeenCalledWith(5, { source: 'rank.demoted', rankId: 3 });
  });
  it('records same-rank assignment and clamps negative history delta', async () => {
    mocks.db.rank.findUnique.mockResolvedValue(previous.currentRank);
    mocks.db.userRank.findUnique.mockResolvedValue({ ...previous, attendanceSinceLastRank: 20 });
    await PATCH(req({ rankId: 2 }), ctx());
    expect(mocks.db.rankHistory.create.mock.lastCall![0].data.attendanceDeltaSinceLastRank).toBe(0);
    expect(mocks.db.botEvent.create.mock.lastCall![0].data.payload.changeType).toBe('assignment');
  });
  it('creates first rank and attributes bot actor without a fabricated user identity', async () => {
    mocks.db.userRank.findUnique.mockResolvedValue(null);
    mocks.db.authAccount.findFirst.mockResolvedValue(null);
    expect((await PATCH(req({ rankId: 3 }, true), ctx())).status).toBe(200);
    expect(mocks.db.rankHistory.create.mock.lastCall![0].data).toMatchObject({ previousRankName: null, triggeredBy: 'bot', triggeredByUserId: null, attendanceDeltaSinceLastRank: 12 });
    expect(mocks.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ actorType: 'bot', actorTokenId: 9, before: { rankId: null, attendanceSinceLastRank: 0, lastRankedUpAt: null } });
    expect(mocks.db.botEvent.create.mock.lastCall![0].data.payload).toMatchObject({ oldRankId: null, discordUserId: null, changeType: 'assignment' });
  });
  it('uses transaction scoped permission and attendance clients', async () => {
    const permission = vi.fn().mockResolvedValue([]);
    const attendance = vi.fn().mockResolvedValue(20);
    mocks.db.$transaction.mockImplementation(async cb => cb({ ...mocks.db, userPermission: { findMany: permission }, attendance: { count: attendance } }));
    expect((await PATCH(req(), ctx())).status).toBe(200);
    expect(permission).toHaveBeenCalled(); expect(attendance).toHaveBeenCalled();
    expect(mocks.db.userPermission.findMany).not.toHaveBeenCalled();
    expect(mocks.db.attendance.count).not.toHaveBeenCalled();
  });
  it.each(['rankHistory', 'botEvent', 'apiAuditLog'] as const)('fails atomic operation and skips realtime publication if %s fails', async model => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db[model].create.mockRejectedValue(new Error('Storage unavailable'));
    expect((await PATCH(req(), ctx())).status).toBe(500);
    expect(mocks.publish).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it.each([['P2034', 409], ['P2002', 409], ['P2003', 409], ['P2025', 404]])('maps transaction error %s', async (code, status) => {
    mocks.db.$transaction.mockRejectedValue({ code });
    expect((await PATCH(req(), ctx())).status).toBe(status);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});

it('returns committed success if a post-commit realtime listener throws', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.publish.mockImplementation(() => { throw new Error('Sensitive listener details'); });
  const response = await PATCH(req(), ctx());
  expect(response.status).toBe(200);
  expect(mocks.db.userRank.upsert).toHaveBeenCalled();
  expect(mocks.db.rankHistory.create).toHaveBeenCalled();
  expect(mocks.db.botEvent.create).toHaveBeenCalled();
  expect(mocks.db.apiAuditLog.create).toHaveBeenCalled();
  expect(JSON.stringify(log.mock.calls)).not.toContain('Sensitive listener details');
  log.mockRestore();
});

import { PATCH as bulk } from '@/app/api/users/ranks/route';
import { parseBulkUserRankMutation } from '@/lib/api/user-rank-mutations';
describe('bulk rank mutation contracts', () => {
  it.each([null, [], {}, { updates: [] }, { updates: [null] }, { updates: [{ userId: '5', rankId: 3 }] }, { updates: [{ userId: 2147483648, rankId: 3 }] }, { updates: [{ userId: 5, rankId: '3' }] }, { updates: [{ userId: 5, rankId: 3 }, { userId: 5, rankId: 2 }] }, { updates: [{ userId: 5, rankId: 3, other: true }] }, { updates: [{ userId: 5, rankId: 3 }], other: true }])('rejects malformed batch %j', async body => expect((await bulk(req(body))).status).toBe(422));
  it('enforces max100 and normalizes per-user reasons through the singleton parser', () => {
    const updates = Array.from({ length: 101 }, (_, index) => ({ userId: index + 1, rankId: 3 }));
    expect(parseBulkUserRankMutation({ updates })).toHaveProperty('error');
    expect(parseBulkUserRankMutation({ updates: updates.slice(0, 100) })).toHaveProperty('data');
    expect(parseBulkUserRankMutation({ updates: [{ userId: 5, rankId: 3, reason: ' why ' }] })).toEqual({ data: [{ userId: 5, rankId: 3, reason: 'why' }] });
  });
  it('requires global rank management even self and validates bot credentials', async () => {
    const body = { updates: [{ userId: 4, rankId: 3 }] };
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await bulk(req(body))).status).toBe(403);
    expect((await bulk(req(body, true))).status).toBe(200);
    mocks.session.mockResolvedValue(null);
    expect((await bulk(req(body))).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await bulk(req(body, true))).status).toBe(401);
  });
  it('rejects malformed JSON', async () => expect((await bulk(new Request('http://localhost/api/users/ranks', { method: 'PATCH', body: '{' }))).status).toBe(400));
});
describe('bulk rank atomic preflight and effects', () => {
  const body = { updates: [{ userId: 5, rankId: 3 }, { userId: 6, rankId: 2, reason: 'Requested change' }] };
  it('preflights all hierarchy checks before writes', async () => {
    mocks.db.userPermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ permission: { key: 'rank:manage_promotions' }, value: 2 }]);
    expect((await bulk(req(body))).status).toBe(403);
    expect(mocks.db.userRank.upsert).not.toHaveBeenCalled();
    expect(mocks.db.rankHistory.create).not.toHaveBeenCalled();
    expect(mocks.db.botEvent.create).not.toHaveBeenCalled();
  });
  it('preflights all rank and user references before first mutation', async () => {
    mocks.db.rank.findUnique.mockResolvedValueOnce(next).mockResolvedValueOnce(null);
    expect((await bulk(req(body))).status).toBe(404);
    expect(mocks.db.userRank.upsert).not.toHaveBeenCalled();
    mocks.db.user.findUnique.mockResolvedValueOnce({ userPermissions: [{ permission: { key: 'rank:manage_promotions' }, value: 2 }] }).mockResolvedValueOnce({ id: 5 }).mockResolvedValueOnce(null);
    expect((await bulk(req(body))).status).toBe(404);
    expect(mocks.db.userRank.upsert).not.toHaveBeenCalled();
  });
  it('preserves input order, emits bulk sources, and records explicit reasons', async () => {
    mocks.db.rank.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, name: `Rank ${where.id}`, orderIndex: where.id === 2 ? 0 : 2 }));
    const response = await bulk(req(body));
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.map((row: { userId: number }) => row.userId)).toEqual([5, 6]);
    expect(data.map((row: { attendanceDelta: number }) => row.attendanceDelta)).toEqual([0, 0]);
    expect(mocks.db.rankHistory.create.mock.calls.map(([arg]) => arg.data.note)).toEqual([null, 'Requested change']);
    expect(mocks.db.botEvent.create.mock.calls.map(([arg]) => [arg.data.payload.source, arg.data.payload.changeType])).toEqual([['bulk_assignment', 'assignment'], ['bulk_assignment', 'demotion']]);
    expect(mocks.db.apiAuditLog.create.mock.calls.map(([arg]) => arg.data.targetUserIds)).toEqual([[5], [6]]);
    expect(mocks.publish.mock.calls).toEqual([[5, { source: 'rank.bulk-assigned', rankId: 3 }], [6, { source: 'rank.bulk-assigned', rankId: 2 }]]);
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });
  it('attributes every bot history/audit consistently', async () => {
    expect((await bulk(req(body, true))).status).toBe(200);
    for (const [arg] of mocks.db.rankHistory.create.mock.calls) expect(arg.data).toMatchObject({ triggeredBy: 'bot', triggeredByUserId: null });
    for (const [arg] of mocks.db.apiAuditLog.create.mock.calls) expect(arg.data).toMatchObject({ actorType: 'bot', actorTokenId: 9 });
  });
  it.each(['rankHistory', 'botEvent', 'apiAuditLog'] as const)('fails whole operation on later %s errors without publishing', async model => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db[model].create.mockResolvedValueOnce({ id: 7 }).mockRejectedValueOnce(new Error('Second write failure'));
    expect((await bulk(req(body))).status).toBe(500);
    expect(mocks.publish).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('continues postcommit notifications after one listener fails and returns committed success', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.publish.mockImplementationOnce(() => { throw new Error('Sensitive failure'); }).mockImplementation(() => {});
    expect((await bulk(req(body))).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledTimes(2);
    expect(mocks.publish.mock.calls[1][0]).toBe(6);
    expect(JSON.stringify(log.mock.calls)).not.toContain('Sensitive failure');
    log.mockRestore();
  });
});
