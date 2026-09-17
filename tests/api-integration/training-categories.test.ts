import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { GET, POST } from '@/app/api/training-categories/route';
import { PATCH, DELETE } from '@/app/api/training-categories/[id]/route';
let managerId: number;
let memberId: number;
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (method = 'GET', body?: unknown, token?: string, query = '') => new Request(`http://localhost/api/training-categories${query}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Use isolated integration runner.');
  const permissions = await Promise.all(['training:create', 'training:edit', 'training:delete'].map(key => prisma.permission.upsert({ where: { key }, create: { key }, update: {} })));
  const manager = await prisma.user.create({ data: { username: 'Category manager', userPermissions: { create: permissions.map(permission => ({ permissionId: permission.id, value: 1 })) } } });
  managerId = manager.id;
  memberId = (await prisma.user.create({ data: { username: 'Category member' } })).id;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('category CRUD, swaps, pagination, detachment and audits use real Prisma transactions', async () => {
  const firstResponse = await POST(request('POST', { name: 'Integration category A' }));
  expect(firstResponse.status).toBe(201);
  const first = (await firstResponse.json()).data;
  const second = (await (await POST(request('POST', { name: 'Integration category B' }))).json()).data;
  expect(second.orderIndex).toBe(first.orderIndex + 1);
  expect(first.createdAt).toMatch(/Z$/);
  const page = await (await GET(request('GET', undefined, undefined, '?limit=1'))).json();
  expect(page.data).toHaveLength(1);
  expect(page.meta.nextCursor).toBe(String(first.id));
  const next = await (await GET(request('GET', undefined, undefined, `?limit=1&cursor=${first.id}`))).json();
  expect(next.data[0].id).toBe(second.id);
  expect(next.meta.nextCursor).toBeNull();
  expect((await POST(request('POST', { name: first.name }))).status).toBe(409);
  const swapped = await PATCH(request('PATCH', { swapWithCategoryId: second.id }), context(first.id));
  expect(swapped.status).toBe(200);
  expect((await prisma.trainingCategory.findUniqueOrThrow({ where: { id: first.id } })).orderIndex).toBe(second.orderIndex);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: swapped.headers.get('X-Request-Id')! } })).toBe(2);
  expect((await PATCH(request('PATCH', { name: 'Integration renamed' }), context(first.id))).status).toBe(200);
  const training = await prisma.training.create({ data: { name: 'Linked integration training', categoryId: first.id } });
  const deleted = await DELETE(request('DELETE'), context(first.id));
  expect(deleted.status).toBe(200);
  expect(await prisma.trainingCategory.findUnique({ where: { id: first.id } })).toBeNull();
  expect((await prisma.training.findUniqueOrThrow({ where: { id: training.id } })).categoryId).toBeNull();
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: deleted.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'training_category.deleted', before: { name: 'Integration renamed', orderIndex: second.orderIndex, trainingIds: [training.id] } });
  expect((await DELETE(request('DELETE'), context(first.id))).status).toBe(404);
});

test('category permissions allow member reads and bot mutations but reject revoked tokens', async () => {
  session.userId = memberId;
  expect((await GET(request())).status).toBe(200);
  expect((await POST(request('POST', { name: 'Forbidden' }))).status).toBe(403);
  expect((await PATCH(request('PATCH', { name: 'Forbidden' }), context(1))).status).toBe(403);
  expect((await DELETE(request('DELETE'), context(1))).status).toBe(403);
  const bot = await prisma.botToken.create({ data: { name: 'Category bot', token: 'category-integration-token' } });
  session.userId = null;
  const created = await POST(request('POST', { name: 'Bot category' }, bot.token));
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id;
  expect((await PATCH(request('PATCH', { orderIndex: 15 }, bot.token), context(id))).status).toBe(200);
  expect((await DELETE(request('DELETE', undefined, bot.token), context(id))).status).toBe(200);
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  expect((await GET(request('GET', undefined, bot.token))).status).toBe(401);
});

test('category delete rolls back linked training detachment and deletion if audit storage fails', async () => {
  const category = await prisma.trainingCategory.create({ data: { name: 'Rollback category' } });
  const training = await prisma.training.create({ data: { name: 'Rollback linked training', categoryId: category.id } });
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transact(async tx => {
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit outage'));
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  })) as typeof prisma.$transaction);
  try { expect((await DELETE(request('DELETE'), context(category.id))).status).toBe(500); }
  finally { transactionSpy.mockRestore(); }
  expect(await prisma.trainingCategory.findUnique({ where: { id: category.id } })).not.toBeNull();
  expect((await prisma.training.findUniqueOrThrow({ where: { id: training.id } })).categoryId).toBe(category.id);
  expect(await prisma.apiAuditLog.count({ where: { resource: 'training_category', resourceId: String(category.id) } })).toBe(0);
});
