import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const methods = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() });
  return { session: vi.fn(), event: vi.fn(), db: { user: methods(), botToken: methods(), squadRole: methods(), training: methods(), rank: methods(), slot: methods(), apiAuditLog: methods(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
vi.mock('@/lib/realtime/admin-catalog-events', () => ({ publishAdminCatalogEvent: mocks.event }));
import { GET, POST } from '@/app/api/subslot-definitions/route';
import { PATCH, DELETE } from '@/app/api/subslot-definitions/[id]/route';
import { parseRoleDefinition, roleReadPermissions } from '@/lib/api/role-definitions';
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/subslot-definitions${query}`, { method, headers: bot ? { authorization: 'Bearer credential' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const role = { id: 1, name: 'Medic', requiredTrainingIds: [] as number[], requiredRankIds: [] as number[], isRetired: false };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: '4' } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.squadRole.findUnique.mockResolvedValue(role);
  mocks.db.squadRole.findMany.mockResolvedValue([role]);
  mocks.db.squadRole.create.mockImplementation(async ({ data }) => ({ ...role, ...data }));
  mocks.db.squadRole.update.mockImplementation(async ({ data }) => ({ ...role, ...data }));
  mocks.db.slot.count.mockResolvedValue(0);
  mocks.db.training.count.mockResolvedValue(1);
  mocks.db.rank.count.mockResolvedValue(1);
  mocks.db.training.findMany.mockResolvedValue([{ id: 2, name: 'Medical' }]);
  mocks.db.rank.findMany.mockResolvedValue([{ id: 3, name: 'Private', abbreviation: 'Pvt', orderIndex: 1 }]);
  mocks.db.$transaction.mockImplementation(async callback => callback(mocks.db));
});
const methods = [
  ['GET', (bot = false) => GET(req('GET', undefined, bot))],
  ['POST', (bot = false) => POST(req('POST', { name: 'Medic' }, bot))],
  ['PATCH', (bot = false) => PATCH(req('PATCH', { isRetired: true }, bot), ctx())],
  ['DELETE', (bot = false) => DELETE(req('DELETE', undefined, bot), ctx())],
] as const;
describe('role endpoints authentication', () => {
  it.each(methods)('%s accepts user and bot and rejects missing/invalid credentials', async (_method, call) => {
    expect((await call()).status).toBeLessThan(300);
    expect((await call(true)).status).toBeLessThan(300);
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await call(true)).status).toBe(401);
  });
  it.each(methods)('%s rejects unprivileged users', async (_method, call) => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await call()).status).toBe(403);
  });
  it.each(roleReadPermissions)('preserves read permission %s', async permission => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: permission }, value: 1 }] });
    expect((await GET(req())).status).toBe(200);
  });
});
describe('role contracts', () => {
  it.each([null, [], {}, { name: '' }, { name: 'Medic', requiredTrainingId: 2 }, { name: 'Medic', requiredRankIds: ['3'] }, { name: 'Medic', requiredTrainingIds: [-1] }, { name: 'Medic', requiredRankIds: 3 }])('rejects invalid create %j', body => expect(parseRoleDefinition(body, true)).toHaveProperty('error'));
  it('supports patch booleans, names, omitted lists and explicit empty lists', () => {
    expect(parseRoleDefinition({ name: ' Medic ', requiredTrainingIds: [2, 2], requiredRankIds: [], isRetired: false }, false)).toEqual({ data: { name: 'Medic', requiredTrainingIds: [2], requiredRankIds: [], isRetired: false } });
    expect(parseRoleDefinition({ isRetired: 'true' }, false)).toHaveProperty('error');
    expect(parseRoleDefinition({}, false)).toHaveProperty('error');
    expect(parseRoleDefinition({ requiredRankIds: [2147483648] }, false)).toHaveProperty('error');
  });
  it('paginates and enriches array-only responses', async () => {
    mocks.db.squadRole.findMany.mockResolvedValue([{ ...role, requiredTrainingIds: [2], requiredRankIds: [3] }, { ...role, id: 2 }]);
    const response = await GET(req('GET', undefined, false, '?limit=1&cursor=3'));
    const body = await response.json();
    expect(body.meta).toEqual({ limit: 1, nextCursor: '1' });
    expect(body.data[0]).toMatchObject({ requiredTrainings: [{ id: 2, name: 'Medical' }], requiredRanks: [{ id: 3 }] });
    expect(body.data[0]).not.toHaveProperty('requiredTraining');
    expect(mocks.db.squadRole.findMany).toHaveBeenCalledWith({ where: { id: { gt: 3 } }, orderBy: { id: 'asc' }, take: 2 });
    expect((await GET(req('GET', undefined, false, '?limit=0'))).status).toBe(400);
  });
  it('returns null cursor for exact-full and empty pages', async () => {
    expect((await (await GET(req('GET', undefined, false, '?limit=1'))).json()).meta.nextCursor).toBeNull();
    mocks.db.squadRole.findMany.mockResolvedValue([]);
    expect((await (await GET(req())).json()).data).toEqual([]);
  });
  it('rejects malformed JSON', async () => expect((await POST(new Request('http://localhost/api/subslot-definitions', { method: 'POST', body: '{' }))).status).toBe(400));
  it('validates prerequisites before mutation and accepts existing prerequisites', async () => {
    mocks.db.training.count.mockResolvedValue(0);
    expect((await POST(req('POST', { name: 'Medic', requiredTrainingIds: [2] }))).status).toBe(422);
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [2] }), ctx())).status).toBe(422);
    mocks.db.training.count.mockResolvedValue(1);
    mocks.db.rank.count.mockResolvedValue(0);
    expect((await POST(req('POST', { name: 'Medic', requiredRankIds: [3] }))).status).toBe(422);
    mocks.db.rank.count.mockResolvedValue(1);
    expect((await POST(req('POST', { name: 'Medic', requiredRankIds: [3], requiredTrainingIds: [2] }))).status).toBe(201);
  });
  it.each([PATCH, DELETE])('rejects invalid ids and missing resources', async handler => {
    const method = handler === PATCH ? 'PATCH' : 'DELETE';
    expect((await handler(req(method, method === 'PATCH' ? { isRetired: false } : undefined), ctx('0'))).status).toBe(400);
    expect((await handler(req(method, method === 'PATCH' ? { isRetired: false } : undefined), ctx('2147483648'))).status).toBe(400);
    mocks.db.squadRole.findUnique.mockResolvedValue(null);
    expect((await handler(req(method, method === 'PATCH' ? { isRetired: false } : undefined), ctx())).status).toBe(404);
  });
  it('rejects invalid patch and linked deletes', async () => {
    expect((await PATCH(req('PATCH', { requiredTrainingId: 2 }), ctx())).status).toBe(422);
    mocks.db.slot.count.mockResolvedValue(1);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(409);
    expect(mocks.db.squadRole.delete).not.toHaveBeenCalled();
  });
  it.each([['P2002', 409], ['P2003', 409], ['P2025', 404]])('maps database %s to %s', async (code, status) => {
    mocks.db.$transaction.mockRejectedValue({ code });
    expect((await POST(req('POST', { name: 'Medic' }))).status).toBe(status);
    expect((await PATCH(req('PATCH', { isRetired: false }), ctx())).status).toBe(status);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(status);
  });
  it('audits mutations and emits catalog events after commit with user/bot attribution', async () => {
    await POST(req('POST', { name: 'Medic' }));
    await PATCH(req('PATCH', { isRetired: true }, true), ctx());
    await DELETE(req('DELETE'), ctx());
    expect(mocks.db.apiAuditLog.create.mock.calls.map(([arg]) => arg.data.action)).toEqual(['role_definition.created', 'role_definition.updated', 'role_definition.deleted']);
    expect(mocks.event.mock.calls.map(([arg]) => arg.actorUserId)).toEqual([4, undefined, 4]);
    expect(mocks.db.apiAuditLog.create.mock.calls[1][0].data).toMatchObject({ before: { isRetired: false }, after: { isRetired: true } });
  });
  it('fails closed without event publication when audit fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('audit unavailable'));
    expect((await POST(req('POST', { name: 'Medic' }))).status).toBe(500);
    expect((await PATCH(req('PATCH', { isRetired: false }), ctx())).status).toBe(500);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(500);
    expect(mocks.event).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

it('rejects duplicate names before writes and allows renaming', async () => {
  mocks.db.squadRole.findFirst.mockResolvedValue(role);
  expect((await POST(req('POST', { name: role.name }))).status).toBe(409);
  expect((await PATCH(req('PATCH', { name: role.name }), ctx())).status).toBe(409);
  expect(mocks.db.squadRole.create).not.toHaveBeenCalled();
  expect(mocks.db.squadRole.update).not.toHaveBeenCalled();
  mocks.db.squadRole.findFirst.mockResolvedValue(null);
  expect((await PATCH(req('PATCH', { name: 'New' }), ctx())).status).toBe(200);
});
