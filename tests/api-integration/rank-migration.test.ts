import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { POST as preview } from '@/app/api/ranks/migrate/preview/route';
import { POST as apply } from '@/app/api/ranks/migrate/apply/route';
let managerId: number;
let permissionId: number;
let lowId: number;
let highId: number;
let token: string;
let tokenId: number;
let sequence = 0;
const request = (kind: 'preview' | 'apply', body: unknown, bearer?: string) => new Request(`http://localhost/api/ranks/migrate/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) });
const mapping = (oldRankId = lowId, newRankId = highId) => ({ strategy: 'map', rankMappings: [{ oldRankId, newRankId }] });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
async function fixture(currentRankId = lowId, level?: number) {
  const user = await prisma.user.create({ data: { username: `Migration target ${++sequence}`, ...(level ? { userPermissions: { create: { permissionId, value: level } } } : {}) } });
  await prisma.userRank.create({ data: { userId: user.id, currentRankId, attendanceSinceLastRank: 1, interviewDone: true, retired: true, lastRankedUpAt: new Date('2020-01-01T00:00:00Z') } });
  await prisma.legacyUserData.create({ data: { legacyId: `migration-${user.id}`, discordUsername: user.username!, rankName: 'Before', tigSinceLastPromo: 0, totalTig: 0, oldData: 6, isApplied: true, mappedUserId: user.id } });
  return user.id;
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'rank:edit' }, create: { key: 'rank:edit' }, update: {} })).id;
  managerId = (await prisma.user.create({ data: { username: 'Migration manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  lowId = (await prisma.rank.create({ data: { name: 'Migration lowest fixture', abbreviation: 'ML', orderIndex: 2147483645 } })).id;
  highId = (await prisma.rank.create({ data: { name: 'Migration highest fixture', abbreviation: 'MH', orderIndex: 2147483646, attendanceRequiredSinceLastRank: 5 } })).id;
  const bot = await prisma.botToken.create({ data: { name: 'Migration integration bot', token: 'migration-integration-token' } });
  tokenId = bot.id; token = bot.token;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('preview uses actual attendance for recalculation and audits only returned manageable users without snapshots', async () => {
  const userId = await fixture();
  const peerId = await fixture(lowId, 10);
  const response = await preview(request('preview', { strategy: 'recalculate' }));
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.changes.find((row: { userId: number }) => row.userId === userId)).toMatchObject({ attendanceTotal: 6, currentRankName: 'Migration lowest fixture', newRankName: 'Migration highest fixture', changeType: 'promotion' });
  expect(data.changes.some((row: { userId: number }) => row.userId === peerId)).toBe(false);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId } })).currentRankId).toBe(lowId);
  const [audit] = await audits(response);
  expect(audit).toMatchObject({ action: 'user_data.read', resource: 'rank_migration', before: null, after: null });
  expect(audit.targetUserIds).toContain(userId);
  expect(audit.targetUserIds).not.toContain(peerId);
}, 120000);

test('mapping apply is atomic preserves flags records actual attendance and emits audited bot outbox', async () => {
  const userId = await fixture();
  const response = await apply(request('apply', mapping()));
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.promoted).toBeGreaterThanOrEqual(1);
  expect(data).not.toHaveProperty('errors');
  const state = await prisma.userRank.findUniqueOrThrow({ where: { userId } });
  expect(state).toMatchObject({ currentRankId: highId, attendanceSinceLastRank: 6, interviewDone: true, retired: true });
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId } });
  expect(history).toMatchObject({ attendanceTotalAtChange: 6, attendanceDeltaSinceLastRank: 5, triggeredBy: 'system_migration', triggeredByUserId: managerId, outcome: 'approved' });
  expect((await prisma.botEvent.findFirstOrThrow({ where: { aggregateId: String(history.id), type: 'user.rank_changed' } })).payload).toMatchObject({ source: 'migration', oldRankId: lowId, newRankId: highId, changeType: 'promotion' });
  expect((await audits(response)).find(entry => entry.targetUserIds.includes(userId))).toMatchObject({ action: 'user_rank.migrated', after: expect.objectContaining({ attendanceSinceLastRank: 6, lastRankedUpAt: state.lastRankedUpAt!.toISOString() }) });
  const unchanged = await apply(request('apply', { strategy: 'grandfather' }));
  expect(unchanged.status).toBe(200);
  expect(await audits(unchanged)).toEqual([]);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId } })).toEqual(state);
}, 120000);

test('bot mappings can demote peers while assigning token audit identity and no spoofed human history actor', async () => {
  const userId = await fixture(highId, 10);
  session.userId = null;
  const response = await apply(request('apply', mapping(highId, lowId), token));
  expect(response.status).toBe(200);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId } })).currentRankId).toBe(lowId);
  expect((await prisma.rankHistory.findFirstOrThrow({ where: { userId } })).triggeredByUserId).toBeNull();
  expect((await audits(response)).find(entry => entry.targetUserIds.includes(userId))).toMatchObject({ actorType: 'bot', actorTokenId: tokenId, actorUserId: null });
}, 120000);

test('invalid mappings missing refs and revoked credentials fail before mutation', async () => {
  const before = await prisma.rankHistory.count();
  for (const body of [{ strategy: 'invalid' }, { strategy: 'map', rankMappings: [] }, { strategy: 'map', rankMappings: [{ oldRankId: lowId, newRankId: highId }, { oldRankId: lowId, newRankId: highId }] }]) {
    expect((await apply(request('apply', body))).status).toBe(422);
    expect((await preview(request('preview', body))).status).toBe(422);
  }
  expect((await apply(request('apply', mapping(lowId, 2147483647)))).status).toBe(404);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try { expect((await apply(request('apply', mapping()))).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  try { expect((await apply(request('apply', mapping(), token))).status).toBe(401); expect((await preview(request('preview', mapping(), token))).status).toBe(401); }
  finally { await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } }); }
  expect(await prisma.rankHistory.count()).toBe(before);
});

test('second user audit failure rolls back the entire migration including earlier user history and outbox', async () => {
  const rank = await prisma.rank.create({ data: { name: 'Migration rollback source', abbreviation: 'MRS', orderIndex: 45000 } });
  const users = [await fixture(rank.id), await fixture(rank.id)];
  const beforeStates = await prisma.userRank.findMany({ where: { userId: { in: users } }, orderBy: { userId: 'asc' } });
  const beforeEvents = await prisma.botEvent.count();
  const transact = prisma.$transaction.bind(prisma);
  let completedAudits = 0;
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const create = tx.apiAuditLog.create.bind(tx.apiAuditLog);
    const failure = vi.spyOn(tx.apiAuditLog, 'create').mockImplementation(((args: Parameters<typeof create>[0]) => {
      if (++completedAudits === 2) throw new Error('Second migration audit unavailable');
      return create(args);
    }) as unknown as typeof tx.apiAuditLog.create);
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await apply(request('apply', mapping(rank.id, highId))); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(completedAudits).toBe(2);
  expect(await prisma.userRank.findMany({ where: { userId: { in: users } }, orderBy: { userId: 'asc' } })).toEqual(beforeStates);
  expect(await prisma.rankHistory.count({ where: { userId: { in: users } } })).toBe(0);
  expect(await prisma.botEvent.count()).toBe(beforeEvents);
  expect(await audits(response)).toEqual([]);
}, 120000);
