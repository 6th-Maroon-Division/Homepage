import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), upsert: vi.fn(), create: vi.fn() });
  return { session: vi.fn(), publish: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), userRank: model(), rankHistory: model(), botEvent: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/user-events', () => ({ publishUserProfileEvent: mocks.publish }));
import { PATCH as single } from '@/app/api/users/[id]/status/route';
import { PATCH as bulk } from '@/app/api/users/status/route';
import { parseBulkUserStatus } from '@/lib/api/user-status';
const ctx = (id = '5') => ({ params: Promise.resolve({ id }) });
const req = (body: unknown, bot = false) => new Request('http://localhost/api/users/status', { method: 'PATCH', headers: bot ? { authorization: 'Bearer bot' } : {}, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ id: 5, userPermissions: [{ permission: { key: 'user:manage' }, value: 2 }] });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.userRank.findUnique.mockResolvedValue({ interviewDone: false, retired: true });
  mocks.db.userRank.upsert.mockImplementation(async ({ where, update }) => ({ userId: where.userId, interviewDone: false, retired: true, ...update }));
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const calls = [
  ['single', (bot = false) => single(req({ interviewDone: true }, bot), ctx())],
  ['bulk', (bot = false) => bulk(req({ updates: [{ userId: 5, retired: false }] }, bot))],
] as const;
describe('user status access', () => {
  it.each(calls)('%s accepts users/bots and rejects absent/revoked credentials', async (_name, call) => {
    expect((await call()).status).toBe(200);
    expect((await call(true)).status).toBe(200);
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await call(true)).status).toBe(401);
  });
  it('requires global permission even for self and allows authorized me', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
    expect((await single(req({ retired: true }), ctx('me'))).status).toBe(403);
    expect((await bulk(req({ updates: [{ userId: 4, retired: true }] }))).status).toBe(403);
    mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'user:manage' }, value: 1 }] });
    expect((await single(req({ retired: true }), ctx('me'))).status).toBe(200);
    expect((await single(req({ retired: true }, true), ctx('me'))).status).toBe(400);
  });
  it.each(calls)('%s requires strictly higher target hierarchy', async (_name, call) => {
    mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:manage' }, value: 2 }]);
    expect((await call()).status).toBe(403);
    mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:manage' }, value: 1 }]);
    expect((await call()).status).toBe(200);
  });
});
describe('user status strict contracts', () => {
  it.each([null, [], {}, { retired: 'true' }, { interviewDone: null }, { retired: true, other: false }])('rejects invalid single flags %j', async body => expect((await single(req(body), ctx())).status).toBe(422));
  it.each([null, [], {}, { updates: [] }, { updates: [{ userId: 5 }] }, { updates: [null] }, { updates: [{ userId: '5', retired: true }] }, { updates: [{ userId: 2147483648, retired: true }] }, { updates: [{ userId: 5, retired: true }, { userId: 5, retired: false }] }, { updates: [{ userId: 5, retired: true }], other: true }])('rejects malformed batch %j', async body => expect((await bulk(req(body))).status).toBe(422));
  it('enforces batch cap without silently deduplicating', () => {
    const updates = Array.from({ length: 101 }, (_, index) => ({ userId: index + 1, retired: false }));
    expect(parseBulkUserStatus({ updates })).toHaveProperty('error');
    expect(parseBulkUserStatus({ updates: updates.slice(0, 100) })).toHaveProperty('data');
  });
  it('rejects malformed JSON and bad route identifiers', async () => {
    const invalid = () => new Request('http://localhost/api', { method: 'PATCH', body: '{' });
    expect((await single(invalid(), ctx())).status).toBe(400);
    expect((await bulk(invalid())).status).toBe(400);
    for (const id of ['bad', '0', '2147483648']) expect((await single(req({ retired: true }), ctx(id))).status).toBe(400);
  });
});
describe('atomic status changes', () => {
  it('preflights all targets for existence and hierarchy before any writes', async () => {
    mocks.db.user.findUnique.mockResolvedValueOnce({ userPermissions: [{ permission: { key: 'user:manage' }, value: 2 }] }).mockResolvedValueOnce({ id: 5 }).mockResolvedValueOnce(null);
    expect((await bulk(req({ updates: [{ userId: 5, retired: true }, { userId: 6, retired: false }] }))).status).toBe(404);
    expect(mocks.db.userRank.upsert).not.toHaveBeenCalled();
    mocks.db.userPermission.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ permission: { key: 'user:manage' }, value: 2 }]);
    expect((await bulk(req({ updates: [{ userId: 5, retired: true }, { userId: 6, retired: false }] }))).status).toBe(403);
    expect(mocks.db.userRank.upsert).not.toHaveBeenCalled();
  });
  it('returns DTOs in input order and changes explicit flags without touching rank or baseline', async () => {
    const response = await bulk(req({ updates: [{ userId: 6, interviewDone: true }, { userId: 5, retired: false }] }));
    expect(await response.json()).toEqual({ data: [{ userId: 6, interviewDone: true, retired: true }, { userId: 5, interviewDone: false, retired: false }], meta: {} });
    expect(mocks.db.userRank.upsert.mock.calls.map(([arg]) => arg.update)).toEqual([{ interviewDone: true }, { retired: false }]);
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.db.rankHistory.create).not.toHaveBeenCalled();
    expect(mocks.db.botEvent.create).not.toHaveBeenCalled();
  });
  it('creates missing state through defaults and audits only flags', async () => {
    mocks.db.userRank.findUnique.mockResolvedValue(null);
    const response = await single(req({ interviewDone: true, retired: false }, true), ctx());
    expect(await response.json()).toEqual({ data: { userId: 5, interviewDone: true, retired: false }, meta: {} });
    expect(mocks.db.userRank.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: 5, interviewDone: true, retired: false } }));
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'user_status.updated', actorTokenId: 9, targetUserIds: [5], before: { interviewDone: false, retired: false }, after: { interviewDone: true, retired: false } }) });
  });
  it('publishes after commit and retains committed success if listeners throw', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.publish.mockImplementation(() => { throw new Error('Sensitive listener failure'); });
    expect((await single(req({ retired: false }), ctx())).status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith(5, { source: 'user.status.updated' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('Sensitive listener failure');
    log.mockRestore();
  });
  it('fails closed on audit failures without emitting profile changes', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit failure'));
    for (const [, call] of calls) expect((await call()).status).toBe(500);
    expect(mocks.publish).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it.each([['P2034', 409], ['P2002', 409], ['P2003', 409], ['P2025', 404]])('maps transaction failure %s', async (code, status) => {
    mocks.db.$transaction.mockRejectedValue({ code });
    for (const [, call] of calls) expect((await call()).status).toBe(status);
  });
});
