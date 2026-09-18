import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), training: model(), trainingCategory: model(), trainingRequest: model(), trainingSession: model(), userTraining: model(), trainingRankRequirement: model(), trainingTrainingRequirement: model(), rankTransitionRequirement: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, POST } from '@/app/api/trainings/route';
import { GET as detail, PATCH, DELETE } from '@/app/api/trainings/[id]/route';
import { parseTrainingBody } from '@/lib/api/trainings';
const record = { id: 1, name: 'Basic', description: 'private description', categoryId: 3, duration: 60, requiresTrainingSession: true, requiresOrbatQualification: false, orbatQualificationNotes: 'private qualification notes', requiredForNewPeople: false, isActive: true, createdAt: new Date('2026-09-17T00:00:00Z'), updatedAt: new Date('2026-09-17T00:00:00Z'), _count: { userTrainings: 2, trainingRequests: 0 } };
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: unknown, bot = false, query = '') => new Request(`http://localhost/api/trainings${query}`, { method, headers: bot ? { authorization: 'Bearer bot' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 4 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'system:super_admin' }, value: 255 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.training.findUnique.mockResolvedValue(record);
  mocks.db.training.findMany.mockResolvedValue([record]);
  mocks.db.trainingCategory.findUnique.mockResolvedValue({ id: 3 });
  mocks.db.training.create.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.db.training.update.mockImplementation(async ({ data }) => ({ ...record, ...data }));
  mocks.db.trainingSession.count.mockResolvedValue(0);
  mocks.db.trainingRequest.count.mockResolvedValue(0);
  for (const model of [mocks.db.userTraining, mocks.db.trainingRankRequirement, mocks.db.trainingTrainingRequirement, mocks.db.rankTransitionRequirement]) model.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
const methods = [
  ['GET', (bot = false) => GET(req('GET', undefined, bot))],
  ['detail', (bot = false) => detail(req('GET', undefined, bot), ctx())],
  ['POST', (bot = false) => POST(req('POST', { name: 'Basic' }, bot))],
  ['PATCH', (bot = false) => PATCH(req('PATCH', { name: 'Updated' }, bot), ctx())],
  ['DELETE', (bot = false) => DELETE(req('DELETE', undefined, bot), ctx())],
] as const;
describe('training catalog access', () => {
  it.each(methods)('%s supports users and bots, rejects missing/revoked credentials', async (_method, call) => {
    expect((await call()).status).toBeLessThan(300);
    expect((await call(true)).status).toBeLessThan(300);
    mocks.session.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 4 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await call(true)).status).toBe(401);
  });
  it('allows ordinary catalog reads and denies mutations', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await GET(req())).status).toBe(200);
    expect((await detail(req(), ctx())).status).toBe(200);
    for (const [, call] of methods.slice(2)) expect((await call()).status).toBe(403);
  });
  it.each([['training:create', 2], ['training:edit', 3], ['training:delete', 4]] as const)('allows individual %s grant', async (permission, index) => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: permission }, value: 1 }] });
    expect((await methods[index][1]()).status).toBeLessThan(300);
  });
});
describe('training catalog contracts', () => {
  it('uses same counts DTO for collection/detail/create/update without personal relations', async () => {
    const listed = (await (await GET(req())).json()).data[0];
    const detailed = (await (await detail(req(), ctx())).json()).data;
    const created = (await (await POST(req('POST', { name: 'Basic' }))).json()).data;
    const updated = (await (await PATCH(req('PATCH', { name: 'Basic' }), ctx())).json()).data;
    expect(detailed).toEqual(listed); expect(created).toEqual(listed); expect(updated).toEqual(listed);
    expect(listed).toMatchObject({ counts: { userTrainings: 2, trainingRequests: 0 }, createdAt: '2026-09-17T00:00:00.000Z' });
    for (const field of ['_count', 'userTrainings', 'trainingRequests']) expect(listed).not.toHaveProperty(field);
  });
  it.each(['?activeOnly=yes', '?categoryId=bad', '?categoryId=0', '?categoryId=2147483648', '?limit=0', '?cursor=2147483648'])('rejects invalid query %s', async query => expect((await GET(req('GET', undefined, false, query))).status).toBe(400));
  it('filters before pagination and uses actual lookahead', async () => {
    mocks.db.training.findMany.mockResolvedValue([record, { ...record, id: 2 }]);
    expect(await (await GET(req('GET', undefined, false, '?activeOnly=true&categoryId=3&limit=1&cursor=4'))).json()).toMatchObject({ data: [{ id: 1 }], meta: { limit: 1, nextCursor: '1' } });
    expect(mocks.db.training.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true, categoryId: 3, id: { gt: 4 } }, orderBy: { id: 'asc' }, take: 2 }));
    mocks.db.training.findMany.mockResolvedValue([record]);
    expect((await (await GET(req('GET', undefined, false, '?activeOnly=false&limit=1'))).json()).meta.nextCursor).toBeNull();
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { name: '' }, { name: 'Basic', requiredForNewPeople: true }, { name: 'Basic', categoryId: '3' }, { name: 'Basic', duration: '' }, { name: 'Basic', duration: 0 }, { name: 'Basic', duration: 1441 }, { name: 'Basic', description: false }, { name: 'Basic', orbatQualificationNotes: 3 }, { name: 'Basic', isActive: 'true' }])('rejects invalid create %j', async body => expect((await POST(req('POST', body))).status).toBe(422));
  it('validates nulls, trims strings and preserves omitted fields', async () => {
    const payload = { name: ' Basic ', description: ' ', orbatQualificationNotes: null, duration: null, categoryId: null, isActive: false, requiresTrainingSession: false, requiresOrbatQualification: true };
    expect(parseTrainingBody(payload, true)).toEqual({ data: { ...payload, name: 'Basic', description: null } });
    expect(parseTrainingBody({ description: null, orbatQualificationNotes: ' note ', duration: 1440 }, false)).toEqual({ data: { description: null, orbatQualificationNotes: 'note', duration: 1440 } });
    expect((await PATCH(req('PATCH', {}), ctx())).status).toBe(422);
    await PATCH(req('PATCH', { isActive: false }), ctx());
    expect(mocks.db.training.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
  });
  it('validates category existence and preserves omission of defaults', async () => {
    mocks.db.trainingCategory.findUnique.mockResolvedValue(null);
    expect((await POST(req('POST', { name: 'Basic', categoryId: 3 }))).status).toBe(404);
    expect((await PATCH(req('PATCH', { categoryId: 3 }), ctx())).status).toBe(404);
    expect(mocks.db.training.create).not.toHaveBeenCalled();
    expect((await POST(req('POST', { name: 'Basic' }))).status).toBe(201);
    expect(mocks.db.training.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Basic' } }));
  });
  it.each([detail, PATCH, DELETE])('validates item IDs and missing records', async handler => {
    const method = handler === PATCH ? 'PATCH' : handler === DELETE ? 'DELETE' : 'GET';
    const body = handler === PATCH ? { name: 'Basic' } : undefined;
    for (const id of ['bad', '0', '2147483648']) expect((await handler(req(method, body), ctx(id))).status).toBe(400);
    mocks.db.training.findUnique.mockResolvedValue(null);
    expect((await handler(req(method, body), ctx())).status).toBe(404);
  });
  it('rejects malformed JSON', async () => {
    const invalid = () => new Request('http://localhost/api/trainings', { method: 'POST', body: '{' });
    expect((await POST(invalid())).status).toBe(400);
    expect((await PATCH(invalid(), ctx())).status).toBe(400);
  });
});
describe('training audit and deletion', () => {
  it('redacts free text in mutation audits and attributes bot changes', async () => {
    await POST(req('POST', { name: 'Basic' }));
    await PATCH(req('PATCH', { description: null, orbatQualificationNotes: null }, true), ctx());
    const audits = mocks.db.apiAuditLog.create.mock.calls.map(([arg]) => arg.data);
    expect(audits[0]).toMatchObject({ action: 'training.created', actorUserId: 4, after: { description: '[REDACTED]', orbatQualificationNotes: '[REDACTED]' } });
    expect(audits[1]).toMatchObject({ action: 'training.updated', actorTokenId: 9, after: { description: null, orbatQualificationNotes: null } });
    expect(JSON.stringify(audits)).not.toContain('private');
  });
  it.each(['trainingSession', 'trainingRequest'] as const)('blocks deletion with existing %s', async model => {
    mocks.db[model].count.mockResolvedValue(1);
    expect((await DELETE(req('DELETE'), ctx())).status).toBe(409);
    expect(mocks.db.training.delete).not.toHaveBeenCalled();
  });
  it('records affected users and IDs of every cascade without notes', async () => {
    mocks.db.userTraining.findMany.mockResolvedValue([{ id: 2, userId: 5, statusHistory: [{ id: 3 }] }]);
    mocks.db.trainingRankRequirement.findMany.mockResolvedValue([{ id: 4, minimumRankId: 5 }]);
    mocks.db.trainingTrainingRequirement.findMany.mockResolvedValue([{ id: 6, trainingId: 1, requiredTrainingId: 7 }]);
    mocks.db.rankTransitionRequirement.findMany.mockResolvedValue([{ id: 8, targetRankId: 5 }]);
    expect(await (await DELETE(req('DELETE'), ctx())).json()).toEqual({ data: null, meta: {} });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'training.deleted', targetUserIds: [5], before: expect.objectContaining({ userTrainingIds: [2], statusHistoryIds: [3], rankRequirements: [{ id: 4, minimumRankId: 5 }], prerequisiteEdges: [{ id: 6, trainingId: 1, requiredTrainingId: 7 }], rankTransitionLinks: [{ id: 8, targetRankId: 5 }] }) }) });
  });
  it.each([['P2025', 404], ['P2003', 409], ['P2002', 409]])('maps database errors %s', async (code, status) => {
    mocks.db.$transaction.mockRejectedValue({ code });
    for (const [, call] of methods.slice(2)) expect((await call()).status).toBe(status);
  });
  it('fails closed on audit persistence failures', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    for (const [, call] of methods.slice(2)) expect((await call()).status).toBe(500);
    spy.mockRestore();
  });
});
it('unknown training database failures are not misreported as reference conflicts', async () => {
  const { trainingDatabaseError } = await import('@/lib/api/trainings');
  expect(() => trainingDatabaseError({ code: 'P9999' })).toThrow();
});
