import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { GET, PATCH } from '@/app/api/trainings/[id]/requirements/route';
let editorId: number;
let adminId: number;
let memberId: number;
let editPermissionId: number;
let fixtureIndex = 0;
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (id: number, method = 'GET', body?: unknown, token?: string) => new Request(`http://localhost/api/trainings/${id}/requirements`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const patch = (id: number, body: unknown, token?: string) => PATCH(request(id, 'PATCH', body, token), context(id));
async function training() { fixtureIndex += 1; return prisma.training.create({ data: { name: `Requirements integration training ${fixtureIndex}` } }); }
async function rank() { fixtureIndex += 1; return prisma.rank.create({ data: { name: `Requirements integration rank ${fixtureIndex}`, abbreviation: `REQI${fixtureIndex}`, orderIndex: 9000 + fixtureIndex } }); }
async function stored(trainingId: number) {
  const minimum = await prisma.trainingRankRequirement.findUnique({ where: { trainingId } });
  const required = await prisma.trainingTrainingRequirement.findMany({ where: { trainingId }, orderBy: { requiredTrainingId: 'asc' } });
  return { minimumRankId: minimum?.minimumRankId ?? null, requiredTrainingIds: required.map(row => row.requiredTrainingId) };
}
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const edit = await prisma.permission.upsert({ where: { key: 'training:edit' }, create: { key: 'training:edit' }, update: {} });
  const admin = await prisma.permission.upsert({ where: { key: 'system:super_admin' }, create: { key: 'system:super_admin' }, update: {} });
  editPermissionId = edit.id;
  editorId = (await prisma.user.create({ data: { username: 'Training requirements editor', userPermissions: { create: { permissionId: edit.id, value: 1 } } } })).id;
  adminId = (await prisma.user.create({ data: { username: 'Training requirements admin', userPermissions: { create: { permissionId: admin.id, value: 1 } } } })).id;
  memberId = (await prisma.user.create({ data: { username: 'Training requirements member' } })).id;
});
beforeEach(() => { session.userId = editorId; });
afterAll(async () => { await prisma.$disconnect(); });

test('requirements persist rank and prerequisite sets, serialize UTC rank dates, and preserve omitted fields', async () => {
  const target = await training();
  const first = await training();
  const second = await training();
  const third = await training();
  const minimum = await rank();
  const replacement = await rank();
  const category = await prisma.trainingCategory.create({ data: { name: 'Requirements integration category' } });
  await prisma.training.update({ where: { id: first.id }, data: { categoryId: category.id } });
  const initial = await GET(request(target.id), context(target.id));
  expect((await initial.json()).data).toMatchObject({ minimumRankId: null, requiredTrainingIds: [], minimumRank: null, requiredTrainings: [] });
  expect(await prisma.apiAuditLog.count({ where: { correlationId: initial.headers.get('X-Request-Id')! } })).toBe(0);
  const changed = await patch(target.id, { minimumRankId: minimum.id, requiredTrainingIds: [second.id, first.id] });
  expect(changed.status).toBe(200);
  const data = (await changed.json()).data;
  expect(data).toMatchObject({ minimumRankId: minimum.id, requiredTrainingIds: [first.id, second.id], minimumRank: { id: minimum.id } });
  expect(data.minimumRank.createdAt).toMatch(/Z$/);
  expect(data.requiredTrainings).toEqual([{ id: first.id, name: first.name, category: { name: category.name } }, { id: second.id, name: second.name, category: null }]);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: changed.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ actorUserId: editorId, action: 'training_requirements.updated', method: 'PATCH', path: `/api/trainings/${target.id}/requirements`, before: { minimumRankId: null, requiredTrainingIds: [] }, after: { minimumRankId: minimum.id, requiredTrainingIds: [first.id, second.id] } });
  expect(JSON.stringify(audit)).not.toContain(first.name);
  expect(JSON.stringify(audit)).not.toContain(minimum.name);
  expect((await patch(target.id, { minimumRankId: replacement.id })).status).toBe(200);
  expect(await stored(target.id)).toEqual({ minimumRankId: replacement.id, requiredTrainingIds: [first.id, second.id] });
  expect((await patch(target.id, { requiredTrainingIds: [third.id] })).status).toBe(200);
  expect(await stored(target.id)).toEqual({ minimumRankId: replacement.id, requiredTrainingIds: [third.id] });
  expect((await patch(target.id, { requiredTrainingIds: [] })).status).toBe(200);
  expect(await stored(target.id)).toEqual({ minimumRankId: replacement.id, requiredTrainingIds: [] });
});

test('clearing the minimum rank requires superadmin even when no requirement exists', async () => {
  const target = await training();
  expect((await patch(target.id, { minimumRankId: null })).status).toBe(403);
  const minimum = await rank();
  expect((await patch(target.id, { minimumRankId: minimum.id })).status).toBe(200);
  expect((await patch(target.id, { minimumRankId: null })).status).toBe(403);
  expect(await stored(target.id)).toEqual({ minimumRankId: minimum.id, requiredTrainingIds: [] });
  session.userId = adminId;
  expect((await patch(target.id, { minimumRankId: null })).status).toBe(200);
  expect(await stored(target.id)).toEqual({ minimumRankId: null, requiredTrainingIds: [] });
});

