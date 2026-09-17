import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const methods = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn() });
  return { session: vi.fn(), prisma: { user: methods(), botToken: methods(), training: methods(), trainingCategory: methods(), apiAuditLog: methods(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, POST } from '@/app/api/training-categories/route';
import { PATCH, DELETE } from '@/app/api/training-categories/[id]/route';
import { parseTrainingCategoryBody, categoryMutationError } from '@/lib/api/training-categories';
const record = { id: 1, name: 'First', orderIndex: 0, createdAt: new Date('2026-09-17T00:00:00Z') };
const context = (id = '1') => ({ params: Promise.resolve({ id }) });
const request = (method = 'GET', body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/training-categories${query}`, { method, headers: { ...(bot ? { authorization: 'Bearer valid' } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const calls = [
  ['GET', (bot = false) => GET(request('GET', undefined, bot))],
  ['POST', (bot = false) => POST(request('POST', { name: 'Created' }, bot))],
  ['PATCH', (bot = false) => PATCH(request('PATCH', { name: 'Updated' }, bot), context())],
  ['DELETE', (bot = false) => DELETE(request('DELETE', undefined, bot), context())],
] as const;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: '1' } });
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] });
  mocks.prisma.botToken.findFirst.mockResolvedValue({ id: 7 });
  mocks.prisma.trainingCategory.findMany.mockResolvedValue([record]);
  mocks.prisma.trainingCategory.findUnique.mockResolvedValue(record);
  mocks.prisma.trainingCategory.findFirst.mockResolvedValue(null);
  mocks.prisma.trainingCategory.create.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.prisma.trainingCategory.update.mockImplementation(async ({ where, data }) => ({ ...record, id: where.id, ...data }));
  mocks.prisma.training.findMany.mockResolvedValue([{ id: 6 }]);
  mocks.prisma.$transaction.mockImplementation(async work => work(mocks.prisma));
});
it.each(calls)('%s accepts a valid session and bot token', async (_method, call) => {
  expect((await call()).status).toBeLessThan(300);
  expect((await call(true)).status).toBeLessThan(300);
});
it.each(calls)('%s rejects missing and revoked credentials', async (_method, call) => {
  mocks.session.mockResolvedValue(null);
  expect((await call()).status).toBe(401);
  mocks.prisma.botToken.findFirst.mockResolvedValue(null);
  expect((await call(true)).status).toBe(401);
});
it.each(calls.slice(1))('%s requires its mutation permission', async (_method, call) => {
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [] });
  expect((await call()).status).toBe(403);
  expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
});
it('allows member reads, emits lookahead pagination and rejects invalid query', async () => {
  mocks.prisma.user.findUnique.mockResolvedValue({ userPermissions: [] });
  mocks.prisma.trainingCategory.findMany.mockResolvedValue([record, { ...record, id: 2 }]);
  const result = await (await GET(request('GET', undefined, false, '?limit=1&cursor=0'))).json();
  expect(result.error.code).toBe('invalid_request');
  const paged = await (await GET(request('GET', undefined, false, '?limit=1&cursor=3'))).json();
  expect(paged.meta).toMatchObject({ limit: 1, nextCursor: '1' });
  expect(mocks.prisma.trainingCategory.findMany).toHaveBeenCalledWith({ where: { id: { gt: 3 } }, orderBy: { id: 'asc' }, take: 2 });
  expect(mocks.prisma.apiAuditLog.create).not.toHaveBeenCalled();
});
it.each([null, [], {}, { other: true }, { name: 4 }, { name: ' ' }, { orderIndex: -1 }, { orderIndex: '1' }, { orderIndex: 2147483648 }, { swapWithCategoryId: '2' }, { swapWithCategoryId: 0 }, { swapWithCategoryId: 2, name: 'No' }])('rejects invalid patch %j', body => {
  expect(parseTrainingCategoryBody(body, false).error?.status).toBe(422);
});
it('validates create-only fields and trims allowed fields', () => {
  expect(parseTrainingCategoryBody({ orderIndex: 0 }, true).error?.status).toBe(422);
  expect(parseTrainingCategoryBody({ name: ' Name ' }, true).data).toEqual({ name: 'Name' });
  expect(parseTrainingCategoryBody({ orderIndex: 0 }, false).data).toEqual({ orderIndex: 0 });
});
it.each(['bad', '2147483648'])('validates item id %s', async id => {
  expect((await PATCH(request('PATCH', { name: 'X' }), context(id))).status).toBe(400);
  expect((await DELETE(request('DELETE'), context(id))).status).toBe(400);
});
it('returns 404 for missing categories without mutation and rejects self-swaps', async () => {
  expect((await PATCH(request('PATCH', { swapWithCategoryId: 1 }), context())).status).toBe(422);
  mocks.prisma.trainingCategory.findUnique.mockResolvedValue(null);
  expect((await PATCH(request('PATCH', { name: 'X' }), context())).status).toBe(404);
  expect((await DELETE(request('DELETE'), context())).status).toBe(404);
  expect(mocks.prisma.trainingCategory.update).not.toHaveBeenCalled();
});
it('swaps both categories and audits both, rejects a missing swap target', async () => {
  mocks.prisma.trainingCategory.findUnique.mockResolvedValueOnce(record).mockResolvedValueOnce({ ...record, id: 2, orderIndex: 5 });
  const response = await PATCH(request('PATCH', { swapWithCategoryId: 2 }), context());
  expect(response.status).toBe(200);
  expect((await response.json()).data.updated.map((r: { orderIndex: number }) => r.orderIndex)).toEqual([5, 0]);
  expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledTimes(2);
  mocks.prisma.trainingCategory.findUnique.mockResolvedValueOnce(record).mockResolvedValueOnce(null);
  expect((await PATCH(request('PATCH', { swapWithCategoryId: 3 }), context())).status).toBe(404);
});
it('creates append order and handles exhausted order or uniqueness conflicts', async () => {
  mocks.prisma.trainingCategory.findFirst.mockResolvedValue({ ...record, orderIndex: 4 });
  expect((await (await POST(request('POST', { name: ' Next ' }))).json()).data).toMatchObject({ name: 'Next', orderIndex: 5 });
  mocks.prisma.trainingCategory.findFirst.mockResolvedValue({ ...record, orderIndex: 2147483647 });
  expect((await POST(request('POST', { name: 'Overflow' }))).status).toBe(409);
  mocks.prisma.trainingCategory.findFirst.mockResolvedValue(null);
  mocks.prisma.trainingCategory.create.mockRejectedValue({ code: 'P2002' });
  expect((await POST(request('POST', { name: 'Duplicate' }))).status).toBe(409);
});
it('detaches linked trainings and records affected IDs when deleting', async () => {
  expect((await DELETE(request('DELETE'), context())).status).toBe(200);
  expect(mocks.prisma.training.updateMany).toHaveBeenCalledWith({ where: { categoryId: 1 }, data: { categoryId: null } });
  expect(mocks.prisma.apiAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ before: { name: 'First', orderIndex: 0, trainingIds: [6] } }) }));
});
it('maps known database errors and lets the shared handler sanitize unknown errors', async () => {
  expect(categoryMutationError({ code: 'P2025' }).status).toBe(404);
  expect(() => categoryMutationError(new Error('private'))).toThrow('private');
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.prisma.trainingCategory.update.mockRejectedValue({ code: 'P2002' });
  expect((await PATCH(request('PATCH', { name: 'Duplicate' }), context())).status).toBe(409);
  mocks.prisma.trainingCategory.delete.mockRejectedValue({ code: 'P2025' });
  expect((await DELETE(request('DELETE'), context())).status).toBe(404);
  mocks.prisma.trainingCategory.create.mockRejectedValue(new Error('private'));
  expect((await POST(request('POST', { name: 'X' }))).status).toBe(500);
  spy.mockRestore();
});
