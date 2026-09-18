import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { PATCH } from '@/app/api/users/[id]/rank/route';
let managerId: number;
let ownerId: number;
let peerId: number;
let permissionId: number;
let lowId: number;
let highId: number;
const ctx = (id: number | 'me') => ({ params: Promise.resolve({ id: String(id) }) });
const request = (id: number | 'me', body: unknown, token?: string) => new Request(`http://localhost/api/users/${id}/rank`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const patch = (id: number | 'me', body: unknown, token?: string) => PATCH(request(id, body, token), ctx(id));
const secretReason = 'Private rank assignment justification';
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'rank:manage_promotions' }, create: { key: 'rank:manage_promotions' }, update: {} })).id;
  managerId = (await prisma.user.create({ data: { username: 'Rank mutation manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  peerId = (await prisma.user.create({ data: { username: 'Rank mutation peer', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  ownerId = (await prisma.user.create({ data: { username: 'Rank mutation owner' } })).id;
  lowId = (await prisma.rank.create({ data: { name: 'Rank mutation lower', abbreviation: 'RMLOW', orderIndex: 18000 } })).id;
  highId = (await prisma.rank.create({ data: { name: 'Rank mutation higher', abbreviation: 'RMHIGH', orderIndex: 18001 } })).id;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('rank assignment and same-rank resets preserve flags and atomically persist attendance history outbox and redacted audit', async () => {
  await prisma.userRank.create({ data: { userId: ownerId, currentRankId: lowId, retired: true, interviewDone: true, attendanceSinceLastRank: 1, lastRankedUpAt: new Date('2020-01-01T00:00:00Z') } });
  const operation = await prisma.orbat.create({ data: { name: 'Rank mutation attendance', createdById: managerId, isMainOp: true } });
  await prisma.attendance.create({ data: { userId: ownerId, orbatId: operation.id, status: 'present' } });
  await prisma.legacyUserData.create({ data: { legacyId: 'rank-mutation-old', discordUsername: 'Rank mutation legacy', rankName: 'Old rank', tigSinceLastPromo: 0, totalTig: 0, oldData: 2, isApplied: true, mappedUserId: ownerId } });
  const start = Date.now();
  const changed = await patch(ownerId, { rankId: highId, reason: ` ${secretReason} ` });
  expect(changed.status).toBe(200);
  const data = (await changed.json()).data;
  expect(data).toMatchObject({ userId: ownerId, currentRank: { id: highId }, retired: true, interviewDone: true, attendanceTotal: 3, attendanceSinceLastRank: 3, attendanceDelta: 0 });
  expect(data.lastRankedUpAt).toMatch(/Z$/);
  expect(Date.parse(data.lastRankedUpAt)).toBeGreaterThanOrEqual(start);
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId: ownerId }, orderBy: { id: 'desc' } });
  expect(history).toMatchObject({ previousRankName: 'Rank mutation lower', newRankName: 'Rank mutation higher', attendanceTotalAtChange: 3, attendanceDeltaSinceLastRank: 2, triggeredBy: 'admin', triggeredByUserId: managerId, outcome: 'approved', note: secretReason });
  const event = await prisma.botEvent.findFirstOrThrow({ where: { aggregateId: String(history.id), type: 'user.rank_changed' } });
  expect(event.payload).toMatchObject({ rankHistoryId: history.id, userId: ownerId, oldRankId: lowId, newRankId: highId, changeType: 'assignment', source: 'direct_assignment' });
  expect(JSON.stringify(event.payload)).not.toContain(secretReason);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: changed.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ action: 'user_rank.updated', resource: 'user_rank', actorUserId: managerId, targetUserIds: [ownerId], method: 'PATCH', path: `/api/users/${ownerId}/rank`, after: { rankId: highId, attendanceSinceLastRank: 3, rankHistoryId: history.id, changeType: 'assignment', reason: '[REDACTED]' } });
  expect(JSON.stringify(audit)).not.toContain(secretReason);
  const secondOperation = await prisma.orbat.create({ data: { name: 'Rank mutation later attendance', createdById: managerId, isMainOp: true } });
  await prisma.attendance.create({ data: { userId: ownerId, orbatId: secondOperation.id, status: 'late' } });
  const reset = await patch(ownerId, { rankId: highId });
  expect(reset.status).toBe(200);
  expect((await reset.json()).data).toMatchObject({ attendanceTotal: 4, attendanceSinceLastRank: 4, attendanceDelta: 0, retired: true, interviewDone: true });
  const resetHistory = await prisma.rankHistory.findFirstOrThrow({ where: { userId: ownerId }, orderBy: { id: 'desc' } });
  expect(resetHistory.id).not.toBe(history.id);
  expect(resetHistory).toMatchObject({ previousRankName: 'Rank mutation higher', newRankName: 'Rank mutation higher', attendanceDeltaSinceLastRank: 1 });
  expect((await prisma.botEvent.findFirstOrThrow({ where: { aggregateId: String(resetHistory.id), type: 'user.rank_changed' } })).payload).toMatchObject({ changeType: 'assignment' });
});