test('missing references and invalid request fields do not partially alter either requirement set', async () => {
  const target = await training();
  const required = await training();
  const minimum = await rank();
  const replacement = await rank();
  expect((await patch(target.id, { minimumRankId: minimum.id, requiredTrainingIds: [required.id] })).status).toBe(200);
  const before = await stored(target.id);
  expect((await patch(target.id, { minimumRankId: replacement.id, requiredTrainingIds: [2_000_000_000] })).status).toBe(404);
  expect((await patch(target.id, { minimumRankId: 2_000_000_000, requiredTrainingIds: [] })).status).toBe(404);
  for (const body of [{}, { minimumRankId: String(minimum.id) }, { minimumRankId: 0 }, { requiredTrainingIds: [required.id, required.id] }, { requiredTrainingIds: [String(required.id)] }, { requiredTrainingIds: [target.id] }, { extra: true }]) {
    expect((await patch(target.id, body)).status).toBe(422);
  }
  expect(await stored(target.id)).toEqual(before);
  expect((await GET(request(2_000_000_000), context(2_000_000_000))).status).toBe(404);
  expect((await patch(2_000_000_000, { requiredTrainingIds: [] })).status).toBe(404);
});

test('prerequisite graph rejects direct and longer cycles but allows an edge after its reverse path is removed', async () => {
  const a = await training();
  const b = await training();
  const c = await training();
  const d = await training();
  const minimum = await rank();
  expect((await patch(a.id, { requiredTrainingIds: [b.id] })).status).toBe(200);
  expect((await patch(b.id, { requiredTrainingIds: [a.id] })).status).toBe(409);
  expect((await stored(b.id)).requiredTrainingIds).toEqual([]);
  expect((await patch(b.id, { requiredTrainingIds: [c.id] })).status).toBe(200);
  expect((await patch(c.id, { minimumRankId: minimum.id, requiredTrainingIds: [a.id] })).status).toBe(409);
  expect(await stored(c.id)).toEqual({ minimumRankId: null, requiredTrainingIds: [] });
  expect((await patch(d.id, { requiredTrainingIds: [b.id, c.id] })).status).toBe(200);
  expect((await patch(a.id, { requiredTrainingIds: [] })).status).toBe(200);
  expect((await patch(c.id, { requiredTrainingIds: [a.id] })).status).toBe(200);
  expect((await stored(c.id)).requiredTrainingIds).toEqual([a.id]);
  expect((await stored(b.id)).requiredTrainingIds).toEqual([c.id]);
  expect((await stored(d.id)).requiredTrainingIds).toEqual([b.id, c.id]);
});

test('requirements use live mutation grants and permit valid bots while rejecting invalid or revoked bearer fallback', async () => {
  const target = await training();
  session.userId = memberId;
  expect((await GET(request(target.id), context(target.id))).status).toBe(200);
  expect((await patch(target.id, { requiredTrainingIds: [] })).status).toBe(403);
  session.userId = editorId;
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: editorId, permissionId: editPermissionId } }, data: { value: 0 } });
  try { expect((await patch(target.id, { requiredTrainingIds: [] })).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: editorId, permissionId: editPermissionId } }, data: { value: 1 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Training requirements bot', token: 'training-requirements-integration-token' } });
  session.userId = null;
  expect((await GET(request(target.id), context(target.id))).status).toBe(401);
  const botRead = await GET(request(target.id, 'GET', undefined, bot.token), context(target.id));
  expect(botRead.status).toBe(200);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: botRead.headers.get('X-Request-Id')! } })).toBe(0);
  const botPatch = await patch(target.id, { minimumRankId: null, requiredTrainingIds: [] }, bot.token);
  expect(botPatch.status).toBe(200);
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: botPatch.headers.get('X-Request-Id')! } })).toMatchObject({ actorType: 'bot', actorTokenId: bot.id });
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = adminId;
  for (const token of [bot.token, 'invalid-training-requirements-token']) {
    expect((await GET(request(target.id, 'GET', undefined, token), context(target.id))).status).toBe(401);
    expect((await patch(target.id, { requiredTrainingIds: [] }, token)).status).toBe(401);
  }
});

test('an audit outage rolls back both the actual rank requirement update and prerequisite replacement', async () => {
  const target = await training();
  const originalRequired = await training();
  const newRequired = await training();
  const originalRank = await rank();
  const newRank = await rank();
  expect((await patch(target.id, { minimumRankId: originalRank.id, requiredTrainingIds: [originalRequired.id] })).status).toBe(200);
  const originalRankRow = await prisma.trainingRankRequirement.findUniqueOrThrow({ where: { trainingId: target.id } });
  const originalEdges = await prisma.trainingTrainingRequirement.findMany({ where: { trainingId: target.id } });
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => transact(async tx => {
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  }, options)) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await patch(target.id, { minimumRankId: newRank.id, requiredTrainingIds: [newRequired.id] }); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.trainingRankRequirement.findUniqueOrThrow({ where: { trainingId: target.id } })).toEqual(originalRankRow);
  expect(await prisma.trainingTrainingRequirement.findMany({ where: { trainingId: target.id } })).toEqual(originalEdges);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});
