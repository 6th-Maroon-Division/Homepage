import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { GET } from '@/app/api/ranks/discord-roles/route';
import { PATCH, DELETE } from '@/app/api/ranks/[id]/discord-role/route';
let managerId: number;
let memberId: number;
let permissionId: number;
let fixtureIndex = 0;
const guildId = '880000000000000001';
const roleId = '880000000000000002';
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (method = 'GET', body?: unknown, token?: string, extra = '', guild = guildId, rankId?: number) => new Request(`http://localhost/api/ranks/${rankId === undefined ? 'discord-roles' : `${rankId}/discord-role`}?guildId=${guild}${extra}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const itemReq = (rankId: number, method: string, body?: unknown, token?: string) => req(method, body, token, '', guildId, rankId);
async function rank() {
  fixtureIndex += 1;
  return prisma.rank.create({ data: { name: `Discord mapping integration rank ${fixtureIndex}`, abbreviation: `DMIR${fixtureIndex}`, orderIndex: 3100 + fixtureIndex } });
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const permission = await prisma.permission.upsert({ where: { key: 'rank:edit' }, update: {}, create: { key: 'rank:edit' } });
  permissionId = permission.id;
  managerId = (await prisma.user.create({ data: { username: 'Discord mapping manager', userPermissions: { create: { permissionId, value: 1 } } } })).id;
  memberId = (await prisma.user.create({ data: { username: 'Discord mapping member' } })).id;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('mapping PATCH creates and partially updates persisted mappings, and DELETE records transactional audit', async () => {
  const target = await rank();
  const created = await PATCH(itemReq(target.id, 'PATCH', { discordRoleId: roleId }), ctx(target.id));
  expect(created.status).toBe(200);
  const data = (await created.json()).data;
  expect(data).toMatchObject({ rankId: target.id, guildId, discordRoleId: roleId, isActive: true, rank: { id: target.id, name: target.name, abbreviation: target.abbreviation } });
  expect(data.createdAt).toMatch(/Z$/);
  expect(await prisma.rankDiscordRole.findUniqueOrThrow({ where: { rankId_guildId: { rankId: target.id, guildId } } })).toMatchObject({ id: data.id, isActive: true });
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: created.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'user', actorUserId: managerId, action: 'rank_discord_role.created', method: 'PATCH', path: `/api/ranks/${target.id}/discord-role` });
  expect((await PATCH(itemReq(target.id, 'PATCH', { isActive: false }), ctx(target.id))).status).toBe(200);
  const updated = await PATCH(itemReq(target.id, 'PATCH', { discordRoleId: '880000000000000003' }), ctx(target.id));
  expect(updated.status).toBe(200);
  expect((await updated.json()).data).toMatchObject({ id: data.id, discordRoleId: '880000000000000003', isActive: false });
  expect(await prisma.rankDiscordRole.count({ where: { rankId: target.id, guildId } })).toBe(1);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: updated.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'rank_discord_role.updated' });
  const deleted = await DELETE(itemReq(target.id, 'DELETE'), ctx(target.id));
  expect(deleted.status).toBe(200);
  expect((await deleted.json()).data).toBeNull();
  expect(await prisma.rankDiscordRole.findUnique({ where: { id: data.id } })).toBeNull();
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: deleted.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'rank_discord_role.deleted', method: 'DELETE', path: `/api/ranks/${target.id}/discord-role` });
  expect((await DELETE(itemReq(target.id, 'DELETE'), ctx(target.id))).status).toBe(404);
});

test('mapping list filters guild and active status with stable lookahead pagination', async () => {
  const firstRank = await rank();
  const secondRank = await rank();
  const first = await prisma.rankDiscordRole.create({ data: { rankId: firstRank.id, guildId, discordRoleId: roleId } });
  const second = await prisma.rankDiscordRole.create({ data: { rankId: secondRank.id, guildId, discordRoleId: roleId, isActive: false } });
  await prisma.rankDiscordRole.create({ data: { rankId: firstRank.id, guildId: '880000000000000099', discordRoleId: roleId } });
  const page = await GET(req('GET', undefined, undefined, '&limit=1'));
  const body = await page.json();
  expect(body.data.map((row: { id: number }) => row.id)).toEqual([first.id]);
  expect(body.meta.nextCursor).toBe(String(first.id));
  const next = await (await GET(req('GET', undefined, undefined, `&limit=1&cursor=${first.id}&activeOnly=false`))).json();
  expect(next.data.map((row: { id: number }) => row.id)).toEqual([second.id]);
  expect(next.meta.nextCursor).toBeNull();
  const active = await (await GET(req('GET', undefined, undefined, '&activeOnly=true'))).json();
  expect(active.data.map((row: { id: number }) => row.id)).toEqual([first.id]);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: page.headers.get('X-Request-Id')! } })).toBe(0);
});

test('all mapping methods require live rank permissions and accept valid bots without session fallback for revoked tokens', async () => {
  const target = await rank();
  session.userId = memberId;
  expect((await GET(req())).status).toBe(403);
  expect((await PATCH(itemReq(target.id, 'PATCH', { discordRoleId: roleId }), ctx(target.id))).status).toBe(403);
  expect((await DELETE(itemReq(target.id, 'DELETE'), ctx(target.id))).status).toBe(403);
  session.userId = managerId;
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try { expect((await GET(req())).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 1 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Discord mapping integration bot', token: 'discord-mapping-integration-token' } });
  session.userId = null;
  expect((await GET(req('GET', undefined, bot.token))).status).toBe(200);
  const patch = await PATCH(itemReq(target.id, 'PATCH', { discordRoleId: roleId }, bot.token), ctx(target.id));
  expect(patch.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: patch.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorTokenId: bot.id });
  expect((await DELETE(itemReq(target.id, 'DELETE', undefined, bot.token), ctx(target.id))).status).toBe(200);
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = managerId;
  expect((await GET(req('GET', undefined, bot.token))).status).toBe(401);
  expect((await PATCH(itemReq(target.id, 'PATCH', { discordRoleId: roleId }, bot.token), ctx(target.id))).status).toBe(401);
  expect((await DELETE(itemReq(target.id, 'DELETE', undefined, bot.token), ctx(target.id))).status).toBe(401);
});

test('missing ranks and invalid partial creates fail without writes, and database enforces rank/guild uniqueness', async () => {
  const target = await rank();
  expect((await PATCH(itemReq(target.id, 'PATCH', { isActive: false }), ctx(target.id))).status).toBe(422);
  expect((await PATCH(itemReq(2_000_000_000, 'PATCH', { discordRoleId: roleId }), ctx(2_000_000_000))).status).toBe(404);
  expect((await DELETE(itemReq(2_000_000_000, 'DELETE'), ctx(2_000_000_000))).status).toBe(404);
  expect((await PATCH(itemReq(target.id, 'PATCH', { discordRoleId: Number(roleId) }), ctx(target.id))).status).toBe(422);
  expect(await prisma.rankDiscordRole.count({ where: { rankId: target.id } })).toBe(0);
  await prisma.rankDiscordRole.create({ data: { rankId: target.id, guildId, discordRoleId: roleId } });
  await expect(prisma.rankDiscordRole.create({ data: { rankId: target.id, guildId, discordRoleId: '880000000000000004' } })).rejects.toMatchObject({ code: 'P2002' });
  expect(await prisma.rankDiscordRole.count({ where: { rankId: target.id, guildId } })).toBe(1);
});

test('a mapping upsert rolls back its real database mutation if audit persistence fails', async () => {
  const target = await rank();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transact(async tx => {
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  })) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { expect((await PATCH(itemReq(target.id, 'PATCH', { discordRoleId: roleId }), ctx(target.id))).status).toBe(500); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(await prisma.rankDiscordRole.count({ where: { rankId: target.id } })).toBe(0);
});
