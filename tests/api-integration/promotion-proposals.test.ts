import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { Prisma } from '@/generated/prisma/client';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/ranks/promotions/propose/route';
let managerId: number;
let adminId: number;
let permissionId: number;
let tokenId: number;
let token: string;
let sequence = 0;
const propose = (body: unknown, bearer?: string) => POST(new Request('http://localhost/api/ranks/promotions/propose', { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }));
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
async function fixture(auto = false, level?: number) {
  const index = ++sequence;
  const current = await prisma.rank.create({ data: { name: `Proposal integration current ${index}`, abbreviation: `PIC${index}`, orderIndex: 2000000 + index * 2 } });
  const next = await prisma.rank.create({ data: { name: `Proposal integration next ${index}`, abbreviation: `PIN${index}`, orderIndex: 2000001 + index * 2, autoRankupEnabled: auto, attendanceRequiredSinceLastRank: 2 } });
  const user = await prisma.user.create({ data: { username: `Proposal integration target ${index}`, ...(level ? { userPermissions: { create: { permissionId, value: level } } } : {}) } });
  await prisma.userRank.create({ data: { userId: user.id, currentRankId: current.id, interviewDone: true, retired: false, attendanceSinceLastRank: 1, lastRankedUpAt: new Date('2020-01-01T00:00:00Z') } });
  await prisma.legacyUserData.create({ data: { legacyId: `proposal-integration-${user.id}`, discordUsername: user.username!, rankName: current.name, tigSinceLastPromo: 0, totalTig: 0, oldData: 3, isApplied: true, mappedUserId: user.id } });
  return { userId: user.id, currentId: current.id, nextId: next.id };
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'rank:manage_promotions' }, create: { key: 'rank:manage_promotions' }, update: {} })).id;
  const superId = (await prisma.permission.upsert({ where: { key: 'system:super_admin' }, create: { key: 'system:super_admin' }, update: {} })).id;
  managerId = (await prisma.user.create({ data: { username: 'Proposal integration manager', userPermissions: { create: { permissionId, value: 10 } } } })).id;
  adminId = (await prisma.user.create({ data: { username: 'Proposal inbox admin', userPermissions: { create: { permissionId: superId, value: 1 } } } })).id;
  const bot = await prisma.botToken.create({ data: { name: 'Proposal integration bot', token: 'proposal-integration-token' } });
  tokenId = bot.id; token = bot.token;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('manual eligibility creates one proposal plus admin inbox and repeated requests audit only the read', async () => {
  const target = await fixture();
  const response = await propose({ userId: target.userId });
  expect(response.status).toBe(201);
  const { data } = await response.json();
  expect(data).toEqual({ userId: target.userId, outcome: 'proposed', proposalId: expect.any(Number), rankId: target.nextId });
  const proposal = await prisma.promotionProposal.findUniqueOrThrow({ where: { id: data.proposalId } });
  expect(proposal).toMatchObject({ status: 'pending', currentRankId: target.currentId, nextRankId: target.nextId, attendanceTotalAtProposal: 3, attendanceDeltaSinceLastRank: 2 });
  expect(await prisma.messageRecipient.count({ where: { userId: adminId, message: { body: { contains: `User ${target.userId} ` } } } })).toBe(1);
  expect((await audits(response))[0]).toMatchObject({ action: 'promotion_proposal.created', targetUserIds: [target.userId], after: expect.objectContaining({ createdAt: proposal.createdAt.toISOString() }) });
  const repeated = await propose({ userId: target.userId });
  expect(repeated.status).toBe(200);
  expect((await repeated.json()).data).toEqual({ ...data, outcome: 'already_pending' });
  expect(await audits(repeated)).toEqual([expect.objectContaining({ action: 'user_data.read', before: null, after: null, targetUserIds: [target.userId] })]);
  expect(await prisma.promotionProposal.count({ where: { userId: target.userId } })).toBe(1);
  expect(await prisma.rankHistory.count({ where: { userId: target.userId } })).toBe(0);
});

