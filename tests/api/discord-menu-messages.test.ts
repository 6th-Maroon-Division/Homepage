import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  session: vi.fn(), db: { user: { findUnique: vi.fn() }, botToken: { findFirst: vi.fn(), update: vi.fn() }, discordRoleMenuMessage: { findMany: vi.fn() }, apiAuditLog: { create: vi.fn() } },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET } from '@/app/api/discord/menu-messages/route';
const request = (query = '', bot = false) => new Request(`http://localhost/api/discord/menu-messages${query}`, { headers: bot ? { authorization: 'Bearer token' } : {} });
const row = (id: number) => ({ id, menuId: 'deleted-menu', channelId: '123456789012345678', messageId: '234567890123456789', lastCommandId: 12, updatedAt: new Date('2026-10-04T12:00:00Z') });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 1 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'discord:configure' }, value: 1 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.discordRoleMenuMessage.findMany.mockResolvedValue([]);
});
test('retains removed-menu references and provides ascending pagination for recovery', async () => {
  mocks.db.discordRoleMenuMessage.findMany.mockResolvedValue([row(2), row(3)]);
  const response = await GET(request('?cursor=1&limit=1'));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({ data: [{ ...row(2), updatedAt: '2026-10-04T12:00:00.000Z' }], meta: { nextCursor: '2', limit: 1 } });
  expect(mocks.db.discordRoleMenuMessage.findMany).toHaveBeenCalledWith({ where: { id: { gt: 1 } }, orderBy: { id: 'asc' }, take: 2 });
});
test('allows bot reconciliation and empty first pages', async () => {
  expect((await GET(request('', true))).status).toBe(200);
  expect(mocks.db.discordRoleMenuMessage.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { id: 'asc' }, take: 31 });
});
test('requires authentication and configuration permission', async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: 1 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'discord:view' }, value: 1 }] });
  expect((await GET(request())).status).toBe(403);
  expect(mocks.db.discordRoleMenuMessage.findMany).not.toHaveBeenCalled();
});
test('rejects unsupported query fields', async () => {
  expect((await GET(request('?memberId=1'))).status).toBe(400);
  expect(mocks.db.discordRoleMenuMessage.findMany).not.toHaveBeenCalled();
});
