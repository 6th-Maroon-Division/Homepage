import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), create: vi.fn(), update: vi.fn() });
  return { session: vi.fn(), db: { user: model(), botToken: model(), training: model(), rank: model(), trainingRankRequirement: model(), trainingTrainingRequirement: model(), apiAuditLog: model(), $transaction: vi.fn() } };
});
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/app/api/auth/[...nextauth]/route', () => ({ authOptions: {} }));
import { GET, PATCH } from '@/app/api/trainings/[id]/requirements/route';
import { parseTrainingRequirements, introducesTrainingCycle } from '@/lib/api/training-requirements';
const ctx = (id = '1') => ({ params: Promise.resolve({ id }) });
const req = (method = 'GET', body?: unknown, bot = false) => new Request('http://localhost/api/trainings/1/requirements', { method, headers: bot ? { authorization: 'Bearer bot' } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const rank = { id: 4, name: 'Private', abbreviation: 'Pvt', orderIndex: 0, createdAt: new Date('2026-09-17T00:00:00Z') };
const training = { rankRequirement: { minimumRankId: 4, minimumRank: rank }, requiresTrainings: [{ requiredTrainingId: 2, requiredTraining: { id: 2, name: 'Basics', category: { name: 'Core' } } }] };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 5 } });
  mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [{ permission: { key: 'training:edit' }, value: 1 }] });
  mocks.db.botToken.findFirst.mockResolvedValue({ id: 9 });
  mocks.db.training.findUnique.mockResolvedValue(training);
  mocks.db.training.count.mockImplementation(async ({ where }) => where.id.in.length);
  mocks.db.rank.findUnique.mockResolvedValue(rank);
  mocks.db.trainingTrainingRequirement.findMany.mockResolvedValue([]);
  mocks.db.$transaction.mockImplementation(async cb => cb(mocks.db));
});
describe('training requirements authentication', () => {
  it.each([GET, PATCH])('accepts user/bot and rejects absent/revoked credentials', async handler => {
    const method = handler === PATCH ? 'PATCH' : 'GET';
    const body = handler === PATCH ? { requiredTrainingIds: [] } : undefined;
    expect((await handler(req(method, body), ctx())).status).toBe(200);
    expect((await handler(req(method, body, true), ctx())).status).toBe(200);
    mocks.session.mockResolvedValue(null);
    expect((await handler(req(method, body), ctx())).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: 5 } });
    mocks.db.botToken.findFirst.mockResolvedValue(null);
    expect((await handler(req(method, body, true), ctx())).status).toBe(401);
  });
  it('allows ordinary reads but requires edit rights for mutation', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ userPermissions: [] });
    expect((await GET(req(), ctx())).status).toBe(200);
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [] }), ctx())).status).toBe(403);
  });
  it('requires superadmin to clear minimum rank even if none exists', async () => {
    mocks.db.training.findUnique.mockResolvedValue({ rankRequirement: null, requiresTrainings: [] });
    expect((await PATCH(req('PATCH', { minimumRankId: null }), ctx())).status).toBe(403);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
    expect((await PATCH(req('PATCH', { minimumRankId: null }, true), ctx())).status).toBe(200);
    expect(mocks.db.trainingRankRequirement.deleteMany).toHaveBeenCalledWith({ where: { trainingId: 1 } });
  });
});
describe('strict requirements contracts', () => {
  it.each([null, [], {}, { minimumRankId: 0 }, { minimumRankId: '4' }, { minimumRankId: 2147483648 }, { requiredTrainingIds: '2' }, { requiredTrainingIds: [2, 2] }, { requiredTrainingIds: ['2'] }, { requiredTrainingIds: [-1] }, { requiredTrainingIds: [2147483648] }, { requiredTrainingId: 2 }])('rejects invalid patch %j', async body => expect((await PATCH(req('PATCH', body), ctx())).status).toBe(422));
  it('sorts identifiers and preserves omitted fields', () => {
    expect(parseTrainingRequirements({ requiredTrainingIds: [3, 2] })).toEqual({ data: { requiredTrainingIds: [2, 3] } });
    expect(parseTrainingRequirements({ minimumRankId: null })).toEqual({ data: { minimumRankId: null } });
  });
  it.each([GET, PATCH])('rejects invalid route IDs and missing training', async handler => {
    const method = handler === PATCH ? 'PATCH' : 'GET';
    const body = handler === PATCH ? { requiredTrainingIds: [] } : undefined;
    for (const id of ['bad', '0', '2147483648']) expect((await handler(req(method, body), ctx(id))).status).toBe(400);
    mocks.db.training.findUnique.mockResolvedValue(null);
    expect((await handler(req(method, body), ctx())).status).toBe(404);
  });
  it('rejects invalid JSON', async () => expect((await PATCH(new Request('http://localhost/api', { method: 'PATCH', body: '{' }), ctx())).status).toBe(400));
  it('returns enriched requirements and no catalog-read audit', async () => {
    expect(await (await GET(req(), ctx())).json()).toMatchObject({ data: { minimumRankId: 4, requiredTrainingIds: [2], minimumRank: { id: 4, createdAt: '2026-09-17T00:00:00.000Z' }, requiredTrainings: [{ id: 2, category: { name: 'Core' } }] }, meta: {} });
    expect(mocks.db.apiAuditLog.create).not.toHaveBeenCalled();
    mocks.db.training.findUnique.mockResolvedValue({ rankRequirement: null, requiresTrainings: [] });
    expect(await (await GET(req(), ctx())).json()).toEqual({ data: { minimumRankId: null, requiredTrainingIds: [], minimumRank: null, requiredTrainings: [] }, meta: {} });
  });
});
describe('cycle detection', () => {
  it('detects direct, indirect and proposed cycles', () => {
    expect(introducesTrainingCycle(1, [1], [])).toBe(true);
    expect(introducesTrainingCycle(1, [2], [{ trainingId: 2, requiredTrainingId: 1 }])).toBe(true);
    expect(introducesTrainingCycle(1, [2], [{ trainingId: 2, requiredTrainingId: 3 }, { trainingId: 3, requiredTrainingId: 1 }])).toBe(true);
  });
  it('terminates on unrelated existing cycles and handles replacing target edges', () => {
    const edges = [{ trainingId: 1, requiredTrainingId: 2 }, { trainingId: 2, requiredTrainingId: 1 }, { trainingId: 3, requiredTrainingId: 4 }, { trainingId: 4, requiredTrainingId: 3 }];
    expect(introducesTrainingCycle(1, [], edges)).toBe(false);
    expect(introducesTrainingCycle(1, [3], edges)).toBe(false);
    expect(introducesTrainingCycle(1, [5], edges)).toBe(false);
  });
  it('rejects self and reachability cycles before any mutation', async () => {
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [1] }), ctx())).status).toBe(422);
    mocks.db.trainingTrainingRequirement.findMany.mockResolvedValue([{ trainingId: 2, requiredTrainingId: 1 }]);
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [2] }), ctx())).status).toBe(409);
    expect(mocks.db.trainingTrainingRequirement.deleteMany).not.toHaveBeenCalled();
  });
});
describe('atomic requirement writes', () => {
  it('validates all referenced rows before applying changes', async () => {
    mocks.db.rank.findUnique.mockResolvedValue(null);
    expect((await PATCH(req('PATCH', { minimumRankId: 4, requiredTrainingIds: [] }), ctx())).status).toBe(404);
    mocks.db.rank.findUnique.mockResolvedValue(rank);
    mocks.db.training.count.mockResolvedValue(0);
    expect((await PATCH(req('PATCH', { minimumRankId: 4, requiredTrainingIds: [2] }), ctx())).status).toBe(404);
    expect(mocks.db.trainingRankRequirement.upsert).not.toHaveBeenCalled();
    expect(mocks.db.trainingTrainingRequirement.deleteMany).not.toHaveBeenCalled();
  });
  it('updates minimum rank without replacing prerequisites', async () => {
    expect((await PATCH(req('PATCH', { minimumRankId: 4 }), ctx())).status).toBe(200);
    expect(mocks.db.trainingRankRequirement.upsert).toHaveBeenCalledWith({ where: { trainingId: 1 }, create: { trainingId: 1, minimumRankId: 4 }, update: { minimumRankId: 4 } });
    expect(mocks.db.trainingTrainingRequirement.deleteMany).not.toHaveBeenCalled();
  });
  it('replaces prerequisite array without modifying minimum rank, under Serializable isolation', async () => {
    mocks.db.training.findUnique.mockResolvedValueOnce(training).mockResolvedValueOnce({ ...training, requiresTrainings: [{ requiredTrainingId: 3, requiredTraining: { id: 3, name: 'Advanced', category: null } }] });
    const response = await PATCH(req('PATCH', { requiredTrainingIds: [3] }), ctx());
    expect(response.status).toBe(200);
    expect(mocks.db.trainingTrainingRequirement.deleteMany).toHaveBeenCalledWith({ where: { trainingId: 1 } });
    expect(mocks.db.trainingTrainingRequirement.createMany).toHaveBeenCalledWith({ data: [{ trainingId: 1, requiredTrainingId: 3 }] });
    expect(mocks.db.trainingRankRequirement.upsert).not.toHaveBeenCalled();
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(mocks.db.apiAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'training_requirements.updated', resource: 'training_requirements', resourceId: '1', before: { minimumRankId: 4, requiredTrainingIds: [2] }, after: { minimumRankId: 4, requiredTrainingIds: [3] } }) });
  });
  it('clears prerequisites without creating empty rows', async () => {
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [] }), ctx())).status).toBe(200);
    expect(mocks.db.trainingTrainingRequirement.deleteMany).toHaveBeenCalled();
    expect(mocks.db.trainingTrainingRequirement.createMany).not.toHaveBeenCalled();
  });
  it.each([['P2034', 409], ['P2002', 409], ['P2003', 409], ['P2025', 404]])('maps concurrent conflict %s', async (code, status) => {
    mocks.db.$transaction.mockRejectedValue({ code });
    const response = await PATCH(req('PATCH', { requiredTrainingIds: [] }), ctx());
    expect(response.status).toBe(status);
    if (code === 'P2034') expect((await response.json()).error.message).toContain('retry');
  });
  it('fails when transactional auditing fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.db.apiAuditLog.create.mockRejectedValue(new Error('Audit unavailable'));
    expect((await PATCH(req('PATCH', { requiredTrainingIds: [] }), ctx())).status).toBe(500);
    spy.mockRestore();
  });
});
it('unknown database error codes are propagated for canonical internal error handling', async () => {
  const { requirementsDatabaseError } = await import('@/lib/api/training-requirements');
  const failure = { code: 'P9999' };
  expect(() => requirementsDatabaseError(failure)).toThrow();
});
