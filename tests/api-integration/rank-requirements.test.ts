import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { checkRankupEligibility } from '@/lib/rank-eligibility';
import { GET, PATCH } from '@/app/api/ranks/[id]/requirements/route';
let editorId: number;
let memberId: number;
let permissionId: number;
let index = 0;
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (id: number | string, method = 'GET', body?: unknown, token?: string) => new Request(`http://localhost/api/ranks/${id}/requirements`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const patch = (id: number, requiredTrainingIds: number[], token?: string) => PATCH(request(id, 'PATCH', { requiredTrainingIds }, token), ctx(id));
async function rank() { index += 1; return prisma.rank.create({ data: { name: `Rank requirements integration ${index}`, abbreviation: `RREQI${index}`, orderIndex: 12000 + index } }); }
async function training() { index += 1; return prisma.training.create({ data: { name: `Rank requirements training ${index}` } }); }
async function stored(targetRankId: number) {
  const row = await prisma.rankTransitionRequirement.findUnique({ where: { targetRankId }, include: { requiredTrainings: { orderBy: { id: 'asc' } } } });
  return row?.requiredTrainings.map(item => item.id) ?? [];
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  permissionId = (await prisma.permission.upsert({ where: { key: 'rank:edit' }, create: { key: 'rank:edit' }, update: {} })).id;
  editorId = (await prisma.user.create({ data: { username: 'Rank requirements editor', userPermissions: { create: { permissionId, value: 1 } } } })).id;
  memberId = (await prisma.user.create({ data: { username: 'Rank requirements member' } })).id;
});
beforeEach(() => { session.userId = editorId; });
afterAll(async () => { await prisma.$disconnect(); });

test('reading a rank without requirements returns an empty DTO without creating a row or audit', async () => {
  const target = await rank();
  expect(await prisma.rankTransitionRequirement.findUnique({ where: { targetRankId: target.id } })).toBeNull();
  const response = await GET(request(target.id), ctx(target.id));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ requiredTrainingIds: [], requiredTrainings: [] });
  expect(await prisma.rankTransitionRequirement.findUnique({ where: { targetRankId: target.id } })).toBeNull();
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
  expect((await GET(request(2_000_000_000), ctx(2_000_000_000))).status).toBe(404);
});

test('rank requirements replace the complete sorted set, expose category DTOs, and preserve rank and training rows', async () => {
  const target = await rank();
  const first = await training();
  const second = await training();
  const third = await training();
  const category = await prisma.trainingCategory.create({ data: { name: 'Rank requirements integration category' } });
  const firstWithCategory = await prisma.training.update({ where: { id: first.id }, data: { categoryId: category.id } });
  const changed = await patch(target.id, [second.id, first.id]);
  expect(changed.status).toBe(200);
  expect((await changed.json()).data).toEqual({ requiredTrainingIds: [first.id, second.id], requiredTrainings: [{ id: first.id, name: first.name, category: { name: category.name } }, { id: second.id, name: second.name, category: null }] });
  expect(await stored(target.id)).toEqual([first.id, second.id]);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: changed.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ actorUserId: editorId, action: 'rank_requirements.updated', resourceId: String(target.id), method: 'PATCH', path: `/api/ranks/${target.id}/requirements`, before: { requiredTrainingIds: [] }, after: { requiredTrainingIds: [first.id, second.id] } });
  expect(JSON.stringify(audit)).not.toContain(first.name);
  expect(JSON.stringify(audit)).not.toContain(category.name);
  expect((await patch(target.id, [third.id, second.id, first.id])).status).toBe(200);
  expect(await stored(target.id)).toEqual([first.id, second.id, third.id]);
  expect((await patch(target.id, [second.id])).status).toBe(200);
  expect(await stored(target.id)).toEqual([second.id]);
  expect((await patch(target.id, [])).status).toBe(200);
  expect(await stored(target.id)).toEqual([]);
  expect(await prisma.rank.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
  expect(await prisma.training.findUniqueOrThrow({ where: { id: first.id } })).toEqual(firstWithCategory);
  expect(await prisma.training.findUniqueOrThrow({ where: { id: second.id } })).toEqual(second);
  expect(await prisma.training.findUniqueOrThrow({ where: { id: third.id } })).toEqual(third);
});

