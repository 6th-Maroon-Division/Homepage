import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
const session = vi.hoisted(() => ({ userId: null as number | null }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.userId === null ? null : { user: { id: String(session.userId) } } }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { GET as LIST, POST } from '@/app/api/trainings/route';
import { GET, PATCH, DELETE } from '@/app/api/trainings/[id]/route';
let managerId: number;
let memberId: number;
let editPermissionId: number;
let index = 0;
const context = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const request = (path = 'trainings', method = 'GET', body?: unknown, token?: string) => new Request(`http://localhost/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const detail = (id: number, method = 'GET', body?: unknown, token?: string) => request(`trainings/${id}`, method, body, token);
function name() { index += 1; return `Training catalog integration ${index}`; }
async function fixture() { return prisma.training.create({ data: { name: name() } }); }
beforeAll(async () => {
  if (!process.env.API_INTEGRATION_DATABASE_URL || process.env.DATABASE_URL !== process.env.API_INTEGRATION_DATABASE_URL) throw new Error('Isolated Prisma integration database required.');
  const permissions = await Promise.all(['training:create', 'training:edit', 'training:delete'].map(key => prisma.permission.upsert({ where: { key }, create: { key }, update: {} })));
  editPermissionId = permissions.find(permission => permission.key === 'training:edit')!.id;
  managerId = (await prisma.user.create({ data: { username: 'Training catalog manager', userPermissions: { create: permissions.map(permission => ({ permissionId: permission.id, value: 1 })) } } })).id;
  memberId = (await prisma.user.create({ data: { username: 'Training catalog member', email: 'training-catalog-private@example.test' } })).id;
});
beforeEach(() => { session.userId = managerId; });
afterAll(async () => { await prisma.$disconnect(); });

test('training create uses schema defaults and strict partial updates preserve or clear nullable fields', async () => {
  const created = await POST(request('trainings', 'POST', { name: ` ${name()} ` }));
  expect(created.status).toBe(201);
  const { data } = await created.json();
  expect(data).toMatchObject({ description: null, duration: null, categoryId: null, isActive: true, requiresTrainingSession: true, requiresOrbatQualification: false, requiredForNewPeople: false, orbatQualificationNotes: null, counts: { userTrainings: 0, trainingRequests: 0 } });
  expect(data.name).toBe(data.name.trim());
  expect(data.createdAt).toMatch(/Z$/);
  expect(data.updatedAt).toMatch(/Z$/);
  const category = await prisma.trainingCategory.create({ data: { name: 'Training catalog update category' } });
  const changed = await PATCH(detail(data.id, 'PATCH', { description: ' Description ', duration: 90, categoryId: category.id, requiresTrainingSession: false, requiresOrbatQualification: true, orbatQualificationNotes: ' Qualification notes ' }), context(data.id));
  expect(changed.status).toBe(200);
  const updated = (await changed.json()).data;
  expect(updated).toMatchObject({ description: 'Description', duration: 90, categoryId: category.id, requiresTrainingSession: false, requiresOrbatQualification: true, orbatQualificationNotes: 'Qualification notes', counts: { userTrainings: 0, trainingRequests: 0 } });
  const renamed = await PATCH(detail(data.id, 'PATCH', { name: name() }), context(data.id));
  expect((await renamed.json()).data).toMatchObject({ duration: 90, categoryId: category.id, description: 'Description', requiresTrainingSession: false, requiresOrbatQualification: true });
  const cleared = await PATCH(detail(data.id, 'PATCH', { description: null, duration: null, categoryId: null, orbatQualificationNotes: null }), context(data.id));
  expect(cleared.status).toBe(200);
  expect((await cleared.json()).data).toMatchObject({ description: null, duration: null, categoryId: null, orbatQualificationNotes: null });
  expect(await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: changed.headers.get('X-Request-Id')! } })).toMatchObject({ action: 'training.updated', resource: 'training', method: 'PATCH', path: `/api/trainings/${data.id}` });
});

test('training DTO counts stay consistent across list detail and patch without returning personal relation records or read audits', async () => {
  const target = await fixture();
  await prisma.userTraining.create({ data: { userId: memberId, trainingId: target.id, notes: 'Private qualification notes' } });
  await prisma.trainingRequest.create({ data: { userId: memberId, trainingId: target.id, requestMessage: 'Private request message' } });
  session.userId = memberId;
  const read = await GET(detail(target.id), context(target.id));
  expect(read.status).toBe(200);
  const data = (await read.json()).data;
  expect(data.counts).toEqual({ userTrainings: 1, trainingRequests: 1 });
  expect(data.userTrainings).toBeUndefined();
  expect(data.trainingRequests).toBeUndefined();
  expect(data._count).toBeUndefined();
  expect(JSON.stringify(data)).not.toContain('Private');
  expect(JSON.stringify(data)).not.toContain('training-catalog-private');
  expect(await prisma.apiAuditLog.count({ where: { correlationId: read.headers.get('X-Request-Id')! } })).toBe(0);
  const list = await LIST(request(`trainings?cursor=${target.id - 1}&limit=1`));
  expect((await list.json()).data[0]).toEqual(data);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: list.headers.get('X-Request-Id')! } })).toBe(0);
  session.userId = managerId;
  expect((await (await PATCH(detail(target.id, 'PATCH', { isActive: false }), context(target.id))).json()).data.counts).toEqual(data.counts);
});

test('training category and active filters run before ascending-id pagination', async () => {
  const category = await prisma.trainingCategory.create({ data: { name: 'Training catalog page category' } });
  const first = await prisma.training.create({ data: { name: name(), categoryId: category.id } });
  const second = await prisma.training.create({ data: { name: name(), categoryId: category.id, isActive: false } });
  await fixture();
  const page = await (await LIST(request(`trainings?categoryId=${category.id}&activeOnly=false&limit=1`))).json();
  expect(page.data.map((row: { id: number }) => row.id)).toEqual([first.id]);
  expect(page.meta.nextCursor).toBe(String(first.id));
  const next = await (await LIST(request(`trainings?categoryId=${category.id}&activeOnly=false&limit=1&cursor=${first.id}`))).json();
  expect(next.data.map((row: { id: number }) => row.id)).toEqual([second.id]);
  expect(next.meta.nextCursor).toBeNull();
  const active = await (await LIST(request(`trainings?categoryId=${category.id}&activeOnly=true`))).json();
  expect(active.data.map((row: { id: number }) => row.id)).toEqual([first.id]);
  expect((await LIST(request('trainings?activeOnly=yes'))).status).toBe(400);
  expect((await LIST(request('trainings?categoryId=0'))).status).toBe(400);
});

test('duration and readonly fields validate strictly, category references must exist, and duplicate names remain allowed', async () => {
  const target = await fixture();
  for (const duration of ['30', 0, -1, 1441, 1.5]) {
    expect((await POST(request('trainings', 'POST', { name: name(), duration }))).status).toBe(422);
    expect((await PATCH(detail(target.id, 'PATCH', { duration }), context(target.id))).status).toBe(422);
  }
  expect((await PATCH(detail(target.id, 'PATCH', { requiredForNewPeople: true }), context(target.id))).status).toBe(422);
  expect((await POST(request('trainings', 'POST', { name: name(), categoryId: 2_000_000_000 }))).status).toBe(404);
  expect((await PATCH(detail(target.id, 'PATCH', { name: 'Must not persist', categoryId: 2_000_000_000 }), context(target.id))).status).toBe(404);
  expect(await prisma.training.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
  expect((await POST(request('trainings', 'POST', { name: target.name }))).status).toBe(201);
  expect((await GET(detail(2_000_000_000), context(2_000_000_000))).status).toBe(404);
});

test('scheduled or historical sessions and training requests independently block training deletion', async () => {
  const withSession = await fixture();
  const sessionRow = await prisma.trainingSession.create({ data: { trainingId: withSession.id, status: 'completed' } });
  expect((await DELETE(detail(withSession.id, 'DELETE'), context(withSession.id))).status).toBe(409);
  expect(await prisma.trainingSession.findUnique({ where: { id: sessionRow.id } })).not.toBeNull();
  expect(await prisma.training.findUnique({ where: { id: withSession.id } })).not.toBeNull();
  const withRequest = await fixture();
  const requestRow = await prisma.trainingRequest.create({ data: { trainingId: withRequest.id, userId: memberId } });
  expect((await DELETE(detail(withRequest.id, 'DELETE'), context(withRequest.id))).status).toBe(409);
  expect(await prisma.trainingRequest.findUnique({ where: { id: requestRow.id } })).not.toBeNull();
  expect(await prisma.training.findUnique({ where: { id: withRequest.id } })).not.toBeNull();
});

test('authorized training deletion cascades qualifications history and configuration with private notes excluded from audits', async () => {
  const target = await fixture();
  const required = await fixture();
  const dependent = await fixture();
  const qualification = await prisma.userTraining.create({ data: { userId: memberId, trainingId: target.id, notes: 'Private training deletion notes' } });
  const history = await prisma.userTrainingStatusHistory.create({ data: { userTrainingId: qualification.id, toStatus: 'qualified', notes: 'Private deletion history notes' } });
  const outgoing = await prisma.trainingTrainingRequirement.create({ data: { trainingId: target.id, requiredTrainingId: required.id } });
  const incoming = await prisma.trainingTrainingRequirement.create({ data: { trainingId: dependent.id, requiredTrainingId: target.id } });
  const rank = await prisma.rank.create({ data: { name: 'Training deletion rank fixture', abbreviation: 'TDRF', orderIndex: 9900 } });
  const rankRequirement = await prisma.trainingRankRequirement.create({ data: { trainingId: target.id, minimumRankId: rank.id } });
  const transition = await prisma.rankTransitionRequirement.create({ data: { targetRankId: rank.id, requiredTrainings: { connect: { id: target.id } } } });
  const deleted = await DELETE(detail(target.id, 'DELETE'), context(target.id));
  expect(deleted.status).toBe(200);
  expect((await deleted.json()).data).toBeNull();
  expect(await prisma.training.findUnique({ where: { id: target.id } })).toBeNull();
  expect(await prisma.userTraining.findUnique({ where: { id: qualification.id } })).toBeNull();
  expect(await prisma.userTrainingStatusHistory.findUnique({ where: { id: history.id } })).toBeNull();
  expect(await prisma.trainingTrainingRequirement.count({ where: { id: { in: [outgoing.id, incoming.id] } } })).toBe(0);
  expect(await prisma.trainingRankRequirement.findUnique({ where: { id: rankRequirement.id } })).toBeNull();
  expect((await prisma.rankTransitionRequirement.findUniqueOrThrow({ where: { id: transition.id }, include: { requiredTrainings: true } })).requiredTrainings).toEqual([]);
  const audit = await prisma.apiAuditLog.findFirstOrThrow({ where: { correlationId: deleted.headers.get('X-Request-Id')! } });
  expect(audit).toMatchObject({ actorUserId: managerId, action: 'training.deleted', resource: 'training', targetUserIds: [memberId], method: 'DELETE', path: `/api/trainings/${target.id}`, before: { userTrainingIds: [qualification.id], statusHistoryIds: [history.id] } });
  expect(JSON.stringify(audit)).not.toContain('Private training deletion notes');
  expect(JSON.stringify(audit)).not.toContain('Private deletion history notes');
  expect((await DELETE(detail(target.id, 'DELETE'), context(target.id))).status).toBe(404);
});

test('training permissions refresh and bot access works across methods without invalid bearer fallback', async () => {
  const target = await fixture();
  session.userId = memberId;
  expect((await LIST(request())).status).toBe(200);
  expect((await GET(detail(target.id), context(target.id))).status).toBe(200);
  expect((await POST(request('trainings', 'POST', { name: name() }))).status).toBe(403);
  expect((await PATCH(detail(target.id, 'PATCH', { isActive: false }), context(target.id))).status).toBe(403);
  expect((await DELETE(detail(target.id, 'DELETE'), context(target.id))).status).toBe(403);
  session.userId = managerId;
  await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId: editPermissionId } }, data: { value: 0 } });
  try { expect((await PATCH(detail(target.id, 'PATCH', { isActive: false }), context(target.id))).status).toBe(403); }
  finally { await prisma.userPermission.update({ where: { userId_permissionId: { userId: managerId, permissionId: editPermissionId } }, data: { value: 1 } }); }
  const bot = await prisma.botToken.create({ data: { name: 'Training catalog bot', token: 'training-catalog-integration-token' } });
  session.userId = null;
  expect((await LIST(request())).status).toBe(401);
  expect((await LIST(request('trainings', 'GET', undefined, bot.token))).status).toBe(200);
  const created = await POST(request('trainings', 'POST', { name: name() }, bot.token));
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id;
  expect((await GET(detail(id, 'GET', undefined, bot.token), context(id))).status).toBe(200);
  expect((await PATCH(detail(id, 'PATCH', { duration: 60 }, bot.token), context(id))).status).toBe(200);
  expect((await DELETE(detail(id, 'DELETE', undefined, bot.token), context(id))).status).toBe(200);
  await prisma.botToken.update({ where: { id: bot.id }, data: { isActive: false } });
  session.userId = managerId;
  for (const token of [bot.token, 'invalid-training-catalog-token']) {
    expect((await LIST(request('trainings', 'GET', undefined, token))).status).toBe(401);
    expect((await GET(detail(target.id, 'GET', undefined, token), context(target.id))).status).toBe(401);
    expect((await POST(request('trainings', 'POST', { name: name() }, token))).status).toBe(401);
    expect((await PATCH(detail(target.id, 'PATCH', { duration: 60 }, token), context(target.id))).status).toBe(401);
    expect((await DELETE(detail(target.id, 'DELETE', undefined, token), context(target.id))).status).toBe(401);
  }
});

test('training delete rolls back qualification history and prerequisites if its audit cannot persist', async () => {
  const target = await fixture();
  const required = await fixture();
  const qualification = await prisma.userTraining.create({ data: { userId: memberId, trainingId: target.id, notes: 'Rollback qualification notes' } });
  const history = await prisma.userTrainingStatusHistory.create({ data: { userTrainingId: qualification.id, toStatus: 'qualified' } });
  const edge = await prisma.trainingTrainingRequirement.create({ data: { trainingId: target.id, requiredTrainingId: required.id } });
  const transact = prisma.$transaction.bind(prisma);
  const transactionSpy = vi.spyOn(prisma, '$transaction').mockImplementation(((operation: (tx: Prisma.TransactionClient) => Promise<unknown>) => transact(async tx => {
    const auditSpy = vi.spyOn(tx.apiAuditLog, 'create').mockRejectedValue(new Error('Audit storage unavailable'));
    try { return await operation(tx); } finally { auditSpy.mockRestore(); }
  })) as typeof prisma.$transaction);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let response: Response;
  try { response = await DELETE(detail(target.id, 'DELETE'), context(target.id)); }
  finally { transactionSpy.mockRestore(); log.mockRestore(); }
  expect(response.status).toBe(500);
  expect(await prisma.training.findUniqueOrThrow({ where: { id: target.id } })).toEqual(target);
  expect(await prisma.userTraining.findUniqueOrThrow({ where: { id: qualification.id } })).toEqual(qualification);
  expect(await prisma.userTrainingStatusHistory.findUniqueOrThrow({ where: { id: history.id } })).toEqual(history);
  expect(await prisma.trainingTrainingRequirement.findUniqueOrThrow({ where: { id: edge.id } })).toEqual(edge);
  expect(await prisma.apiAuditLog.count({ where: { correlationId: response.headers.get('X-Request-Id')! } })).toBe(0);
});
