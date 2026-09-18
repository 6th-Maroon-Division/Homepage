import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET, POST } from '@/app/api/ranks/promotions/automatic/route';
let managerId: number;
let permissionId: number;
let token: string;
let tokenId: number;
let sequence = 0;
const req = (method = 'GET', query = '', bearer?: string, body: unknown = {}) => new Request(`http://localhost/api/ranks/promotions/automatic${query}`, { method, headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
async function fixture(level?: number, attendance = 3) {
  const index = ++sequence;
  const low = await prisma.rank.create({ data: { name: `Automatic current ${index}`, abbreviation: `AC${index}`, orderIndex: 3000000 + index * 2 } });
  const high = await prisma.rank.create({ data: { name: `Automatic next ${index}`, abbreviation: `AN${index}`, orderIndex: 3000001 + index * 2, autoRankupEnabled: true, attendanceRequiredSinceLastRank: 2 } });
  const user = await prisma.user.create({ data: { username: `Automatic target ${index}`, email: `private-auto-${index}@example.test`, ...(level ? { userPermissions: { create: { permissionId, value: level } } } : {}) } });
  await prisma.userRank.create({ data: { userId: user.id, currentRankId: low.id, interviewDone: true, retired: false, attendanceSinceLastRank: 1, lastRankedUpAt: new Date('2020-01-01T00:00:00Z') } });
  await prisma.legacyUserData.create({ data: { legacyId: `automatic-${user.id}`, discordUsername: user.username!, rankName: low.name, tigSinceLastPromo: 0, totalTig: 0, oldData: attendance, mappedUserId: user.id, isApplied: true } });
  return { userId: user.id, currentId: low.id, nextId: high.id };
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'rank:manage_promotions' }, create: { key: 'rank:manage_promotions' }, update: {} })).id;
  managerId = (await prisma.user.create({ data: { username: 'Automatic promotion manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  const bot = await prisma.botToken.create({ data: { name: 'Automatic promotion bot', token: 'automatic-promotions-integration-token' } });
  tokenId = bot.id; token = bot.token;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('automatic execution promotes eligible manageable users with atomic messages outbox audits and skips equal peers', async () => {
  const target = await fixture();
  const peer = await fixture(10);
  const short = await fixture(undefined, 1);
  const pending = await prisma.promotionProposal.create({ data: { userId: target.userId, currentRankId: target.currentId, nextRankId: target.nextId, attendanceTotalAtProposal: 1, attendanceDeltaSinceLastRank: 0, status: 'pending' } });
  const response = await POST(req('POST'));
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(Object.keys(data).sort()).toEqual(['promotedCount', 'errorsCount', 'ineligibleCount'].sort());
  expect(data.promotedCount).toBeGreaterThanOrEqual(1);
  expect(data.ineligibleCount).toBeGreaterThanOrEqual(1);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } }))).toMatchObject({ currentRankId: target.nextId, attendanceSinceLastRank: 3, interviewDone: true });
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: peer.userId } })).currentRankId).toBe(peer.currentId);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: short.userId } })).currentRankId).toBe(short.currentId);
  expect((await prisma.promotionProposal.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('approved');
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId: target.userId } });
  expect(history).toMatchObject({ attendanceTotalAtChange: 3, attendanceDeltaSinceLastRank: 2, triggeredBy: 'auto', triggeredByUserId: managerId });
  expect((await prisma.botEvent.findFirstOrThrow({ where: { aggregateId: String(history.id), type: 'user.rank_changed' } })).payload).toMatchObject({ source: 'automatic', newRankId: target.nextId });
  const entries = (await audits(response)).filter(entry => entry.targetUserIds.includes(target.userId));
  expect(entries.map(entry => entry.action).sort()).toEqual(['promotion_proposal.approved', 'user_rank.promoted']);
  expect(await prisma.messageRecipient.count({ where: { userId: target.userId } })).toBe(1);
  session.userId = null;
  const botResponse = await POST(req('POST', '', token));
  expect(botResponse.status).toBe(200);
  expect((await prisma.userRank.findUniqueOrThrow({ where: { userId: peer.userId } })).currentRankId).toBe(peer.nextId);
  expect((await audits(botResponse)).find(entry => entry.targetUserIds.includes(peer.userId))).toMatchObject({ actorType: 'bot', actorTokenId: tokenId, actorUserId: null });
}, 120000);

