import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), rank: model(), rankDiscordRole: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/ranks/discord-roles/route';
import { PATCH, DELETE } from '@/app/api/ranks/[id]/discord-role/route';
import { parseDiscordRoleBody } from '@/lib/api/rank-discord-roles';
const guildId = '123456789012345678';
const discordRoleId = '234567890123456789';
const record = { id: 1, rankId: 2, guildId, discordRoleId, isActive: false, createdAt: new Date('2026-09-17T00:00:00Z'), updatedAt: new Date('2026-09-17T00:00:00Z'), rank: { id: 2, name: 'Private', abbreviation: 'Pvt', orderIndex: 1 } };
const req = (method = 'GET', body?: unknown, bot = false, query = `guildId=${guildId}`) => new Request(`http://localhost/api/ranks/discord-roles?${query}`, { method, headers: bot ? { authorization: 'Bearer bot-token' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id = '2') => ({ params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'rank:edit' }, value: 1 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.rank.findUnique.mockResolvedValue({ id: 2 });
  mocks.db.rankDiscordRole.findUnique.mockResolvedValue(record);
  mocks.db.rankDiscordRole.findMany.mockResolvedValue([record]);
  mocks.db.rankDiscordRole.create.mockImplementation(async ({ data }) => ({ ...record, isActive: true, ...data }));
  mocks.db.rankDiscordRole.update.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const methods = [
  ['GET', (bot = false) => GET(req('GET', undefined, bot))],
  ['PATCH', (bot = false) => PATCH(req('PATCH', { discordRoleId }, bot), ctx())],
  ['DELETE', (bot = false) => DELETE(req('DELETE', undefined, bot), ctx())],
] as const;
describe('rank mapping credentials and permission', () => {
  it.each(methods)('%s accepts authorized users and active bots, rejects missing/revoked credentials', async (_name, call) => {
    expect((await call()).status).toBe(200);
    expect((await call(true)).status).toBe(200);
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await call(true)).status).toBe(401);
  });
  it.each(methods)('%s requires current rank edit rights', async (_name, call) => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await call()).status).toBe(403);
  });
});
describe('mapping query and payload contracts', () => {
  it.each(['', 'guildId=invalid', 'guildId=123', `guildId=${guildId}&activeOnly=yes`, `guildId=${guildId}&limit=0`, `guildId=${guildId}&cursor=2147483648`])('rejects invalid listing query %s', async query => expect((await GET(req('GET', undefined, false, query))).status).toBe(400));
  it('lists inactive mappings by default and filters active mappings explicitly', async () => {
    expect((await GET(req())).status).toBe(200);
    expect(mocks.db.rankDiscordRole.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { guildId }, take: 51, orderBy: { id: 'asc' } }));
    expect((await GET(req('GET', undefined, false, `guildId=${guildId}&activeOnly=false`))).status).toBe(200);
    mocks.db.rankDiscordRole.findMany.mockResolvedValue([record, { ...record, id: 3 }]);
    const response = await GET(req('GET', undefined, false, `guildId=${guildId}&activeOnly=true&limit=1&cursor=5`));
    expect(await response.json()).toMatchObject({ data: [{ id: 1, rank: { id: 2 }, createdAt: '2026-09-17T00:00:00.000Z' }], meta: { limit: 1, nextCursor: '1' } });
    expect(mocks.db.rankDiscordRole.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { guildId, isActive: true, id: { gt: 5 } }, take: 2 }));
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it('returns a null cursor on an exactly full last page or no mappings', async () => {
    expect((await (await GET(req('GET', undefined, false, `guildId=${guildId}&limit=1`))).json()).meta.nextCursor).toBeNull();
    mocks.db.rankDiscordRole.findMany.mockResolvedValue([]);
    expect((await (await GET(req())).json()).data).toEqual([]);
  });
  it.each([null, [], {}, { guildId }, { discordRoleId: 123456789012345678 }, { discordRoleId: '123' }, { isActive: 'false' }])('rejects malformed patch %j', async body => {
    expect(parseDiscordRoleBody(body)).toHaveProperty('error');
    expect((await PATCH(req('PATCH', body), ctx())).status).toBe(422);
  });
  it.each([PATCH, DELETE])('requires numeric Int32 rank id and guild query', async handler => {
    const method = handler === PATCH ? 'PATCH' : 'DELETE';
    const body = handler === PATCH ? { isActive: true } : undefined;
    for (const id of ['bad', '0', '2147483648']) expect((await handler(req(method, body), ctx(id))).status).toBe(400);
    expect((await handler(req(method, body, false, ''), ctx())).status).toBe(400);
  });
  it('rejects malformed JSON', async () => expect((await PATCH(new Request(`http://localhost/api/ranks/2/discord-role?guildId=${guildId}`, { method: 'PATCH', body: '{' }), ctx())).status).toBe(400));
});
describe('mapping mutations and audit', () => {
  it('creates missing mappings with required Discord role and active default', async () => {
    mocks.db.rankDiscordRole.findUnique.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { isActive: true }), ctx())).status).toBe(422);
    const response = await PATCH(req('PATCH', { discordRoleId }), ctx());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { discordRoleId, isActive: true, rank: { id: 2 } } });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'rank_discord_role.created', actorUserId: 4, after: { rankId: 2, guildId, discordRoleId, isActive: true } }) });
    expect((await PATCH(req('PATCH', { discordRoleId, isActive: false }), ctx())).status).toBe(200);
    expect(mocks.db.rankDiscordRole.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: { rankId: 2, guildId, discordRoleId, isActive: false } }));
  });
  it('preserves omitted flags and allows flag-only update with bot attribution', async () => {
    expect((await (await PATCH(req('PATCH', { discordRoleId }), ctx())).json()).data.isActive).toBe(false);
    const response = await PATCH(req('PATCH', { isActive: true }, true), ctx());
    expect((await response.json()).data.discordRoleId).toBe(discordRoleId);
    expect(mocks.db.apiAuditLog.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ action: 'rank_discord_role.updated', actorType: 'bot', actorTokenId: 9, before: { rankId: 2, guildId, discordRoleId, isActive: false }, after: { rankId: 2, guildId, discordRoleId, isActive: true } }) });
  });
  it('returns 404 for missing rank or mapping', async () => {
    mocks.db.rank.findUnique.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { discordRoleId }), ctx())).status).toBe(404);
    mocks.db.rankDiscordRole.findUnique.mockResolvedValue(null);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(404);
  });
  it('deletes mapping and audits the prior values', async () => {
    const response = await DELETE(req('DELETE'), ctx());
    expect(await response.json()).toEqual({ data: null, meta: {} });
    expect(mocks.db.rankDiscordRole.delete).toHaveBeenCalledWith({ where: { rankId_guildId: { rankId: 2, guildId } } });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'rank_discord_role.deleted', before: { rankId: 2, guildId, discordRoleId, isActive: false } }) });
  });
  it.each([['P2002', 409], ['P2003', 404], ['P2025', 404]])('maps concurrent database error %s', async (code, status) => {
    mocks.db.$transaction.mockRejectedValue({ code });
    expect((await PATCH(req('PATCH', { discordRoleId }), ctx())).status).toBe(status);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(status);
  });
  it('fails closed if transactional auditing fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    expect((await PATCH(req('PATCH', { discordRoleId }), ctx())).status).toBe(500);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(500);
    expect(mocks.db.$transaction).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
