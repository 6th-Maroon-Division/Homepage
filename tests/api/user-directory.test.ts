import { beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), db: { user: { findUnique: vi.fn(), findMany: vi.fn() }, botToken: { findFirst: vi.fn(), update: vi.fn() }, apiAuditLog: { create: vi.fn() } } }));
vi.mock('@/lib/prisma', () => ({ prisma: m.db }));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/users/route';
const req = (query = '', token?: string) => new Request(`http://localhost/api/users${query}`, { headers: token ? { authorization: token } : {} });
const row = (id: number) => ({ id, username: `User ${id}`, email: null, avatarUrl: null, createdAt: new Date('2026-01-01Z'), accounts: [], userRank: null });
beforeEach(() => {
  vi.resetAllMocks(); m.session.mockResolvedValue({ user: { id: 4 } });
  m.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'user:manage' }, value: 10 }] });
  m.db.user.findMany.mockResolvedValue([row(4)]); m.db.botToken.findFirst.mockResolvedValue({ id: 9 });
});
test('self-only page uses minimal DTO and no audit; bots audit all returned IDs', async () => {
  const response = await GET(req());
  expect(await response.json()).toEqual({ data: [{ id: 4, username: 'User 4', email: null, avatarUrl: null, createdAt: '2026-01-01T00:00:00.000Z', isRetired: false, currentRank: null, discordId: null, steamId: null }], meta: { limit: 50, nextCursor: null } });
  expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();
  await GET(req('', 'Bearer valid'));
  expect(m.db.apiAuditLog.create.mock.lastCall![0].data).toMatchObject({ actorType: 'bot', actorTokenId: 9, targetUserIds: [4] });
  expect(m.db.apiAuditLog.create.mock.lastCall![0].data.before).toBeUndefined();
  expect(m.db.apiAuditLog.create.mock.lastCall![0].data.after).toBeUndefined();
});
test('lookahead is excluded from read audit and filters precede pagination', async () => {
  m.db.user.findMany.mockResolvedValue([row(4), { ...row(5), userRank: { retired: true, currentRank: { id: 2, name: 'Private', abbreviation: 'PVT' } }, accounts: [{ provider: 'discord', providerUserId: '123' }, { provider: 'steam', providerUserId: '456' }] }, row(6)]);
  const body = await (await GET(req('?limit=2&cursor=3&activeOnly=true&hasDiscord=true&steamId=456'))).json();
  expect(body.meta).toEqual({ limit: 2, nextCursor: '5' });
  expect(body.data[1]).toMatchObject({ discordId: '123', steamId: '456', isRetired: true, currentRank: { id: 2 } });
  expect(m.db.apiAuditLog.create.mock.lastCall![0].data.targetUserIds).toEqual([5]);
  const args = m.db.user.findMany.mock.lastCall![0];
  expect(args.take).toBe(3); expect(args.where.AND).toContainEqual({ id: { gt: 3 } });
  expect(args.where.AND).toContainEqual({ accounts: { some: { provider: 'steam', providerUserId: '456' } } });
  expect(args.where.AND[0].OR[1].userPermissions.none.OR[1]).toEqual({ permission: { key: 'user:manage' }, value: { gte: 10 } });
});
test.each(['?page=2', '?limit=1&limit=2', '?activeOnly=1', '?hasSteam=no', '?hasDiscord=', '?discordId=oops', '?steamId=-1', '?cursor=2147483648', '?limit=0'])('rejects invalid query %s', async query => {
  expect((await GET(req(query))).status).toBe(400); expect(m.db.user.findMany).not.toHaveBeenCalled();
});
test('missing or insufficient credentials reject; explicit bad bearer does not fall back', async () => {
  m.session.mockResolvedValue(null); expect((await GET(req())).status).toBe(401);
  m.session.mockResolvedValue({ user: { id: 4 } }); m.db.user.findUnique.mockResolvedValue({ userPermissions: [] }); expect((await GET(req())).status).toBe(403);
  m.db.botToken.findFirst.mockResolvedValue(null); expect((await GET(req('', 'Bearer bad'))).status).toBe(401);
  expect(m.db.user.findMany).not.toHaveBeenCalled();
});
test('false filters do not restrict rows, empty pages have no audit, and limit caps at 100', async () => {
  m.db.user.findMany.mockResolvedValue([]);
  expect(await (await GET(req('?limit=101&activeOnly=false&hasDiscord=false&hasSteam=false', 'Bearer valid'))).json()).toEqual({ data: [], meta: { limit: 100, nextCursor: null } });
  expect(m.db.user.findMany.mock.lastCall![0].where).toEqual({ AND: [{}] }); expect(m.db.apiAuditLog.create).not.toHaveBeenCalled();
});
test('required read audit failure does not expose data', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  m.db.apiAuditLog.create.mockRejectedValue(new Error('audit unavailable'));
  try { expect((await GET(req('', 'Bearer valid'))).status).toBe(500); } finally { log.mockRestore(); }
});
