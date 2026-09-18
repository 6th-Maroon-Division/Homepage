import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() });
  return { session: vi.fn(), db: { user: model(), userPermission: model(), botToken: model(), leaveOfAbsence: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, POST } from '@/app/api/users/[id]/leave-of-absences/route';
import { PATCH } from '@/app/api/leave-of-absences/[id]/route';
import { parseLeaveBody } from '@/lib/api/leave-of-absences';
const start = '2026-09-17T00:00:00Z';
const record = { id: 1, userId: 4, startDate: new Date(start), returnDate: null, reason: 'private reason', cancelledAt: null, createdAt: new Date(start), updatedAt: new Date(start) };
const ctx = (id = '4') => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/users/4/leave-of-absences${query}`, { method, headers: bot ? { authorization: 'Bearer bot' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [] });
  mocks.db.userPermission.findMany.mockResolvedValue([]);
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.leaveOfAbsence.findMany.mockResolvedValue([record]);
  mocks.db.leaveOfAbsence.findUnique.mockResolvedValue(record);
  mocks.db.leaveOfAbsence.create.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.db.leaveOfAbsence.update.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const methods = [
  ['GET', (bot = false) => GET(req('GET', undefined, bot), ctx())],
  ['POST', (bot = false) => POST(req('POST', { startDate: start }, bot), ctx())],
  ['PATCH', (bot = false) => PATCH(req('PATCH', { reason: 'Updated' }, bot), ctx('1'))],
] as const;
describe('leave authentication and authorization', () => {
  it.each(methods)('%s accepts self and bots, rejects missing/revoked authentication', async (_method, call) => {
    expect((await call()).status).toBeLessThan(300);
    expect((await call(true)).status).toBeLessThan(300);
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await call(true)).status).toBe(401);
  });
  it('supports session me but rejects bot me', async () => {
    expect((await GET(req(), ctx('me'))).status).toBe(200);
    expect((await POST(req('POST', { startDate: start }), ctx('me'))).status).toBe(201);
    expect((await GET(req('GET', undefined, true), ctx('me'))).status).toBe(400);
    expect((await POST(req('POST', { startDate: start }, true), ctx('me'))).status).toBe(400);
  });
  it('requires strictly higher user edit permissions for other people', async () => {
    expect((await GET(req(), ctx('5'))).status).toBe(403);
    expect((await POST(req('POST', { startDate: start }), ctx('5'))).status).toBe(403);
    mocks.db.leaveOfAbsence.findUnique.mockResolvedValue({ ...record, userId: 5 });
    expect((await PATCH(req('PATCH', { reason: null }), ctx('1'))).status).toBe(403);
    mocks.db.user.findUnique.mockResolvedValue({ id: 4, userPermissions: [{ permission: { key: 'user:edit' }, value: 2 }] });
    mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:edit' }, value: 1 }]);
    expect((await GET(req(), ctx('5'))).status).toBe(200);
    expect((await PATCH(req('PATCH', { reason: null }), ctx('1'))).status).toBe(200);
    mocks.db.userPermission.findMany.mockResolvedValue([{ permission: { key: 'user:edit' }, value: 2 }]);
    expect((await GET(req(), ctx('5'))).status).toBe(403);
  });
  it('uses transaction-scoped permissions for patch authorization', async () => {
    mocks.db.leaveOfAbsence.findUnique.mockResolvedValue({ ...record, userId: 5 });
    const transactionPermissions = vi.fn().mockResolvedValue([]);
    mocks.db.$transaction.mockImplementation(async cb => cb({ ...mocks.db, userPermission: { findMany: transactionPermissions } }));
    expect((await PATCH(req('PATCH', { reason: null }, true), ctx('1'))).status).toBe(200);
    expect(transactionPermissions).toHaveBeenCalled();
    expect(mocks.db.userPermission.findMany).not.toHaveBeenCalled();
  });
});
describe('leave validation and UTC', () => {
  it.each([null, [], {}, { startDate: '2026-09-17' }, { startDate: '2026-09-17T00:00:00' }, { startDate: start, unknown: true }, { startDate: start, returnDate: '' }, { startDate: start, returnDate: '2026-09-16T23:00:00Z' }, { startDate: start, reason: 3 }])('rejects invalid create %j', async body => expect((await POST(req('POST', body), ctx())).status).toBe(422));
  it.each([{}, { startDate: start }, { cancel: 'true' }, { returnDate: 'yesterday' }, { reason: false }])('rejects invalid patch %j', async body => expect((await PATCH(req('PATCH', body), ctx('1'))).status).toBe(422));
  it('normalizes offsets, accepts equal boundaries, nullable reason and return dates', async () => {
    const response = await POST(req('POST', { startDate: '2026-09-17T02:00:00+02:00', returnDate: start, reason: ' trimmed ' }), ctx());
    expect(await response.json()).toMatchObject({ data: { startDate: '2026-09-17T00:00:00.000Z', returnDate: '2026-09-17T00:00:00.000Z', reason: 'trimmed' } });
    expect(parseLeaveBody({ startDate: start, returnDate: null, reason: ' ' }, true)).toMatchObject({ data: { reason: null, returnDate: null } });
    expect(parseLeaveBody({ startDate: start, reason: null }, true)).toMatchObject({ data: { reason: null } });
  });
  it('cancels and uncancels without modifying omitted fields', async () => {
    const cancelled = await PATCH(req('PATCH', { cancel: true }), ctx('1'));
    expect((await cancelled.json()).data.cancelledAt).toMatch(/Z$/);
    expect(mocks.db.leaveOfAbsence.update).toHaveBeenLastCalledWith({ where: { id: 1 }, data: { cancelledAt: expect.any(Date) } });
    expect((await (await PATCH(req('PATCH', { cancel: false }), ctx('1'))).json()).data.cancelledAt).toBeNull();
    expect((await (await PATCH(req('PATCH', { returnDate: null, reason: null }), ctx('1'))).json()).data.reason).toBeNull();
  });
  it('rejects invalid identifiers and missing targets', async () => {
    for (const id of ['bad', '0', '2147483648']) {
      expect((await GET(req(), ctx(id))).status).toBe(400);
      expect((await POST(req('POST', { startDate: start }), ctx(id))).status).toBe(400);
      expect((await PATCH(req('PATCH', { reason: null }), ctx(id))).status).toBe(400);
    }
    mocks.db.user.findUnique.mockResolvedValueOnce({ id: 4, userPermissions: [] }).mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    mocks.db.leaveOfAbsence.findUnique.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { reason: null }), ctx('1'))).status).toBe(404);
  });
  it('rejects malformed JSON', async () => {
    const invalid = () => new Request('http://localhost/api', { method: 'POST', body: '{' });
    expect((await POST(invalid(), ctx())).status).toBe(400);
    expect((await PATCH(invalid(), ctx('1'))).status).toBe(400);
  });
});
describe('leave pagination, privacy, and atomic audits', () => {
  it('paginates descending with actual lookahead', async () => {
    mocks.db.leaveOfAbsence.findMany.mockResolvedValue([{ ...record, id: 8 }, { ...record, id: 7 }]);
    expect(await (await GET(req('GET', undefined, false, '?limit=1&cursor=9'), ctx())).json()).toMatchObject({ data: [{ id: 8 }], meta: { limit: 1, nextCursor: '8' } });
    expect(mocks.db.leaveOfAbsence.findMany).toHaveBeenCalledWith({ where: { userId: 4, id: { lt: 9 } }, orderBy: { id: 'desc' }, take: 2 });
    mocks.db.leaveOfAbsence.findMany.mockResolvedValue([record]);
    expect((await (await GET(req('GET', undefined, false, '?limit=1'), ctx())).json()).meta.nextCursor).toBeNull();
    expect((await GET(req('GET', undefined, false, '?limit=0'), ctx())).status).toBe(400);
  });
  it('skips self reads and audits other-user targets even without records', async () => {
    await GET(req(), ctx());
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
    mocks.db.leaveOfAbsence.findMany.mockResolvedValue([]);
    await GET(req('GET', undefined, true), ctx('5'));
    const audit = mocks.db.apiAuditLog.create.mock.lastCall![0].data;
    expect(audit).toMatchObject({ action: 'user_data.read', resource: 'leave_of_absence', actorTokenId: 9, targetUserIds: [5] });
    expect(audit).not.toHaveProperty('after');
    expect(audit).not.toHaveProperty('before');
  });
  it('records ISO snapshots and redacts reasons for every mutation', async () => {
    await POST(req('POST', { startDate: start, reason: 'private text' }), ctx());
    await PATCH(req('PATCH', { returnDate: '2026-09-18T00:00:00Z' }), ctx('1'));
    const calls = mocks.db.apiAuditLog.create.mock.calls.map(([arg]) => arg.data);
    expect(calls.map(data => data.action)).toEqual(['leave_of_absence.created', 'leave_of_absence.updated']);
    expect(calls[0].after).toMatchObject({ startDate: '2026-09-17T00:00:00.000Z', reason: '[REDACTED]' });
    expect(calls[1].after).toMatchObject({ returnDate: '2026-09-18T00:00:00.000Z', reason: '[REDACTED]' });
    expect(JSON.stringify(calls)).not.toContain('private text');
  });
  it.each(['P2003', 'P2025'])('maps vanished records %s to 404', async code => {
    mocks.db.$transaction.mockRejectedValue({ code });
    expect((await POST(req('POST', { startDate: start }), ctx())).status).toBe(404);
    expect((await PATCH(req('PATCH', { reason: null }), ctx('1'))).status).toBe(404);
  });
  it('fails reads and writes when required auditing fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    const failedRead = await GET(req('GET', undefined, true), ctx());
    expect(failedRead.status).toBe(500);
    const failedBody = await failedRead.json();
    expect(failedBody).not.toHaveProperty('data');
    expect(JSON.stringify(failedBody)).not.toContain('private reason');
    expect((await POST(req('POST', { startDate: start }), ctx())).status).toBe(500);
    expect((await PATCH(req('PATCH', { reason: null }), ctx('1'))).status).toBe(500);
    spy.mockRestore();
  });
});