test('missing references and malformed IDs fail without replacing any stored requirement', async () => {
  const target = await rank();
  const first = await training();
  const replacement = await training();
  expect((await patch(target.id, [first.id])).status).toBe(200);
  const missing = await patch(target.id, [replacement.id, 2_000_000_000]);
  expect(missing.status).toBe(404);
  expect(await stored(target.id)).toEqual([first.id]);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: missing.headers.get('X-Request-Id')! } })).toBe(0);
  for (const body of [{}, { requiredTrainingIds: [first.id, first.id] }, { requiredTrainingIds: [String(first.id)] }, { requiredTrainingIds: [0] }, { requiredTrainingIds: [1.5] }, { requiredTrainingIds: [2147483648] }, { requiredTrainingIds: null }, { requiredTrainingIds: [], unexpected: true }]) {
    expect((await PATCH(request(target.id, 'PATCH', body), ctx(target.id))).status).toBe(422);
  }
  for (const id of ['bad', '0', '2147483648']) {
    expect((await GET(request(id), ctx(id))).status).toBe(400);
    expect((await PATCH(request(id, 'PATCH', { requiredTrainingIds: [] }), ctx(id))).status).toBe(400);
  }
  expect((await patch(2_000_000_000, [])).status).toBe(404);
  expect(await stored(target.id)).toEqual([first.id]);
});

test('both rank requirement methods enforce live grants and valid bot authentication without bearer fallback', async () => {
  const target = await rank();
  session.userId = memberId;
  expect((await GET(request(target.id), ctx(target.id))).status).toBe(403);
  expect((await patch(target.id, [])).status).toBe(403);
  session.userId = editorId;
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: editorId, permissionId } }, data: { value: 0 } });
  try {
    expect((await GET(request(target.id), ctx(target.id))).status).toBe(403);
    expect((await patch(target.id, [])).status).toBe(403);
  } finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: editorId, permissionId } }, data: { value: 1 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Rank requirements bot', token: 'rank-requirements-integration-token' } });
  session.userId = null;
  expect((await GET(request(target.id), ctx(target.id))).status).toBe(401);
  const botRead = await GET(request(target.id, 'GET', undefined, bot.token), ctx(target.id));
  expect(botRead.status).toBe(200);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: botRead.headers.get('X-Request-Id')! } })).toBe(0);
  const changed = await patch(target.id, [], bot.token);
  expect(changed.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: changed.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorTokenId: bot.id });
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = editorId;
  for (const token of [bot.token, 'rank-requirements-invalid-token']) {
    expect((await GET(request(target.id, 'GET', undefined, token), ctx(target.id))).status).toBe(401);
    expect((await patch(target.id, [], token)).status).toBe(401);
  }
});

test('rank requirement replacement rolls back its real join set when transactional audit persistence fails', async () => {
  const target = await rank();
  const original = await training();
  const replacement = await training();
  expect((await patch(target.id, [original.id])).status).toBe(200);
  const before = await prisma.rankTransitionRequirement.findUniqueOrThrow({ where: { targetRankId: target.id }, include: { requiredTrainings: true } });
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await patch(target.id, [replacement.id]); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  const result = await response.json();
  expect(result.error.code).toBe('internal_error');
  expect(result.data).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain(original.name);
  expect(await prisma.rankTransitionRequirement.findUniqueOrThrow({ where: { targetRankId: target.id }, include: { requiredTrainings: true } })).toEqual(before);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});

test('promotion eligibility reads the canonical replacement set without changes to the internal promotion reader', async () => {
  const current = await prisma.rank.create({ data: { name: 'Rank requirements eligibility current', abbreviation: 'RREQEC', orderIndex: 1_500_000_000 } });
  const next = await prisma.rank.create({ data: { name: 'Rank requirements eligibility next', abbreviation: 'RREQEN', orderIndex: 1_500_000_001, attendanceRequiredSinceLastRank: 0, autoRankupEnabled: true } });
  const user = await prisma.user.create({ data: { username: 'Rank requirements promotion candidate' } });
  await prisma.userRank.create({ data: { userId: user.id, currentRankId: current.id, interviewDone: true, retired: false, attendanceSinceLastRank: 0 } });
  const required = await training();
  expect((await patch(next.id, [required.id])).status).toBe(200);
  const blocked = await checkRankupEligibility(user.id);
  expect(blocked).toMatchObject({ eligible: false, reason: 'ineligible_training', currentRank: { id: current.id }, nextRank: { id: next.id }, missingTrainingIds: [required.id] });
  const qualification = await prisma.userTraining.create({ data: { userId: user.id, trainingId: required.id, status: 'qualified' } });
  expect(await checkRankupEligibility(user.id)).toMatchObject({ eligible: true, reason: 'eligible_auto', currentRank: { id: current.id }, nextRank: { id: next.id } });
  expect((await patch(next.id, [])).status).toBe(200);
  await prisma.userTraining.delete({ where: { id: qualification.id } });
  expect(await checkRankupEligibility(user.id)).toMatchObject({ eligible: true, reason: 'eligible_auto', currentRank: { id: current.id }, nextRank: { id: next.id } });
});
