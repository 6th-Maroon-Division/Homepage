import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ id: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.id === null ? null : { user: { id: session.id } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET, PATCH, DELETE } from '@/app/api/users/[id]/route';
let actor: number; let target: number; let peer: number;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const req = (method = 'GET', body?: unknown, bot = false) => new Request('http://localhost/api/users/me', { method, headers: bot ? { authorization: 'Bearer profile-integration' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeAll(async () => {
  const permission = await prisma.permission.upsert({ where: { key: 'user:manage' }, update: {}, create: { key: 'user:manage' } });
  actor = (await prisma.user.create({ data: { username: 'Profile actor', userPermissions: { create: { permissionId: permission.id, value: 10 } } } })).id;
  peer = (await prisma.user.create({ data: { username: 'Profile peer', userPermissions: { create: { permissionId: permission.id, value: 10 } } } })).id;
  target = (await prisma.user.create({ data: { username: 'Profile target', email: 'profile@example.test', accounts: { create: { provider: 'steam', providerUserId: '989898989123456' } } } })).id;
  await prisma.botToken.create({ data: { name: 'Profile integration', token: 'profile-integration' } });
});
afterAll(async () => { await prisma.$disconnect(); });
test('self reads are private DTOs without audits while privileged other reads audit IDs only', async () => {
  session.id = target;
  const own = await GET(req(), ctx('me')); const data = (await own.json()).data;
  expect(data).toMatchObject({ id: target, providers: ['steam'] }); expect(data.accounts).toBeUndefined(); expect(data.createdAt).toMatch(/Z$/);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: own.headers.get('X-Request-Id')! } })).toBe(0);
  session.id = actor;
  expect((await GET(req(), ctx(peer))).status).toBe(403);
  const other = await GET(req(), ctx(target));
  expect((await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: other.headers.get('X-Request-Id')! } }))).toMatchObject({ targetUserIds: [target], before: null, after: null });
});
test('self updates and bot updates commit normalized values and redacted audits', async () => {
  session.id = target;
  expect((await PATCH(req('PATCH', { username: ' Profile edited ' }), ctx('me'))).status).toBe(200);
  const bot = await PATCH(req('PATCH', { email: null, avatarUrl: '/uploads/avatars/profile.png' }, true), ctx(target));
  expect(bot.status).toBe(200);
  expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toMatchObject({ username: 'Profile edited', email: null, avatarUrl: '/uploads/avatars/profile.png' });
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: bot.headers.get('X-Request-Id')! } });
  expect(audit.actorType).toBe('bot'); expect(audit.after).toMatchObject({ email: '[REDACTED]', avatarUrl: '[REDACTED]' });
});
test('audit failures roll back both profile update and deletion', async () => {
  session.id = actor;
  const before = await prisma.user.findUniqueOrThrow({ where: { id: target } });
  const transact = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const failure = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('audit unavailable'));
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await PATCH(req('PATCH', { username: 'Must roll back' }), ctx(target))).status).toBe(500);
    expect((await DELETE(req('DELETE'), ctx(target))).status).toBe(500);
  } finally { spy.mockRestore(); log.mockRestore(); }
  expect(await prisma.user.findUniqueOrThrow({ where: { id: target } })).toEqual(before);
  expect(await prisma.authAccount.count({ where: { userId: target } })).toBe(1);
});
test('deletion rejects self and preserves users with durable ORBAT references; bot may delete unreferenced accounts', async () => {
  session.id = actor;
  expect((await DELETE(req('DELETE'), ctx('me'))).status).toBe(403);
  const operation = await prisma.orbat.create({ data: { name: 'Profile deletion guard', createdById: target } });
  expect((await DELETE(req('DELETE'), ctx(target))).status).toBe(409);
  await prisma.orbat.delete({ where: { id: operation.id } });
  expect((await DELETE(req('DELETE', undefined, true), ctx(target))).status).toBe(200);
  expect(await prisma.user.findUnique({ where: { id: target } })).toBeNull();
  expect(await prisma.authAccount.count({ where: { userId: target } })).toBe(0);
});
