import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { GET, POST } from '@/app/api/subslot-definitions/route';
import { PATCH, DELETE } from '@/app/api/subslot-definitions/[id]/route';
let adminId: number;
let userId: number;
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (method = 'GET', body?: unknown, token?: string, query = '') => new Request(`http://localhost/api/subslot-definitions${query}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const permission = await prisma.permission.upsert({ where: { key: 'system:super_admin' }, update: {}, create: { key: 'system:super_admin' } });
  adminId = (await prisma.user.create({ data: { username: 'Role integration admin', userPermissions: { create: { permissionId: permission.id, value: 255 } } } })).id;
  userId = (await prisma.user.create({ data: { username: 'Role integration reader' } })).id;
});
beforeEach(() => { session.userId = adminId; });
afterAll(async () => { await prisma.$disconnect(); });

test('role lifecycle validates prerequisites, persists audit snapshots, and supports bots and pagination', async () => {
  const training = await prisma.training.create({ data: { name: 'Role integration training' } });
  const rank = await prisma.rank.create({ data: { name: 'Role integration rank', abbreviation: 'RIR', orderIndex: 2000 } });
  const response = await POST(req('POST', { name: 'Role integration medic', requiredTrainingIds: [training.id], requiredRankIds: [rank.id] }));
  expect(response.status).toBe(201);
  const { data } = await response.json();
  expect(data.requiredTrainings).toEqual([{ id: training.id, name: training.name }]);
  expect(data.requiredRanks[0]).toMatchObject({ id: rank.id });
  expect(data).not.toHaveProperty('requiredTraining');
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toMatchObject({ actorUserId: adminId, action: 'role_definition.created' });
  const bot = await prisma.botToken.create({ data: { name: 'Role integration bot', token: 'role-integration-token' } });
  session.userId = null;
  const page = await GET(req('GET', undefined, bot.token, '?limit=1'));
  expect(page.status).toBe(200);
  expect((await page.json()).meta.limit).toBe(1);
  const update = await PATCH(req('PATCH', { isRetired: true, requiredTrainingIds: [] }, bot.token), ctx(data.id));
  expect(update.status).toBe(200);
  expect(await prisma.squadRole.findUniqueOrThrow({ where: { id: data.id } })).toMatchObject({ isRetired: true, requiredTrainingIds: [] });
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: update.headers.get('X-Request-Id')! } })).toMatchObject({ actorTokenId: bot.id, before: { isRetired: false, requiredTrainingIds: [training.id] }, after: { isRetired: true, requiredTrainingIds: [] } });
  expect((await DELETE(req('DELETE', undefined, bot.token), ctx(data.id))).status).toBe(200);
  expect(await prisma.squadRole.findUnique({ where: { id: data.id } })).toBeNull();
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = adminId;
  expect((await GET(req('GET', undefined, bot.token))).status).toBe(401);
});

test('roles return conflict for duplicate names and linked slots, not-found and validation contracts', async () => {
  const role = await prisma.squadRole.create({ data: { name: 'Role integration linked' } });
  expect((await POST(req('POST', { name: role.name }))).status).toBe(409);
  expect((await POST(req('POST', { name: 'Invalid role', requiredTrainingIds: [2_000_000_000] }))).status).toBe(422);
  expect((await PATCH(req('PATCH', { requiredRankIds: [2_000_000_000] }), ctx(role.id))).status).toBe(422);
  const orbat = await prisma.orbat.create({ data: { name: 'Role integration ORBAT', createdById: adminId } });
  const squad = await prisma.squad.create({ data: { name: 'Squad', orbatId: orbat.id, orderIndex: 0 } });
  await prisma.slot.create({ data: { squadId: squad.id, orbatId: orbat.id, squadRoleId: role.id, orderIndex: 0 } });
  expect((await DELETE(req('DELETE'), ctx(role.id))).status).toBe(409);
  expect(await prisma.squadRole.findUnique({ where: { id: role.id } })).not.toBeNull();
  expect((await DELETE(req('DELETE'), ctx(2_000_000_000))).status).toBe(404);
  expect((await PATCH(req('PATCH', { isRetired: false }), ctx(2_000_000_000))).status).toBe(404);
});

test('role read grants do not permit mutation and permissions are refreshed', async () => {
  session.userId = userId;
  expect((await GET(req())).status).toBe(403);
  const permission = await prisma.permission.upsert({ where: { key: 'template:edit' }, update: {}, create: { key: 'template:edit' } });
  const grant = await prisma.userPermission.create({ data: { userId, permissionId: permission.id, value: 1 } });
  expect((await GET(req())).status).toBe(200);
  expect((await POST(req('POST', { name: 'Not allowed' }))).status).toBe(403);
  await prisma.userPermission.delete({ where: { id: grant.id } });
  expect((await GET(req())).status).toBe(403);
});

test('role mutation is rolled back when transactional audit persistence fails', async () => {
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transact(async tx => {
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  })) as typeof prisma.$transaction);
  let response: Response;
  try { response = await POST(req('POST', { name: 'Role integration rollback' })); } finally { transactionSpy.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.squadRole.count({ where: { name: 'Role integration rollback' } })).toBe(0);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});
