import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { PATCH } from '@/app/api/users/ranks/route';
let managerId: number;
let peerId: number;
let memberId: number;
let permissionId: number;
let lowId: number;
let highId: number;
let index = 0;
const request = (body: unknown, token?: string) => new Request('http://localhost/api/users/ranks', { method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const patch = (updates: unknown[], token?: string) => PATCH(request({ updates }, token));
async function user() { index += 1; return prisma.user.create({ data: { username: `Bulk rank integration member ${index}` } }); }
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'rank:manage_promotions' }, create: { key: 'rank:manage_promotions' }, update: {} })).id;
  managerId = (await prisma.user.create({ data: { username: 'Bulk rank integration manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  peerId = (await prisma.user.create({ data: { username: 'Bulk rank integration peer', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  memberId = (await user()).id;
  lowId = (await prisma.rank.create({ data: { name: 'Bulk rank integration lower', abbreviation: 'BRIL', orderIndex: 20000 } })).id;
  highId = (await prisma.rank.create({ data: { name: 'Bulk rank integration higher', abbreviation: 'BRIH', orderIndex: 20001 } })).id;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('bulk rank changes preserve flags and input order, calculate qualifying modern plus legacy attendance, and persist per-user history outbox and audits', async () => {
  const demoted = await user();
  const promoted = await user();
  const fresh = await user();
  await prisma.userRank.create({ data: { userId: demoted.id, currentRankId: highId, attendanceSinceLastRank: 1, retired: true, interviewDone: true, lastRankedUpAt: new Date('2020-01-01T00:00:00Z') } });
  await prisma.userRank.create({ data: { userId: promoted.id, currentRankId: lowId, attendanceSinceLastRank: 5 } });
  const main = await prisma.orbat.create({ data: { name: 'Bulk rank main attendance', createdById: managerId, isMainOp: true } });
  const absent = await prisma.orbat.create({ data: { name: 'Bulk rank absent attendance', createdById: managerId, isMainOp: true } });
  const side = await prisma.orbat.create({ data: { name: 'Bulk rank side attendance', createdById: managerId, isSideOp: true } });
  await prisma.attendance.createMany({ data: [{ userId: demoted.id, orbatId: main.id, status: 'present' }, { userId: demoted.id, orbatId: absent.id, status: 'absent' }, { userId: demoted.id, orbatId: side.id, status: 'present' }] });
  await prisma.legacyAttendanceData.create({ data: { legacyName: 'Bulk rank legacy attendance', legacyStatus: 'P', mappedUserId: demoted.id } });
  await prisma.legacyUserData.create({ data: { legacyId: 'bulk-rank-legacy-old', discordUsername: 'Bulk rank legacy member', rankName: 'Old', tigSinceLastPromo: 0, totalTig: 0, oldData: 3, isApplied: true, mappedUserId: demoted.id } });
  const reason = 'Private bulk demotion justification';
  const response = await patch([{ userId: fresh.id, rankId: lowId, reason: ' Fresh assignment ' }, { userId: demoted.id, rankId: lowId, reason }, { userId: promoted.id, rankId: highId }]);
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data.map((row: { userId: number }) => row.userId)).toEqual([fresh.id, demoted.id, promoted.id]);
  expect(data[0]).toMatchObject({ currentRank: { id: lowId }, retired: false, interviewDone: false, attendanceTotal: 0, attendanceSinceLastRank: 0, attendanceDelta: 0 });
  expect(data[1]).toMatchObject({ currentRank: { id: lowId }, retired: true, interviewDone: true, attendanceTotal: 5, attendanceSinceLastRank: 5, attendanceDelta: 0 });
  for (const row of data) expect(row.lastRankedUpAt).toMatch(/Z$/);
  const histories = await prisma.rankHistory.findMany({ where: { userId: { in: [fresh.id, demoted.id, promoted.id] } } });
  expect(histories).toHaveLength(3);
  expect(histories.find(row => row.userId === fresh.id)).toMatchObject({ previousRankName: null, note: 'Fresh assignment', triggeredBy: 'admin', triggeredByUserId: managerId });
  expect(histories.find(row => row.userId === demoted.id)).toMatchObject({ previousRankName: 'Bulk rank integration higher', newRankName: 'Bulk rank integration lower', attendanceTotalAtChange: 5, attendanceDeltaSinceLastRank: 4, note: reason, outcome: 'approved' });
  expect(histories.find(row => row.userId === promoted.id)).toMatchObject({ attendanceDeltaSinceLastRank: 0 });
  for (const history of histories) {
    const event = await prisma.botEvent.findFirstOrThrow({ where: { type: 'user.rank_changed', aggregateId: String(history.id) } });
    expect(event.payload).toMatchObject({ rankHistoryId: history.id, userId: history.userId, source: 'bulk_assignment', changeType: history.userId === demoted.id ? 'demotion' : 'assignment' });
    expect(JSON.stringify(event.payload)).not.toContain(reason);
  }
  const audits = await prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
  expect(audits).toHaveLength(3);
  for (const audit of audits) expect(audit).toMatchObject({ action: 'user_rank.updated', actorUserId: managerId, method: 'PATCH', path: '/api/users/ranks', after: { reason: '[REDACTED]' } });
  expect(JSON.stringify(audits)).not.toContain(reason);
  const reset = await patch([{ userId: demoted.id, rankId: lowId }]);
  expect(reset.status).toBe(200);
  expect((await reset.json()).data[0]).toMatchObject({ attendanceSinceLastRank: 5, attendanceDelta: 0 });
  expect(await prisma.rankHistory.count({ where: { userId: demoted.id } })).toBe(2);
});

test('bulk preflight checks every user, rank and hierarchy before altering the first target', async () => {
  const target = await user();
  const before = await prisma.userRank.create({ data: { userId: target.id, currentRankId: lowId, interviewDone: true } });
  const other = await user();
  for (const [second, expected] of [
    [{ userId: 2_000_000_000, rankId: highId }, 404],
    [{ userId: other.id, rankId: 2_000_000_000 }, 404],
    [{ userId: peerId, rankId: highId }, 403],
  ] as const) {
    const response = await patch([{ userId: target.id, rankId: highId }, second]);
    expect(response.status).toBe(expected);
    expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: target.id } })).toEqual(before);
    expect(await prisma.userRank.findUnique({ where: { userId: other.id } })).toBeNull();
    expect(await prisma.rankHistory.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')!, action: 'user_rank.updated' } })).toBe(0);
  }
});

