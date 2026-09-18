import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { POST as approve } from '@/app/api/ranks/promotions/[id]/approve/route';
import { POST as decline } from '@/app/api/ranks/promotions/[id]/decline/route';
let managerId: number;
let permissionId: number;
let lowId: number;
let highId: number;
let botId: number;
let botToken: string;
let counter = 0;
const date = new Date('2020-01-01T00:00:00Z');
const decide = (decision: 'approve' | 'decline', id: number | string, body: unknown = {}, token?: string) => (decision === 'approve' ? approve : decline)(new Request(`http://localhost/api/ranks/promotions/${id}/${decision}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: String(id) }) });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
async function fixture(level?: number) {
  const user = await prisma.user.create({ data: { username: `Promotion decision target ${++counter}`, ...(level ? { userPermissions: { create: { permissionId, value: level } } } : {}) } });
  await prisma.userRank.create({ data: { userId: user.id, currentRankId: lowId, attendanceSinceLastRank: 1, lastRankedUpAt: date, interviewDone: true, retired: false } });
  const proposal = await prisma.promotionProposal.create({ data: { userId: user.id, currentRankId: lowId, nextRankId: highId, attendanceTotalAtProposal: 1, attendanceDeltaSinceLastRank: 0, status: 'pending' } });
  await prisma.legacyUserData.create({ data: { legacyId: `promotion-decision-${user.id}`, discordUsername: user.username!, rankName: 'Before', tigSinceLastPromo: 0, totalTig: 0, oldData: 3, mappedUserId: user.id, isApplied: true } });
  return { userId: user.id, proposalId: proposal.id };
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'rank:manage_promotions' }, create: { key: 'rank:manage_promotions' }, update: {} })).id;
  managerId = (await prisma.user.create({ data: { username: 'Promotion decision manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  lowId = (await prisma.rank.create({ data: { name: 'Promotion decision low', abbreviation: 'PDL', orderIndex: 20000 } })).id;
  highId = (await prisma.rank.create({ data: { name: 'Promotion decision high', abbreviation: 'PDH', orderIndex: 20001 } })).id;
  const bot = await prisma.botToken.create({ data: { name: 'Promotion decision bot', token: 'promotion-decision-integration-token' } });
  botId = bot.id; botToken = bot.token;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('approval persists current attendance baseline history message outbox and UTC audit once', async () => {
  const target = await fixture();
  const operation = await prisma.orbat.create({ data: { name: 'Promotion decision attendance', createdById: managerId, isMainOp: true } });
  await prisma.attendance.create({ data: { userId: target.userId, orbatId: operation.id, status: 'late' } });
  const response = await decide('approve', target.proposalId);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: null, meta: {} });
  const rank = await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } });
  expect(rank).toMatchObject({ currentRankId: highId, attendanceSinceLastRank: 4, interviewDone: true, retired: false });
  expect(rank.lastRankedUpAt!.getTime()).toBeGreaterThan(date.getTime());
  expect(await prisma.promotionProposal.findUniqueOrThrow({ where: { id: target.proposalId } })).toMatchObject({ status: 'approved', attendanceTotalAtProposal: 4, attendanceDeltaSinceLastRank: 3 });
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId: target.userId } });
  expect(history).toMatchObject({ outcome: 'approved', attendanceTotalAtChange: 4, attendanceDeltaSinceLastRank: 3, previousRankName: 'Promotion decision low', newRankName: 'Promotion decision high', triggeredBy: 'admin_manual', triggeredByUserId: managerId });
  expect((await prisma.botEvent.findFirstOrThrow({ where: { type: 'user.rank_changed', aggregateId: String(history.id) } })).payload).toMatchObject({ oldRankId: lowId, newRankId: highId, source: 'manual_approval' });
  expect(await prisma.messageRecipient.count({ where: { userId: target.userId, message: { type: 'rankup' } } })).toBe(1);
  const [audit] = await audits(response);
  expect(audit).toMatchObject({ action: 'promotion_proposal.approved', targetUserIds: [target.userId], actorUserId: managerId, path: `/api/ranks/promotions/${target.proposalId}/approve` });
  expect(audit.after).toMatchObject({ lastRankedUpAt: rank.lastRankedUpAt!.toISOString(), rankHistoryId: history.id });
  expect((await decide('approve', target.proposalId)).status).toBe(409);
  expect((await decide('decline', target.proposalId)).status).toBe(409);
  expect(await prisma.rankHistory.count({ where: { userId: target.userId } })).toBe(1);
});

test('bot decline matches user semantics resets only baseline and redacts private reason in audit', async () => {
  const target = await fixture();
  session.userId = null;
  const response = await decide('decline', target.proposalId, { declineReason: '  Private decline explanation  ' }, botToken);
  expect(response.status).toBe(200);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } })).toMatchObject({ currentRankId: lowId, lastRankedUpAt: date, attendanceSinceLastRank: 3 });
  expect(await prisma.promotionProposal.findUniqueOrThrow({ where: { id: target.proposalId } })).toMatchObject({ status: 'declined', attendanceTotalAtProposal: 3, attendanceDeltaSinceLastRank: 2 });
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId: target.userId } });
  expect(history).toMatchObject({ outcome: 'declined', declineReason: 'Private decline explanation', triggeredBy: 'bot', triggeredByUserId: null });
  expect(await prisma.botEvent.count({ where: { type: 'user.rank_changed', aggregateId: String(history.id) } })).toBe(0);
  const [audit] = await audits(response);
  expect(audit).toMatchObject({ actorType: 'bot', actorTokenId: botId, actorUserId: null, action: 'promotion_proposal.declined', after: expect.objectContaining({ declineReason: '[REDACTED]' }) });
  expect(JSON.stringify(audit)).not.toContain('Private decline explanation');
});

test('live hierarchy and revoked grants block both decisions while bots retain superadmin access', async () => {
  const target = await fixture(10);
  for (const decision of ['approve', 'decline'] as const) expect((await decide(decision, target.proposalId)).status).toBe(403);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: target.userId, permissionId } }, data: { value: 9 } });
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try { expect((await decide('approve', target.proposalId)).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
  expect((await decide('approve', target.proposalId, {}, botToken)).status).toBe(200);
  expect((await prisma.rankHistory.findFirstOrThrow({ where: { userId: target.userId } })).triggeredByUserId).toBeNull();
});

test('invalid and revoked bearer credentials never fall back to session and malformed data never mutates', async () => {
  const target = await fixture();
  await prisma.botToken.update({ where: { id: botId }, data: { isActive: false } });
  try { for (const decision of ['approve', 'decline'] as const) {
    expect((await decide(decision, target.proposalId, {}, botToken)).status).toBe(401);
    expect((await decide(decision, target.proposalId, {}, 'invalid-promotion-token')).status).toBe(401);
  } } finally { await prisma.botToken.update({ where: { id: botId }, data: { isActive: true } }); }
  expect((await decide('approve', 'bad')).status).toBe(400);
  expect((await decide('approve', target.proposalId, { discordActorId: 'spoofed' })).status).toBe(422);
  expect((await decide('decline', target.proposalId, { reason: 'old payload' })).status).toBe(422);
  expect((await decide('decline', target.proposalId, { declineReason: 123 })).status).toBe(422);
  expect(await prisma.rankHistory.count({ where: { userId: target.userId } })).toBe(0);
});

test('stale current ranks and missing proposals reject without resetting user state', async () => {
  const target = await fixture();
  await prisma.userRank.update({ where: { userId: target.userId }, data: { currentRankId: highId } });
  for (const decision of ['approve', 'decline'] as const) {
    expect((await decide(decision, target.proposalId)).status).toBe(409);
    expect((await decide(decision, 2147483647)).status).toBe(404);
  }
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } })).toMatchObject({ currentRankId: highId, attendanceSinceLastRank: 1 });
});

test.each(['history', 'outbox', 'message', 'audit'] as const)('decision rolls back rank proposal history outbox and messages when %s write fails', async stage => {
  const target = await fixture();
  const beforeRank = await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } });
  const beforeProposal = await prisma.promotionProposal.findUniqueOrThrow({ where: { id: target.proposalId } });
  const beforeEvents = await prisma.botEvent.count();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const delegate = stage === 'history' ? tx.rankHistory : stage === 'outbox' ? tx.botEvent : stage === 'message' ? tx.message : tx.apiAuditLog;
    const failure = vi.spyOn(delegate, 'create').mockRejectedValue(new Error(`${stage} unavailable`));
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await decide('approve', target.proposalId); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } })).toEqual(beforeRank);
  expect(await prisma.promotionProposal.findUniqueOrThrow({ where: { id: target.proposalId } })).toEqual(beforeProposal);
  expect(await prisma.rankHistory.count({ where: { userId: target.userId } })).toBe(0);
  expect(await prisma.botEvent.count()).toBe(beforeEvents);
  expect(await prisma.messageRecipient.count({ where: { userId: target.userId } })).toBe(0);
  expect(await audits(response)).toEqual([]);
});