test('automatic lane promotes with fresh attendance closes pending proposal and persists history message outbox audits', async () => {
  const target = await fixture();
  const pending = await propose({ userId: target.userId });
  const proposalId = (await pending.json()).data.proposalId;
  await prisma.rank.update({ where: { id: target.nextId }, data: { autoRankupEnabled: true } });
  session.userId = null;
  const response = await propose({ userId: target.userId }, token);
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ userId: target.userId, outcome: 'promoted', proposalId, rankId: target.nextId });
  const state = await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } });
  expect(state).toMatchObject({ currentRankId: target.nextId, attendanceSinceLastRank: 3, interviewDone: true, retired: false });
  const history = await prisma.rankHistory.findFirstOrThrow({ where: { userId: target.userId } });
  expect(history).toMatchObject({ triggeredBy: 'auto', triggeredByUserId: null, attendanceTotalAtChange: 3, attendanceDeltaSinceLastRank: 2, outcome: 'approved' });
  expect((await prisma.promotionProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe('approved');
  expect((await prisma.botEvent.findFirstOrThrow({ where: { aggregateId: String(history.id), type: 'user.rank_changed' } })).payload).toMatchObject({ source: 'automatic', oldRankId: target.currentId, newRankId: target.nextId });
  const entries = await audits(response);
  expect(entries.map(entry => entry.action).sort()).toEqual(['promotion_proposal.approved', 'user_rank.promoted']);
  expect(entries.every(entry => entry.actorTokenId === tokenId && entry.actorUserId === null)).toBe(true);
  expect(entries.find(entry => entry.action === 'user_rank.promoted')!.after).toMatchObject({ lastRankedUpAt: state.lastRankedUpAt!.toISOString() });
  expect(await prisma.messageRecipient.count({ where: { userId: target.userId } })).toBe(1);
});

test('actual training interview retirement and attendance checks prevent ineligible proposals', async () => {
  const target = await fixture();
  const training = await prisma.training.create({ data: { name: 'Proposal eligibility training' } });
  await prisma.rankTransitionRequirement.create({ data: { targetRankId: target.nextId, requiredTrainings: { connect: { id: training.id } } } });
  const blocked = await propose({ userId: target.userId });
  expect(blocked.status).toBe(409);
  expect((await blocked.json()).error.details).toEqual({ reason: 'ineligible_training' });
  await prisma.userTraining.create({ data: { userId: target.userId, trainingId: training.id, status: 'qualified' } });
  for (const change of [{ retired: true }, { retired: false, interviewDone: false }, { interviewDone: true, attendanceSinceLastRank: 3 }]) {
    await prisma.userRank.update({ where: { userId: target.userId }, data: change });
    expect((await propose({ userId: target.userId })).status).toBe(409);
  }
  expect(await prisma.promotionProposal.count({ where: { userId: target.userId } })).toBe(0);
});

test('hierarchy live permissions invalid tokens and strict target bodies are enforced', async () => {
  const target = await fixture(false, 10);
  expect((await propose({ userId: target.userId })).status).toBe(403);
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: target.userId, permissionId } }, data: { value: 9 } });
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 0 } });
  try { expect((await propose({ userId: target.userId })).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId } }, data: { value: 10 } }); }
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  try { expect((await propose({ userId: target.userId }, token)).status).toBe(401); }
  finally { await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } }); }
  expect((await propose({ userId: target.userId }, 'invalid-proposal-token')).status).toBe(401);
  expect((await propose({ userId: 2147483647 })).status).toBe(404);
  for (const body of [{ userId: String(target.userId) }, { userId: target.userId, proposalId: 1 }, {}]) expect((await propose(body)).status).toBe(422);
  expect((await propose({ userId: target.userId })).status).toBe(201);
});

test.each(['manual-audit', 'auto-outbox', 'auto-audit'] as const)('proposal workflow rolls back all persisted state when %s fails', async stage => {
  const target = await fixture(stage !== 'manual-audit');
  const state = await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } });
  const counts = async () => Promise.all([prisma.promotionProposal.count(), prisma.rankHistory.count(), prisma.botEvent.count(), prisma.message.count(), prisma.messageRecipient.count()]);
  const before = await counts();
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const failure = vi.spyOn(stage === 'auto-outbox' ? tx.botEvent : tx.apiAuditLog, 'create').mockRejectedValue(new Error('Proposal persistence unavailable'));
    try { return await operation(tx); } finally { failure.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await propose({ userId: target.userId }); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.userRank.findUniqueOrThrow({ where: { userId: target.userId } })).toEqual(state);
  expect(await counts()).toEqual(before);
  expect(await audits(response)).toEqual([]);
});
