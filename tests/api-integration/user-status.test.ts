import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { PATCH as SINGLE } from '@/app/api/users/[id]/status/route';
import { PATCH as BULK } from '@/app/api/users/status/route';
let managerId: number;
let ownerId: number;
let peerId: number;
let permissionId: number;
let rankId: number;
let counter = 0;
const context = (id: number | 'me') => ({ params: Promise.resolve({ id: String(id) }) });
const request = (path: string, body: unknown, token?: string) => new Request(`http://localhost/api/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const single = (id: number | 'me', body: unknown, token?: string) => SINGLE(request(`users/${id}/status`, body, token), context(id));
const bulk = (updates: unknown[], token?: string) => BULK(request('users/status', { updates }, token));
async function user() { counter += 1; return prisma.user.create({ data: { username: `User status fixture ${counter}` } }); }
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'user:manage' }, create: { key: 'user:manage' }, update: {} })).id;
  managerId = (await prisma.user.create({ data: { username: 'User status manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  peerId = (await prisma.user.create({ data: { username: 'User status peer', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  ownerId = (await user()).id;
  rankId = (await prisma.rank.create({ data: { name: 'User status preservation rank', abbreviation: 'USPR', orderIndex: 19000 } })).id;
  await prisma.userRank.create({ data: { userId: ownerId, currentRankId: rankId, attendanceSinceLastRank: 17, lastRankedUpAt: new Date('2026-04-01T12:00:00Z'), interviewDone: true, retired: false } });
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('single status updates set explicit flags repeatedly without resetting rank or attendance state or emitting rank history/outbox', async () => {
  const historyCount = await prisma.rankHistory.count();
  const eventCount = await prisma.botEvent.count();
  const response = await single(ownerId, { retired: true });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ userId: ownerId, interviewDone: true, retired: true });
  expect((await single(ownerId, { retired: true })).status).toBe(200);
  expect((await single(ownerId, { interviewDone: false })).status).toBe(200);
  const stored = await prisma.userRank.findUniqueOrThrow({ where: { userId: ownerId } });
  expect(stored).toMatchObject({ currentRankId: rankId, attendanceSinceLastRank: 17, lastRankedUpAt: new Date('2026-04-01T12:00:00Z'), retired: true, interviewDone: false });
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ actorType: 'user', actorUserId: managerId, action: 'user_status.updated', targetUserIds: [ownerId], method: 'PATCH', path: `/api/users/${ownerId}/status`, before: { interviewDone: true, retired: false }, after: { interviewDone: true, retired: true } });
  expect(await prisma.rankHistory.count()).toBe(historyCount);
  expect(await prisma.botEvent.count()).toBe(eventCount);
});

test('missing status rows use database defaults while returning only the status DTO', async () => {
  const target = await user();
  expect(await prisma.userRank.findUnique({ where: { userId: target.id } })).toBeNull();
  const response = await single(target.id, { interviewDone: true });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ userId: target.id, interviewDone: true, retired: false });
  const row = await prisma.userRank.findUniqueOrThrow({ where: { userId: target.id } });
  expect(row).toMatchObject({ currentRankId: null, attendanceSinceLastRank: 0, interviewDone: true, retired: false });
  expect(row.lastRankedUpAt).toBeInstanceOf(Date);
});

test('bulk status updates preserve input order and omitted flags with one audit per target', async () => {
  const first = await user();
  const second = await user();
  await prisma.userRank.create({ data: { userId: first.id, currentRankId: rankId, attendanceSinceLastRank: 7, lastRankedUpAt: new Date('2026-03-01T00:00:00Z'), interviewDone: true } });
  const response = await bulk([{ userId: second.id, retired: true }, { userId: first.id, retired: true }]);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual([{ userId: second.id, retired: true, interviewDone: false }, { userId: first.id, retired: true, interviewDone: true }]);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: first.id } })).toMatchObject({ currentRankId: rankId, attendanceSinceLastRank: 7, lastRankedUpAt: new Date('2026-03-01T00:00:00Z'), interviewDone: true });
  const audit = await prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
  expect(audit).toHaveLength(2);
  expect(audit.map(row => row.targetUserIds[0]).sort((a, b) => a - b)).toEqual([first.id, second.id]);
  for (const row of audit) expect(row).toMatchObject({ action: 'user_status.updated', path: '/api/users/status', actorUserId: managerId });
});

test('single and bulk access require a live global grant even for self and enforce equal-target hierarchy', async () => {
  session.userId = ownerId;
  expect((await single('me', { retired: false })).status).toBe(403);
  expect((await bulk([{ userId: ownerId, retired: false }])).status).toBe(403);
  session.userId = managerId;
  expect((await single('me', { interviewDone: true })).status).toBe(200);
  expect((await single(peerId, { retired: true })).status).toBe(403);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try {
    expect((await single(ownerId, { retired: false })).status).toBe(403);
    expect((await bulk([{ userId: ownerId, retired: false }])).status).toBe(403);
  } finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'User status integration bot', token: 'user-status-integration-token' } });
  session.userId = null;
  expect((await single('me', { retired: true }, bot.token)).status).toBe(400);
  const response = await single(peerId, { interviewDone: true }, bot.token);
  expect(response.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [peerId] });
  expect((await bulk([{ userId: peerId, retired: true }], bot.token)).status).toBe(200);
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = managerId;
  for (const token of [bot.token, 'invalid-user-status-token']) {
    expect((await single(ownerId, { retired: false }, token)).status).toBe(401);
    expect((await bulk([{ userId: ownerId, retired: false }], token)).status).toBe(401);
  }
});

test('strict fields and malformed bulk entries fail without creating or altering status', async () => {
  const target = await user();
  for (const body of [{}, { interviewDone: 'true' }, { retired: null }, { currentRankId: rankId }, { retired: true, userId: ownerId }]) expect((await single(target.id, body)).status).toBe(422);
  for (const updates of [[], [{ userId: target.id }], [{ userId: String(target.id), retired: true }], [{ userId: target.id, retired: true }, { userId: target.id, interviewDone: true }], [{ userId: target.id, retired: 'false' }], Array.from({ length: 101 }, (_, i) => ({ userId: i + 1, retired: true }))]) expect((await bulk(updates)).status).toBe(422);
  expect((await single(2_000_000_000, { retired: true })).status).toBe(404);
  expect(await prisma.userRank.findUnique({ where: { userId: target.id } })).toBeNull();
});

test('bulk preflight of every target prevents partial writes for missing or forbidden later users', async () => {
  const target = await user();
  for (const [otherUserId, status] of [[2_000_000_000, 404], [peerId, 403]]) {
    const response = await bulk([{ userId: target.id, retired: true }, { userId: otherUserId, retired: true }]);
    expect(response.status).toBe(status);
    expect(await prisma.userRank.findUnique({ where: { userId: target.id } })).toBeNull();
    expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')!, action: 'user_status.updated' } })).toBe(0);
  }
});

test('a second bulk audit failure rolls back the first new status row, existing flags, and the first persisted audit', async () => {
  const first = await user();
  const second = await user();
  const before = await prisma.userRank.create({ data: { userId: second.id, currentRankId: rankId, interviewDone: true, attendanceSinceLastRank: 11 } });
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const write = tx.apiAuditLog.create.bind(tx.apiAuditLog);
    let count = 0;
    const failure = vi.spyOn(tx.apiAuditLog, 'create').mockImplementation(((args: Prisma.ApiAuditLogCreateArgs) => {
      count += 1;
      if (count === 2) throw new Error('Second audit write unavailable');
      return write(args);
    }) as unknown as typeof tx.apiAuditLog.create);
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await bulk([{ userId: first.id, retired: true }, { userId: second.id, interviewDone: false }]); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.userRank.findUnique({ where: { userId: first.id } })).toBeNull();
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: second.id } })).toEqual(before);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});

test('a maximum-size bulk status request updates all 100 users within the normal transaction configuration', async () => {
  const users = await prisma.user.createManyAndReturn({ data: Array.from({ length: 100 }, (_, index) => ({ username: `User status maximum batch ${index}` })), select: { id: true } });
  const updates = users.map(user => ({ userId: user.id, interviewDone: true, retired: true }));
  const response = await bulk(updates);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual(updates);
  expect(await prisma.userRank.count({ where: { userId: { in: users.map(user => user.id) }, interviewDone: true, retired: true } })).toBe(100);
  const audits = await prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')!, action: 'user_status.updated' } });
  expect(audits).toHaveLength(100);
  expect(audits.map(audit => audit.targetUserIds[0]).sort((a, b) => a - b)).toEqual(users.map(user => user.id).sort((a, b) => a - b));
});