test('bulk payload validates numeric identifiers, unique users, reasons and batch size', async () => {
  for (const updates of [[], [{ userId: String(memberId), rankId: lowId }], [{ userId: memberId, rankId: String(lowId) }], [{ userId: memberId, rankId: 0 }], [{ userId: memberId, rankId: lowId, reason: false }], [{ userId: memberId, rankId: lowId }, { userId: memberId, rankId: highId }], Array.from({ length: 101 }, (_, i) => ({ userId: i + 1, rankId: lowId }))]) expect((await patch(updates)).status).toBe(422);
  expect((await PATCH(request({ updates: [{ userId: memberId, rankId: lowId }], other: true }))).status).toBe(422);
  expect(await prisma.userRank.findUnique({ where: { userId: memberId } })).toBeNull();
});

test('bulk ranks require live global grants even for self and accept active bots without revoked credential fallback', async () => {
  session.userId = memberId;
  expect((await patch([{ userId: memberId, rankId: lowId }])).status).toBe(403);
  session.userId = managerId;
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try { expect((await patch([{ userId: memberId, rankId: lowId }])).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Bulk rank integration bot', token: 'bulk-rank-integration-token' } });
  session.userId = null;
  expect((await patch([{ userId: memberId, rankId: lowId }])).status).toBe(401);
  const response = await patch([{ userId: peerId, rankId: lowId }], bot.token);
  expect(response.status).toBe(200);
  expect(await prisma.rankHistory.findFirstOrThrow({ where: { userId: peerId } })).toMatchObject({ triggeredBy: 'bot', triggeredByUserId: null });
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorTokenId: bot.id });
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = managerId;
  for (const token of [bot.token, 'bulk-rank-invalid-token']) expect((await patch([{ userId: memberId, rankId: lowId }], token)).status).toBe(401);
});

test.each(['history', 'outbox', 'audit'] as const)('a second %s failure rolls back the whole bulk rank batch including earlier persisted effects', async stage => {
  const first = await user();
  const second = await user();
  const before = await prisma.userRank.create({ data: { userId: first.id, currentRankId: lowId, interviewDone: true, attendanceSinceLastRank: 8 } });
  const eventCount = await prisma.botEvent.count();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const delegate = stage === 'history' ? tx.rankHistory : stage === 'outbox' ? tx.botEvent : tx.apiAuditLog;
    const create = delegate.create.bind(delegate) as (args: unknown) => unknown;
    let count = 0;
    const failure = vi.spyOn(delegate, 'create').mockImplementation(((args: unknown) => {
      count += 1;
      if (count === 2) throw new Error(`Second ${stage} write unavailable`);
      return create(args);
    }) as unknown as typeof delegate.create);
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await patch([{ userId: first.id, rankId: highId }, { userId: second.id, rankId: highId }]); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: first.id } })).toEqual(before);
  expect(await prisma.userRank.findUnique({ where: { userId: second.id } })).toBeNull();
  expect(await prisma.rankHistory.count({ where: { userId: { in: [first.id, second.id] } } })).toBe(0);
  expect(await prisma.botEvent.count()).toBe(eventCount);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});

test('a maximum-size rank batch persists all 100 summaries histories outbox events and audits', async () => {
  const users = await prisma.user.createManyAndReturn({ data: Array.from({ length: 100 }, (_, i) => ({ username: `Bulk rank maximum fixture ${i}` })), select: { id: true } });
  const updates = users.map(user => ({ userId: user.id, rankId: lowId }));
  const response = await patch(updates);
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data.map((row: { userId: number }) => row.userId)).toEqual(users.map(user => user.id));
  expect(data.every((row: { currentRank: { id: number }; attendanceDelta: number }) => row.currentRank.id === lowId && row.attendanceDelta === 0)).toBe(true);
  const histories = await prisma.rankHistory.findMany({ where: { userId: { in: users.map(user => user.id) } }, select: { id: true } });
  expect(histories).toHaveLength(100);
  expect(await prisma.botEvent.count({ where: { type: 'user.rank_changed', aggregateId: { in: histories.map(row => String(row.id)) } } })).toBe(100);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')!, action: 'user_rank.updated' } })).toBe(100);
});
