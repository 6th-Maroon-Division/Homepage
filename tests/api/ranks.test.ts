import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), rank: model(), userRank: model(), rankDiscordRole: model(), trainingRankRequirement: model(), rankTransitionRequirement: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, POST } from '@/app/api/ranks/route';
import { PATCH, DELETE } from '@/app/api/ranks/[id]/route';
import { PATCH as reorder } from '@/app/api/ranks/reorder/route';
import { parseRankBody, parseRankReorder } from '@/lib/api/ranks';
const record = { id: 1, name: 'Private', abbreviation: 'Pvt', orderIndex: 0, attendanceRequiredSinceLastRank: 5, autoRankupEnabled: false, createdAt: new Date('2026-09-17T00:00:00Z'), updatedAt: new Date('2026-09-17T00:00:00Z') };
const input = { name: 'Private', abbreviation: 'Pvt', orderIndex: 0 };
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/ranks${query}`, { method, headers: bot ? { authorization: 'Bearer token' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.rank.findUnique.mockResolvedValue(record);
  mocks.db.rank.findMany.mockResolvedValue([record]);
  mocks.db.rank.create.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.db.rank.update.mockImplementation(async ({ data, where }) => ({ ...record, id: where.id, ...data }));
  mocks.db.userRank.count.mockResolvedValue(0);
  mocks.db.rankDiscordRole.findMany.mockResolvedValue([]);
  mocks.db.trainingRankRequirement.findMany.mockResolvedValue([]);
  mocks.db.rankTransitionRequirement.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const methods = [
  ['GET', (bot = false) => GET(req('GET', undefined, bot))],
  ['POST', (bot = false) => POST(req('POST', input, bot))],
  ['PATCH', (bot = false) => PATCH(req('PATCH', { name: 'New' }, bot), ctx())],
  ['DELETE', (bot = false) => DELETE(req('DELETE', undefined, bot), ctx())],
  ['reorder', (bot = false) => reorder(req('PATCH', { ranks: [{ id: 1, orderIndex: 3 }] }, bot))],
] as const;
describe('rank authentication and authorization', () => {
  it.each(methods)('%s accepts authorized users/bots and rejects missing/revoked credentials', async (_method, call) => {
    expect((await call()).status).toBeLessThan(300);
    expect((await call(true)).status).toBeLessThan(300);
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await call(true)).status).toBe(401);
  });
  it('allows ordinary user reads but restricts mutations', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await GET(req())).status).toBe(200);
    for (const [, call] of methods.slice(1)) expect((await call()).status).toBe(403);
  });
  it.each([['rank:create', 1], ['rank:edit', 2], ['rank:delete', 3]] as const)('allows specific %s grants', async (permission, index) => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: permission }, value: 1 }] });
    expect((await methods[index][1]()).status).toBeLessThan(300);
  });
});
describe('rank body validation', () => {
  it.each([null, [], {}, { ...input, extra: true }, { ...input, name: '' }, { ...input, abbreviation: ' ' }, { ...input, orderIndex: -1 }, { ...input, orderIndex: 2147483648 }, { ...input, orderIndex: '0' }, { ...input, attendanceRequiredSinceLastRank: -1 }, { ...input, autoRankupEnabled: 'true' }])('rejects invalid create %j', async body => expect((await POST(req('POST', body))).status).toBe(422));
  it('supports explicit zero/null/false, trims text, preserves omitted fields', async () => {
    expect(parseRankBody({ ...input, name: ' Private ', attendanceRequiredSinceLastRank: 0, autoRankupEnabled: false }, true)).toEqual({ data: { ...input, attendanceRequiredSinceLastRank: 0, autoRankupEnabled: false } });
    expect(parseRankBody({ attendanceRequiredSinceLastRank: null }, false)).toEqual({ data: { attendanceRequiredSinceLastRank: null } });
    const response = await PATCH(req('PATCH', { abbreviation: ' NEW ' }), ctx());
    expect(await response.json()).toMatchObject({ data: { abbreviation: 'NEW', attendanceRequiredSinceLastRank: 5 }, meta: {} });
    expect(mocks.db.rank.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { abbreviation: 'NEW' } });
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(422);
  });
  it.each([null, [], {}, { ranks: [] }, { ranks: [{ id: 1, orderIndex: 1 }], extra: 1 }, { ranks: [null] }, { ranks: [{ id: 1, orderIndex: 1, extra: true }] }, { ranks: [{ id: 0, orderIndex: 1 }] }, { ranks: [{ id: '1', orderIndex: 1 }] }, { ranks: [{ id: 1, orderIndex: -1 }] }, { ranks: [{ id: 1, orderIndex: 0 }, { id: 1, orderIndex: 2 }] }])('rejects invalid reorder %j', async body => {
    expect(parseRankReorder(body)).toHaveProperty('error');
    expect((await reorder(req('PATCH', body))).status).toBe(422);
  });
  it('rejects malformed JSON', async () => {
    const invalid = () => new Request('http://localhost/api/ranks', { method: 'PATCH', body: '{' });
    expect((await POST(invalid())).status).toBe(400);
    expect((await PATCH(invalid(), ctx())).status).toBe(400);
    expect((await reorder(invalid())).status).toBe(400);
  });
  it.each([PATCH, DELETE])('rejects invalid IDs and missing rank', async handler => {
    const method = handler === PATCH ? 'PATCH' : 'DELETE';
    const body = method === 'PATCH' ? { name: 'New' } : undefined;
    for (const id of ['0', 'bad', '2147483648']) expect((await handler(req(method, body), ctx(id))).status).toBe(400);
    mocks.db.rank.findUnique.mockResolvedValue(null);
    expect((await handler(req(method, body), ctx())).status).toBe(404);
  });
});
describe('rank listing and transactional actions', () => {
  it('uses ascending cursor pagination with lookahead and ISO timestamps', async () => {
    mocks.db.rank.findMany.mockResolvedValue([record, { ...record, id: 2 }]);
    expect(await (await GET(req('GET', undefined, false, '?limit=1&cursor=3'))).json()).toMatchObject({ data: [{ id: 1, createdAt: '2026-09-17T00:00:00.000Z' }], meta: { limit: 1, nextCursor: '1' } });
    expect(mocks.db.rank.findMany).toHaveBeenCalledWith({ where: { id: { gt: 3 } }, orderBy: { id: 'asc' }, take: 2 });
    mocks.db.rank.findMany.mockResolvedValue([record]);
    expect((await (await GET(req('GET', undefined, false, '?limit=1'))).json()).meta.nextCursor).toBeNull();
    expect((await GET(req('GET', undefined, false, '?limit=0'))).status).toBe(400);
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('audits creates and updates with correct user/bot actors', async () => {
    expect((await POST(req('POST', input))).status).toBe(201);
    await PATCH(req('PATCH', { name: 'New' }, true), ctx());
    expect(mocks.db.apiAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'rank.created', actorUserId: 4, after: input });
    expect(mocks.db.apiAuditLog.create.mock.calls[1][0].data).toMatchObject({ action: 'rank.updated', actorTokenId: 9, before: { name: 'Private' }, after: { name: 'New' } });
  });
  it('refuses deletion of assigned ranks without mutating data', async () => {
    mocks.db.userRank.count.mockResolvedValue(1);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(409);
    expect(mocks.db.rank.delete).not.toHaveBeenCalled();
  });
  it('records cascaded mapping and requirement IDs before deleting', async () => {
    const affectedDiscordMappings = [{ id: 2, guildId: '123456789012345678', discordRoleId: '234567890123456789', isActive: true }];
    const detachedTrainingRequirements = [{ id: 3, trainingId: 4, minimumRankId: 1 }];
    mocks.db.rankDiscordRole.findMany.mockResolvedValue(affectedDiscordMappings);
    mocks.db.trainingRankRequirement.findMany.mockResolvedValue(detachedTrainingRequirements);
    mocks.db.rankTransitionRequirement.findMany.mockResolvedValue([{ id: 5, targetRankId: 1, requiredTrainings: [{ id: 4 }] }]);
    expect(await (await DELETE(req('DELETE'), ctx())).json()).toEqual({ data: null, meta: {} });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'rank.deleted', before: expect.objectContaining({ affectedDiscordMappings, detachedTrainingRequirements, deletedTransitionRequirements: [{ id: 5, targetRankId: 1, requiredTrainingIds: [4] }] }) }) });
  });
  it('validates all reorder IDs before writing, then audits each change atomically', async () => {
    mocks.db.rank.findMany.mockResolvedValue([]);
    expect((await reorder(req('PATCH', { ranks: [{ id: 1, orderIndex: 1 }] }))).status).toBe(404);
    expect(mocks.db.rank.update).not.toHaveBeenCalled();
    mocks.db.rank.findMany.mockResolvedValue([record, { ...record, id: 2, orderIndex: 1 }]);
    expect(await (await reorder(req('PATCH', { ranks: [{ id: 1, orderIndex: 1 }, { id: 2, orderIndex: 0 }] }))).json()).toEqual({ data: null, meta: {} });
    const audits = mocks.db.apiAuditLog.create.mock.calls.map(([arg]) => arg.data);
    expect(audits).toMatchObject([{ action: 'rank.reordered', resourceId: '1', before: { orderIndex: 0 }, after: { orderIndex: 1 } }, { action: 'rank.reordered', resourceId: '2', before: { orderIndex: 1 }, after: { orderIndex: 0 } }]);
  });
  it.each([['P2002', 409], ['P2025', 404], ['P2003', 409]])('maps database failure %s consistently', async (code, status) => {
    mocks.db.$transaction.mockRejectedValue({ code });
    for (const [, call] of methods.slice(1)) expect((await call()).status).toBe(status);
  });
  it('fails closed for audit failures on every mutation', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    for (const [, call] of methods.slice(1)) expect((await call()).status).toBe(500);
    spy.mockRestore();
  });
});