test('automatic history visibility precedes paging and excludes private records snapshots and lookahead audit IDs', async () => {
  const visible = await fixture();
  const hidden = await fixture(10);
  await prisma.authAccount.create({ data: { userId: visible.userId, provider: 'discord', providerUserId: '123456789012345678' } });
  const history = async (userId: number, createdAt = new Date()) => prisma.rankHistory.create({ data: { userId, previousRankName: 'Before', newRankName: 'After', attendanceTotalAtChange: 3, attendanceDeltaSinceLastRank: 2, triggeredBy: 'auto', outcome: 'approved', note: 'Private automatic note', declineReason: 'Private automatic reason', createdAt } });
  const oldest = await history(visible.userId);
  await history(hidden.userId);
  const self = await history(managerId);
  await history(hidden.userId);
  const newest = await history(visible.userId);
  const response = await GET(req('GET', `?limit=2&cursor=${newest.id + 1}`));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.map((row: { id: number }) => row.id)).toEqual([newest.id, self.id]);
  expect(body.meta.nextCursor).toBe(String(self.id));
  expect(body.data[0].user).toEqual({ id: visible.userId, username: `Automatic target ${sequence - 1}`, discordId: '123456789012345678' });
  expect(body.data[0].createdAt).toBe(newest.createdAt.toISOString());
  expect(Object.keys(body.data[0]).sort()).toEqual(['id', 'userId', 'previousRankName', 'newRankName', 'createdAt', 'triggeredBy', 'outcome', 'user'].sort());
  expect(JSON.stringify(body)).not.toContain('Private automatic');
  expect(JSON.stringify(body)).not.toContain('@example.test');
  expect(await audits(response)).toEqual([expect.objectContaining({ targetUserIds: [visible.userId], before: null, after: null })]);
  const next = await GET(req('GET', `?limit=1&cursor=${self.id}`));
  expect((await next.json()).data[0].id).toBe(oldest.id);
  const old = await history(visible.userId, new Date('2000-01-01T00:00:00Z'));
  const recent = await (await GET(req('GET', `?limit=1&cursor=${old.id + 1}&days=1`))).json();
  expect(recent.data[0].id).toBe(newest.id);
});

test('history self-only pages produce no read audit and required audit failure withholds personal data', async () => {
  const target = await fixture();
  const history = await prisma.rankHistory.create({ data: { userId: managerId, previousRankName: 'Before', newRankName: 'After', attendanceTotalAtChange: 0, attendanceDeltaSinceLastRank: 0, triggeredBy: 'auto', outcome: 'approved' } });
  const self = await GET(req('GET', `?limit=1&cursor=${history.id + 1}`));
  expect(await audits(self)).toEqual([]);
  const other = await prisma.rankHistory.create({ data: { userId: target.userId, previousRankName: 'Before', newRankName: 'Private next rank', attendanceTotalAtChange: 0, attendanceDeltaSinceLastRank: 0, triggeredBy: 'auto', outcome: 'approved' } });
  const failure = vi.spyOn(prisma.apiAuditLog, 'create').mockRejectedValue(new Error('Audit unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await GET(req('GET', `?limit=1&cursor=${other.id + 1}`)); }
  finally { failure.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('Private next rank');
});

test('live global permissions revoked tokens and strict inputs apply to both methods', async () => {
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try { expect((await GET(req())).status).toBe(403); expect((await POST(req('POST'))).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  try { for (const bearer of [token, 'invalid-automatic-token']) { expect((await GET(req('GET', '', bearer))).status).toBe(401); expect((await POST(req('POST', '', bearer))).status).toBe(401); } }
  finally { await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } }); }
  for (const query of ['?days=0', '?days=3651', '?page=1', '?cursor=2147483648', '?limit=1&limit=2']) expect((await GET(req('GET', query))).status).toBe(400);
  expect((await POST(req('POST', '', undefined, { userId: managerId }))).status).toBe(422);
});

test('automatic audit failure rolls back that user and counts the error without leaking identity', async () => {
  const target = await fixture();
  const before = await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } });
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const failure = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit unavailable'));
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await POST(req('POST')); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(200);
  const { data } = await response.json();
  expect(data.errorsCount).toBeGreaterThanOrEqual(1);
  expect(data.promotedCount).toBe(0);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } })).toEqual(before);
  expect(await prisma.rankHistory.count({ where: { userId: target.userId } })).toBe(0);
  expect(await prisma.messageRecipient.count({ where: { userId: target.userId } })).toBe(0);
  expect(await audits(response)).toEqual([]);
}, 120000);