test('assigning a lower rank produces demotion history and the rank-changed outbox event', async () => {
  const changed = await patch(ownerId, { rankId: lowId, reason: 'Demotion fixture reason' });
  expect(changed.status).toBe(200);
  expect((await changed.json()).data.currentRank.id).toBe(lowId);
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId: ownerId }, orderBy: { id: 'desc' } });
  expect(history).toMatchObject({ previousRankName: 'Rank mutation higher', newRankName: 'Rank mutation lower', outcome: 'approved', note: 'Demotion fixture reason' });
  expect((await prisma.botEvent.findFirstOrThrow({ where: { aggregateId: String(history.id), type: 'user.rank_changed' } })).payload).toMatchObject({ oldRankId: highId, newRankId: lowId, changeType: 'demotion' });
});

test('rank assignment creates a missing UserRank with schema flags and null previous-rank history', async () => {
  const target = await prisma.user.create({ data: { username: 'Rank mutation new member' } });
  expect(await prisma.userRank.findUnique({ where: { userId: target.id } })).toBeNull();
  const response = await patch(target.id, { rankId: lowId, reason: null });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ userId: target.id, currentRank: { id: lowId }, retired: false, interviewDone: false, attendanceTotal: 0, attendanceSinceLastRank: 0, attendanceDelta: 0 });
  expect(await prisma.rankHistory.findFirstOrThrow({ where: { userId: target.id } })).toMatchObject({ previousRankName: null, newRankName: 'Rank mutation lower', note: null });
});

test('rank mutation requires a live global promotion grant even for self and enforces target hierarchy', async () => {
  session.userId = ownerId;
  expect((await patch('me', { rankId: highId })).status).toBe(403);
  session.userId = managerId;
  expect((await patch(peerId, { rankId: highId })).status).toBe(403);
  expect((await patch('me', { rankId: lowId })).status).toBe(200);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try { expect((await patch(ownerId, { rankId: highId })).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Rank mutation bot', token: 'rank-mutation-integration-token' } });
  session.userId = null;
  expect((await patch('me', { rankId: highId }, bot.token)).status).toBe(400);
  const botResponse = await patch(peerId, { rankId: highId }, bot.token);
  expect(botResponse.status).toBe(200);
  expect(await prisma.rankHistory.findFirstOrThrow({ where: { userId: peerId } })).toMatchObject({ triggeredBy: 'bot', triggeredByUserId: null, outcome: 'approved' });
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: botResponse.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorTokenId: bot.id, targetUserIds: [peerId] });
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = managerId;
  for (const token of [bot.token, 'invalid-rank-mutation-token']) expect((await patch(ownerId, { rankId: highId }, token)).status).toBe(401);
});

test('strict rank references and payload validation leave rank history and outbox unchanged', async () => {
  const before = await prisma.userRank.findUniqueOrThrow({ where: { userId: ownerId } });
  const historyCount = await prisma.rankHistory.count({ where: { userId: ownerId } });
  const eventCount = await prisma.botEvent.count();
  for (const body of [{}, { rankId: String(highId) }, { rankId: 0 }, { rankId: 1.5 }, { rankId: highId, reason: 4 }, { rankId: highId, userId: peerId }]) expect((await patch(ownerId, body)).status).toBe(422);
  expect((await patch(ownerId, { rankId: 2_000_000_000 })).status).toBe(404);
  expect((await patch(2_000_000_000, { rankId: highId })).status).toBe(404);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: ownerId } })).toEqual(before);
  expect(await prisma.rankHistory.count({ where: { userId: ownerId } })).toBe(historyCount);
  expect(await prisma.botEvent.count()).toBe(eventCount);
});

test.each(['history', 'outbox', 'audit'] as const)('rank mutation rolls back all database effects when %s persistence fails', async stage => {
  const before = await prisma.userRank.findUniqueOrThrow({ where: { userId: ownerId } });
  const historyCount = await prisma.rankHistory.count({ where: { userId: ownerId } });
  const eventCount = await prisma.botEvent.count();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const delegate = stage === 'history' ? tx.rankHistory : stage === 'outbox' ? tx.botEvent : tx.apiAuditLog;
    const failure = vi.spyOn(delegate, 'create').mockRejectedValue(new Error(`${stage} storage unavailable`));
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await patch(ownerId, { rankId: highId, reason: secretReason }); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: ownerId } })).toEqual(before);
  expect(await prisma.rankHistory.count({ where: { userId: ownerId } })).toBe(historyCount);
  expect(await prisma.botEvent.count()).toBe(eventCount);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});
