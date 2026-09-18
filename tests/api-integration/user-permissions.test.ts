import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET, PATCH } from '@/app/api/users/[id]/permissions/route';
import { GET as auditHistory } from '@/app/api/users/[id]/permissions/audit/route';
let managerId: number;
let manageId: number;
let markId: number;
let editId: number;
let superId: number;
let token: string;
let tokenId: number;
let sequence = 0;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (id: number | string, method = 'GET', body?: unknown, bearer?: string, query = '', audit = false) => new Request(`http://localhost/api/users/${id}/permissions${audit ? '/audit' : ''}${query}`, { method, headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, ...(method === 'PATCH' ? { body: JSON.stringify(body) } : {}) });
const change = (id: number | string, permissions: unknown, bearer?: string) => PATCH(req(id, 'PATCH', { permissions }, bearer), ctx(id));
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
const target = async (level?: number) => (await prisma.user.create({ data: { username: `Permissions target ${++sequence}`, ...(level ? { userPermissions: { create: { permissionId: manageId, value: level } } } : {}) } })).id;
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma database required.');
  const permission = async (key: string) => (await prisma.permission.upsert({ where: { key }, create: { key }, update: {} })).id;
  manageId = await permission('user:manage_permissions'); markId = await permission('training:mark'); editId = await permission('user:edit'); superId = await permission('system:super_admin');
  managerId = (await prisma.user.create({ data: { username: 'Permission integration manager', userPermissions: { create: [{ permissionId: manageId, value: 10 }, { permissionId: markId, value: 10 }, { permissionId: editId, value: 20 }] } } })).id;
  const bot = await prisma.botToken.create({ data: { name: 'Permission integration bot', token: 'permission-integration-token' } });
  tokenId = bot.id; token = bot.token;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('permission GET returns catalog defaults existing grants and audits other-user reads only', async () => {
  const id = await target();
  await prisma.userPermission.create({ data: { userId: id, permissionId: markId, value: 2 } });
  const response = await GET(req(id), ctx(id));
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.user).toEqual({ id, username: `Permissions target ${sequence}` });
  expect(data.permissions.find((row: { id: number }) => row.id === markId).currentValue).toBe(2);
  expect(data.permissions.find((row: { id: number }) => row.id === editId).currentValue).toBe(0);
  expect(await audits(response)).toEqual([expect.objectContaining({ action: 'user_data.read', targetUserIds: [id], before: null, after: null })]);
  const own = await GET(req('me'), ctx('me'));
  expect(own.status).toBe(200);
  expect(await audits(own)).toEqual([]);
});

test('PATCH grants modifies revokes and preserves omitted grants with atomic legacy and canonical audits', async () => {
  const id = await target();
  const granted = await change(id, [{ permissionId: markId, value: 3 }, { permissionId: editId, value: 4 }]);
  expect(granted.status).toBe(200);
  expect(await granted.json()).toEqual({ data: null, meta: {} });
  expect(await prisma.userPermission.count({ where: { userId: id } })).toBe(2);
  const modified = await change(id, [{ permissionId: markId, value: 5 }]);
  expect(modified.status).toBe(200);
  expect((await prisma.userPermission.findUniqueOrThrow({ where: { userId_permissionId: { userId: id, permissionId: editId } } })).value).toBe(4);
  const repeated = await change(id, [{ permissionId: markId, value: 5 }]);
  expect(await audits(repeated)).toEqual([]);
  const revoked = await change(id, [{ permissionId: markId, value: 0 }]);
  expect(revoked.status).toBe(200);
  expect(await prisma.userPermission.findUnique({ where: { userId_permissionId: { userId: id, permissionId: markId } } })).toBeNull();
  const legacy = await prisma.permissionAuditLog.findMany({ where: { targetUserId: id, permissionId: markId }, orderBy: { id: 'asc' } });
  expect(legacy.map(row => row.action)).toEqual(['GRANT', 'MODIFY', 'REVOKE']);
  expect(legacy.every(row => row.actorId === managerId)).toBe(true);
  expect((await audits(modified))[0]).toMatchObject({ action: 'user_permissions.updated', before: { permissions: [{ permissionId: markId, value: 3 }] }, after: { permissions: [{ permissionId: markId, value: 5 }] } });
});

