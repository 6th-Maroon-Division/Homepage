import { afterAll, beforeAll, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ id: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.id === null ? null : { user: { id: session.id } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/users/route';
let actor: number; let peer: number; let member: number;
const req = (query: string, bot = false) => new Request(`http://localhost/api/users?${query}`, { headers: bot ? { authorization: 'Bearer directory-integration' } : {} });
beforeAll(async () => {
  await prisma.user.create({ data: { username: 'Directory boundary' } });
  const permission = await prisma.permission.upsert({ where: { key: 'user:manage' }, update: {}, create: { key: 'user:manage' } });
  actor = (await prisma.user.create({ data: { username: 'Directory actor', userPermissions: { create: { permissionId: permission.id, value: 10 } } } })).id;
  peer = (await prisma.user.create({ data: { username: 'Directory peer', userPermissions: { create: { permissionId: permission.id, value: 10 } }, accounts: { create: { provider: 'discord', providerUserId: '987654321000111' } } } })).id;
  member = (await prisma.user.create({ data: { username: 'Directory member', accounts: { create: { provider: 'steam', providerUserId: '987654321000222' } } } })).id;
  await prisma.botToken.create({ data: { name: 'Directory integration', token: 'directory-integration' } });
});
afterAll(async () => { await prisma.$disconnect(); });
test('hierarchy filtering happens before lookahead with self reads excluded from audit', async () => {
  session.id = actor;
  const first = await GET(req(`cursor=${actor - 1}&limit=1`));
  expect(await first.json()).toMatchObject({ data: [{ id: actor }], meta: { nextCursor: String(actor) } });
  expect(await prisma.apiAuditLog.count({ where: { correlationId: first.headers.get('X-Request-Id')! } })).toBe(0);
  const second = await GET(req(`cursor=${actor}&limit=1`));
  expect((await second.json()).data[0].id).toBe(member);
  expect((await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: second.headers.get('X-Request-Id')! } })).targetUserIds).toEqual([member]);
});
test('canonical provider filters replace bot lookups without disclosing inaccessible peers', async () => {
  session.id = actor;
  expect((await (await GET(req('discordId=987654321000111'))).json()).data).toEqual([]);
  const bot = await GET(req('discordId=987654321000111', true));
  expect((await bot.json()).data).toEqual([expect.objectContaining({ id: peer, discordId: '987654321000111' })]);
  expect((await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: bot.headers.get('X-Request-Id')! } })).actorType).toBe('bot');
  expect((await (await GET(req('steamId=987654321000222&activeOnly=true'))).json()).data[0].id).toBe(member);
});
