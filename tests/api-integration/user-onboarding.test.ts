import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: session.userId } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import { GET } from '@/app/api/users/onboarding/route';
let managerId: number;
let manageId: number;
let completeId: number;
let missingId: number;
let peerId: number;
let retiredId: number;
let rankedCompleteId: number;
let qualifiedTrainingId: number;
let otherTrainingId: number;
let token: string;
let tokenId: number;
const req = (query = '', bearer?: string) => new Request(`http://localhost/api/users/onboarding${query}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });
const audits = (response: Response) => prisma.apiAuditLog.findMany({ where: { correlationId: response.headers.get('X-Request-Id')! } });
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma database required.');
  manageId = (await prisma.permission.upsert({ where: { key: 'user:manage' }, create: { key: 'user:manage' }, update: {} })).id;
  managerId = (await prisma.user.create({ data: { username: 'Onboarding manager', userPermissions: { create: { permissionId: manageId, value: 10 } } } })).id;
  const user = async (username: string, peer = false) => (await prisma.user.create({ data: { username, email: 'private-onboarding@example.test', ...(peer ? { userPermissions: { create: { permissionId: manageId, value: 10 } } } : {}) } })).id;
  completeId = await user('Unranked completed'); missingId = await user('Ranked missing qualification'); peerId = await user('Hidden onboarding peer', true); retiredId = await user('Retired onboarding'); rankedCompleteId = await user('Ranked fully onboarded');
  qualifiedTrainingId = (await prisma.training.create({ data: { name: 'Onboarding qualified training', requiredForNewPeople: true, requiresOrbatQualification: true } })).id;
  otherTrainingId = (await prisma.training.create({ data: { name: 'Onboarding finished training', requiredForNewPeople: true, requiresOrbatQualification: false } })).id;
  const requiredIds = (await prisma.training.findMany({ where: { requiredForNewPeople: true }, select: { id: true } })).map(row => row.id);
  for (const userId of [managerId, completeId, rankedCompleteId]) await prisma.userTraining.createMany({ data: requiredIds.map(trainingId => ({ userId, trainingId, status: trainingId === otherTrainingId ? 'finished' : 'qualified' })) });
  await prisma.userTraining.createMany({ data: [qualifiedTrainingId, otherTrainingId].map(trainingId => ({ userId: missingId, trainingId, status: 'finished' })) });
  const rank = await prisma.rank.create({ data: { name: 'Onboarding assigned rank', abbreviation: 'ONB', orderIndex: 50000 } });
  await prisma.userRank.createMany({ data: [{ userId: missingId, currentRankId: rank.id, interviewDone: true }, { userId: rankedCompleteId, currentRankId: rank.id, interviewDone: true }, { userId: retiredId, retired: true, interviewDone: false }] });
  const main = await prisma.orbat.create({ data: { name: 'Onboarding main attendance', createdById: managerId, isMainOp: true } });
  const side = await prisma.orbat.create({ data: { name: 'Onboarding side attendance', createdById: managerId, isMainOp: false } });
  await prisma.attendance.createMany({ data: [{ userId: completeId, orbatId: main.id, status: 'late' }, { userId: completeId, orbatId: side.id, status: 'present' }] });
  await prisma.legacyUserData.create({ data: { legacyId: 'onboarding-legacy', discordUsername: 'Onboarding legacy', rankName: 'Old', tigSinceLastPromo: 0, totalTig: 0, oldData: 3, mappedUserId: completeId, isApplied: true } });
  const bot = await prisma.botToken.create({ data: { name: 'Onboarding bot', token: 'onboarding-integration-token' } });
  tokenId = bot.id; token = bot.token;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => {
  try { await prisma.training.updateMany({ where: { id: { in: [qualifiedTrainingId, otherTrainingId].filter(Boolean) } }, data: { requiredForNewPeople: false } }); }
  finally { await prisma.$disconnect(); }
});

test('onboarding applies missing-training and hierarchy filters before actual cursor paging without private fields', async () => {
  const response = await GET(req(`?cursor=${managerId}&limit=2`));
  expect(response.status).toBe(200);
  const { data, meta } = await response.json();
  expect(data.map((row: { id: number }) => row.id)).toEqual([completeId, missingId]);
  expect(data[0]).toEqual({ id: completeId, username: 'Unranked completed', userRank: null, attendanceTotal: 4, requiredTrainingsCompleted: true });
  expect(data[1]).toMatchObject({ id: missingId, requiredTrainingsCompleted: false, userRank: { interviewDone: true, retired: false } });
  expect(meta.nextCursor).toBe(String(missingId));
  expect(JSON.stringify(data)).not.toContain('@example.test');
  expect((await audits(response))[0]).toMatchObject({ targetUserIds: [completeId, missingId], before: null, after: null });
  const last = await (await GET(req(`?cursor=${meta.nextCursor}&limit=2`))).json();
  expect(last.data.map((row: { id: number }) => row.id)).toEqual([retiredId]);
  expect(last.meta.nextCursor).toBeNull();
});

test('strict flags use actual qualification-sensitive completion and exclude fully ranked trained users', async () => {
  const all = await (await GET(req(`?cursor=${managerId}&requiredTrainingsCompleted=false`))).json();
  expect(all.data.map((row: { id: number }) => row.id)).toEqual([missingId, retiredId]);
  expect((await (await GET(req(`?cursor=${managerId}&interviewDone=false&retired=false`))).json()).data.map((row: { id: number }) => row.id)).toEqual([completeId]);
  expect((await (await GET(req(`?cursor=${managerId}&retired=true`))).json()).data.map((row: { id: number }) => row.id)).toEqual([retiredId]);
  await prisma.userTraining.update({ where: { userId_trainingId: { userId: missingId, trainingId: qualifiedTrainingId } }, data: { status: 'qualified' } });
  try {
    const page = await (await GET(req(`?cursor=${managerId}&limit=100`))).json();
    expect(page.data.map((row: { id: number }) => row.id)).not.toContain(missingId);
    expect(page.data.map((row: { id: number }) => row.id)).not.toContain(rankedCompleteId);
  } finally { await prisma.userTraining.update({ where: { userId_trainingId: { userId: missingId, trainingId: qualifiedTrainingId } }, data: { status: 'finished' } }); }
});

test('self-only and empty pages have no audit while bot sees peers and audits displayed user only', async () => {
  const self = await GET(req(`?cursor=${managerId - 1}&limit=1`));
  expect((await self.json()).data[0].id).toBe(managerId);
  expect(await audits(self)).toEqual([]);
  const empty = await GET(req(`?cursor=${rankedCompleteId}`));
  expect((await empty.json()).data).toEqual([]);
  expect(await audits(empty)).toEqual([]);
  session.userId = null;
  const bot = await GET(req(`?cursor=${peerId - 1}&limit=1`, token));
  expect((await bot.json()).data[0].id).toBe(peerId);
  expect((await audits(bot))[0]).toMatchObject({ actorTokenId: tokenId, targetUserIds: [peerId] });
});

test('read audit failure withholds personal results and live permission or revoked token blocks access', async () => {
  const failure = vi.spyOn(prisma.apiAuditLog, 'create').mockRejectedValue(new Error('Audit unavailable'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await GET(req(`?cursor=${managerId}&limit=1`)); }
  finally { failure.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(JSON.stringify(await response.json())).not.toContain('Unranked completed');
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId: manageId } }, data: { value: 0 } });
  try { expect((await GET(req())).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId: manageId } }, data: { value: 10 } }); }
  await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: false } });
  try { expect((await GET(req('', token))).status).toBe(401); }
  finally { await prisma.botToken.update({ where: { id: tokenId }, data: { isActive: true } }); }
  for (const query of ['?page=1', '?interviewDone=done', '?requiredTrainingsCompleted=1', '?limit=2&limit=3']) expect((await GET(req(query))).status).toBe(400);
});