test('delegation guards prevent self peer superadmin and equal-permission escalation before any changes', async () => {
  const id = await target();
  const peer = await target(10);
  expect((await change('me', [{ permissionId: markId, value: 1 }])).status).toBe(403);
  expect((await change(peer, [{ permissionId: markId, value: 1 }])).status).toBe(403);
  expect((await change(id, [{ permissionId: editId, value: 1 }, { permissionId: markId, value: 10 }])).status).toBe(403);
  expect((await change(id, [{ permissionId: superId, value: 1 }])).status).toBe(403);
  expect(await prisma.userPermission.count({ where: { userId: id } })).toBe(0);
  await prisma.userPermission.create({ data: { userId: id, permissionId: markId, value: 11 } });
  expect((await change(id, [{ permissionId: markId, value: 0 }])).status).toBe(403);
  const bot = await change(peer, [{ permissionId: superId, value: 1 }], token);
  expect(bot.status).toBe(200);
  expect((await audits(bot))[0]).toMatchObject({ actorType: 'bot', actorTokenId: tokenId, actorUserId: null });
  expect(await prisma.permissionAuditLog.findFirstOrThrow({ where: { targetUserId: peer } })).toMatchObject({ actorId: null, metadata: { actorType: 'bot', actorTokenId: tokenId } });
});

test('catalog maxima missing refs malformed entries and revoked credentials are enforced', async () => {
  const id = await target();
  const permission = await prisma.permission.findUniqueOrThrow({ where: { id: editId } });
  await prisma.permission.update({ where: { id: editId }, data: { maxValue: 2 } });
  try { expect((await change(id, [{ permissionId: editId, value: 3 }], token)).status).toBe(422); }
  finally { await prisma.permission.update({ where: { id: editId }, data: { maxValue: permission.maxValue } }); }
  expect((await change(id, [{ permissionId: 2147483647, value: 1 }])).status).toBe(404);
  for (const entries of [[], [{ permissionId: String(markId), value: 1 }], [{ permissionId: markId, value: 256 }], [{ permissionId: markId, value: 1 }, { permissionId: markId, value: 2 }]]) expect((await change(id, entries)).status).toBe(422);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId: manageId } }, data: { value: 0 } });
  try { expect((await change(id, [{ permissionId: markId, value: 1 }])).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId: manageId } }, data: { value: 10 } }); }
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  try { expect((await change(id, [{ permissionId: markId, value: 1 }], token)).status).toBe(401); expect((await GET(req(id, 'GET', undefined, token), ctx(id))).status).toBe(401); }
  finally { await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } }); }
});

test('permission audit pagination preserves bot and deleted actor histories without metadata and logs returned people only', async () => {
  const id = await target();
  const actor = await prisma.user.create({ data: { username: 'Deleted permission actor' } });
  const deleted = await prisma.permissionAuditLog.create({ data: { actorId: actor.id, targetUserId: id, permissionId: markId, action: 'GRANT', newValue: 1, metadata: { ipAddress: 'private-ip', userAgent: 'private-agent' }, createdAt: new Date('2026-01-01T00:00:00Z') } });
  await prisma.user.delete({ where: { id: actor.id } });
  expect((await prisma.permissionAuditLog.findUniqueOrThrow({ where: { id: deleted.id } })).actorId).toBeNull();
  await change(id, [{ permissionId: markId, value: 2 }], token);
  await change(id, [{ permissionId: markId, value: 3 }]);
  const response = await auditHistory(req(id, 'GET', undefined, undefined, '?limit=2', true), ctx(id));
  const body = await response.json();
  expect(body.data.map((row: { actorType: string }) => row.actorType)).toEqual(['user', 'bot']);
  expect(body.meta.nextCursor).toBe(String(body.data[1].id));
  expect(body.data[1].actor).toBeNull();
  const final = await auditHistory(req(id, 'GET', undefined, undefined, `?limit=2&cursor=${body.meta.nextCursor}`, true), ctx(id));
  const finalBody = await final.json();
  expect(finalBody.data).toEqual([expect.objectContaining({ id: deleted.id, actorType: 'deleted_user', actor: null, createdAt: '2026-01-01T00:00:00.000Z' })]);
  expect(finalBody.meta.nextCursor).toBeNull();
  expect(JSON.stringify(finalBody)).not.toContain('private-ip');
  expect(JSON.stringify(finalBody)).not.toContain('metadata');
  expect((await audits(response))[0]).toMatchObject({ targetUserIds: [id], before: null, after: null });
});

test.each(['legacy', 'canonical'] as const)('permission changes roll back every grant and both histories when %s audit fails', async stage => {
  const id = await target();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const delegate = stage === 'legacy' ? tx.permissionAuditLog : tx.apiAuditLog;
    const failure = vi.spyOn(delegate, 'create').mockRejectedValue(new Error('Permission audit unavailable'));
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await change(id, [{ permissionId: markId, value: 2 }, { permissionId: editId, value: 3 }]); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.userPermission.count({ where: { userId: id } })).toBe(0);
  expect(await prisma.permissionAuditLog.count({ where: { targetUserId: id } })).toBe(0);
  expect(await audits(response)).toEqual([]);
});
